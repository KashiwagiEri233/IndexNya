"""主 Agent 协调器：先轻量确定需求，再只调用被选中功能的 prompt，最后验收结果。"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..llm.factory import chat_complete, chat_stream

logger = logging.getLogger(__name__)


class MainAgent:
    """前台协调者，不长期持有 subagent 状态。

    阶段A（确定需求）：轻量意图判定（keyword 未命中时才调一次小 LLM）。
    阶段B（调用功能 prompt）：需求确定后，只加载被选中功能的提示词执行。
    """

    # 轻量意图判定 — 只输出一个小 JSON，不产出 tasks/acceptance 等大结构。
    ROUTE_LIGHT_PROMPT = """你是意图分类器，只判断用户请求应交给哪个功能，绝不回答问题本身。
只输出一个 JSON 对象，不要解释、不要 Markdown、不要代码块：
{"action": "chat|tutor|resource|skill|quiz_session", "resource_type": "lecture|mindmap|quiz|reading|code|null", "skill": "技能名|null", "topic": "简短主题"}

规则：
- 用户明确要生成学习资料（讲解文档/思维导图/练习题/拓展阅读/代码案例）时 action=resource，resource_type 填对应类型。
- 用户想互动刷题、一题一题被提问着做题（如"刷题""陪我练题""逐题练习"）时 action=quiz_session。
- 用户请求与下列可用技能匹配时 action=skill，skill 必须填列表中的确切 name。
- 用户提出具体疑问、求讲解、求解答时 action=tutor。
- 其余（闲聊、画像交流、宽泛咨询、不确定）action=chat。

可用技能：
{skill_catalog}
topic 用 2-10 字概括。"""

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        cleaned = text.strip()
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            cleaned = match.group(0)
        try:
            data = json.loads(cleaned)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    async def route_light(
        self,
        message: str,
        profile: dict | None = None,
        history: list[dict] | None = None,
    ) -> dict[str, Any]:
        """阶段A-3：轻量意图判定（仅当 keywords 未命中时调用）。

        返回：{"action", "resource_type", "skill", "topic"}
        """
        from ..skills.manager import get_skill, list_skills

        skills = list_skills()
        catalog = "\n".join(
            f"- {s.name}：{s.title} — {s.description[:40]}" for s in skills
        ) if skills else "- （暂无技能）"
        system_prompt = self.ROUTE_LIGHT_PROMPT.format(skill_catalog=catalog)

        recent = "\n".join(
            f"{item.get('role')}: {str(item.get('content', ''))[:200]}" for item in (history or [])[-4:]
        )
        user_content = f"学生画像：{profile or {}}\n最近对话：{recent}\n当前请求：{message}"
        try:
            text = await chat_complete(
                [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_content}],
                temperature=0.0,
                max_tokens=150,
            )
            data = self._extract_json(text)
        except Exception as e:
            logger.warning("light routing LLM failed: %s, fallback to chat", e)
            data = {}

        action = str(data.get("action", "chat")).lower()
        if action not in {"chat", "tutor", "resource", "skill", "quiz_session"}:
            action = "chat"

        resource_type = str(data.get("resource_type", "")).lower()
        if action == "resource" and resource_type not in ("lecture", "mindmap", "quiz", "reading", "code"):
            action = "chat"
            resource_type = ""

        skill = str(data.get("skill") or "").strip()
        if action == "skill" and get_skill(skill) is None:
            action = "chat"
            skill = ""

        topic = str(data.get("topic") or "").strip() or message[:20]
        return {
            "action": action,
            "resource_type": resource_type or None,
            "skill": skill or None,
            "topic": topic,
        }


    CONVERSATION_PROMPT = """你是 Index 学习岛的主 Agent，同时负责直接回答普通学习对话。
请用中文、结构清晰地回答用户问题；必要时使用 Markdown、数学公式和例子。
不要提及 Agent、路由或内部工作流程。"""

    async def stream_answer(
        self,
        message: str,
        history: list[dict] | None = None,
        extra_context: str = "",
    ):
        """普通对话由主 Agent 直接流式回答，不创建 conversation subagent。"""
        messages: list[dict[str, Any]] = [{"role": "system", "content": self.CONVERSATION_PROMPT}]
        if extra_context:
            messages.append({"role": "system", "content": extra_context})
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})
        async for chunk in chat_stream(messages, temperature=0.7, max_tokens=3072):
            yield chunk

    async def accept(self, plan: dict[str, Any], result: str) -> dict[str, Any]:
        """由主 Agent 验收 subagent 结果；模型不可用时使用本地兜底规则。"""
        if not result.strip():
            return {"accepted": False, "reason": "subagent 没有返回内容"}
        try:
            response = await chat_complete([
                {"role": "system", "content": "你是主 Agent 的验收器，只输出 JSON：{\"accepted\":true|false,\"reason\":\"一句话\"}"},
                {"role": "user", "content": f"验收标准：{plan.get('acceptance', [])}\nsubagent 结果：{result[:5000]}"},
            ], temperature=0.0, max_tokens=120)
            data = self._extract_json(response)
            if isinstance(data.get("accepted"), bool):
                return {"accepted": data["accepted"], "reason": data.get("reason") or "已完成检查"}
        except Exception:
            pass
        return {"accepted": True, "reason": "结果非空，已通过基础验收"}
