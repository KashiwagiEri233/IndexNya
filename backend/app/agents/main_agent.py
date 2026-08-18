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
    # 技能不再由这里路由：技能目录已注入对话 Agent 的系统提示词，由 Agent 自己决定触发
    # （用户点名或任务匹配技能描述时由 Agent 直接触发）。
    ROUTE_LIGHT_PROMPT = """你是意图分类器，只判断用户请求应交给哪个功能，绝不回答问题本身。
只输出一个 JSON 对象，不要解释、不要 Markdown、不要代码块：
{"action": "chat|tutor|resource|quiz_session", "resource_type": "lecture|mindmap|quiz|reading|code|null", "topic": "简短主题"}

规则：
- 用户明确要生成学习资料（讲解文档/思维导图/练习题/拓展阅读/代码案例）时 action=resource，resource_type 填对应类型。
- 用户想互动刷题、一题一题被提问着做题（如"刷题""陪我练题""逐题练习"）时 action=quiz_session。
- 用户提出具体疑问、求讲解、求解答时 action=tutor。
- 其余（闲聊、宽泛咨询、不确定）action=chat。

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
        history: list[dict] | None = None,
    ) -> dict[str, Any]:
        """阶段A-3：轻量意图判定（仅当 keywords 未命中时调用）。

        返回：{"action", "resource_type", "topic"}
        技能由对话 Agent 依据系统提示词中的技能目录自行触发，不在此路由。
        """
        recent = "\n".join(
            f"{item.get('role')}: {str(item.get('content', ''))[:200]}" for item in (history or [])[-4:]
        )
        user_content = f"最近对话：{recent}\n当前请求：{message}"
        try:
            text = await chat_complete(
                [{"role": "system", "content": self.ROUTE_LIGHT_PROMPT}, {"role": "user", "content": user_content}],
                temperature=0.0,
                max_tokens=150,
            )
            data = self._extract_json(text)
        except Exception as e:
            logger.warning("light routing LLM failed: %s, fallback to chat", e)
            data = {}

        action = str(data.get("action", "chat")).lower()
        if action not in {"chat", "tutor", "resource", "quiz_session"}:
            action = "chat"

        resource_type = str(data.get("resource_type", "")).lower()
        if action == "resource" and resource_type not in ("lecture", "mindmap", "quiz", "reading", "code"):
            action = "chat"
            resource_type = ""

        topic = str(data.get("topic") or "").strip() or message[:20]
        return {
            "action": action,
            "resource_type": resource_type or None,
            "topic": topic,
        }


    CONVERSATION_PROMPT = """你是 Index 学习岛的主 Agent，同时负责直接回答普通学习对话。
请用中文、结构清晰地回答用户问题；必要时使用 Markdown、数学公式和例子。
不要提及 Agent、路由或内部工作流程。"""

    @staticmethod
    def build_skills_prompt() -> str:
        """构建技能提示段（渐进式披露：只给名称+描述，不注入正文）。

        技能目录随系统提示词常驻，由对话 Agent 自行判断何时触发
        （用户点名或任务匹配描述）；完整指令在执行时通过 use_skill
        工具按需加载。无已开启技能时返回空字符串。
        """
        from ..skills.manager import list_skills

        skills = [s for s in list_skills() if s.enabled]
        if not skills:
            return ""

        inventory_lines = [
            f"- **{s.name}**：{s.description or '无描述'}\n  文件：`backend/app/skills/{s.name}/SKILL.md`"
            for s in skills
        ]
        return (
            "## 可用技能\n\n"
            "你拥有若干专用技能——以 SKILL.md 指令文件存储的可复用执行手册。"
            "每个技能有名称和描述，说明它做什么、何时使用。\n\n"
            "### 技能清单\n\n"
            + "\n".join(inventory_lines)
            + "\n\n### 技能规则\n\n"
            "1. **发现** — 上面的清单是本次会话的完整技能目录，完整指令在对应的 SKILL.md 中。\n"
            "2. **触发时机** — 当用户明确说出技能名，或请求明显匹配某技能的描述时，就应该使用该技能；"
            "不要静默跳过匹配的技能——要么使用它，要么简短说明为什么不用。\n"
            "3. **先加载再执行** — 执行任何技能前，必须先调用 use_skill 工具加载它的完整指令"
            "（这是读取 SKILL.md 的方式），不要凭记忆或猜测执行。\n"
            "4. **渐进式加载** — 只加载当前任务直接需要的技能，不要一次性把全部技能都用上。\n"
            "5. **协同** — 多个技能同时适用时，选择最小必要集合，并用一句话说明正在使用哪个技能及原因。\n"
            "6. **失败处理** — 技能无法应用时，清楚说明问题并继续用最佳替代方案回答。"
        )

    async def stream_answer(
        self,
        message: str,
        history: list[dict] | None = None,
        extra_context: str = "",
        tools: list[dict] | None = None,
        on_tool_calls: Any | None = None,
    ):
        """普通对话由主 Agent 直接流式回答，不创建 conversation subagent。"""
        messages: list[dict[str, Any]] = [{"role": "system", "content": self.CONVERSATION_PROMPT}]
        skills_section = self.build_skills_prompt()
        if skills_section:
            messages.append({"role": "system", "content": skills_section})
        if extra_context:
            messages.append({"role": "system", "content": extra_context})
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})
        async for chunk in chat_stream(messages, temperature=0.7, max_tokens=3072, tools=tools, on_tool_calls=on_tool_calls):
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
