"""主 Agent 协调器：先规划，再临时派发 subagent，最后验收结果。"""
from __future__ import annotations

import json
import re
from typing import Any

from ..llm.factory import chat_complete


class MainAgent:
    """前台协调者，不长期持有 subagent 状态。"""

    PLAN_PROMPT = """你是学习任务的主 Agent，负责规划和验收，不直接完成具体内容。
先判断用户意图，再拆分为一个或多个适合 subagent 执行的任务。
只输出 JSON：
{
  "action": "chat|tutor|resource",
  "resource_type": "lecture|mindmap|quiz|reading|code|illustration|ppt|null",
  "topic": "简短主题",
  "tasks": [{"agent": "tutor|lecture|mindmap|quiz|reading|code|illustration|ppt|conversation", "instruction": "给 subagent 的明确任务"}],
  "acceptance": ["主 Agent 验收标准"]
}
不要输出解释或 Markdown。"""

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

    async def plan(self, message: str, profile: dict | None, history: list[dict] | None) -> dict[str, Any]:
        recent = "\n".join(f"{item.get('role')}: {str(item.get('content', ''))[:300]}" for item in (history or [])[-4:])
        response = await chat_complete([
            {"role": "system", "content": self.PLAN_PROMPT},
            {"role": "user", "content": f"学生画像：{profile or {}}\n最近对话：{recent}\n当前请求：{message}"},
        ], temperature=0.1, max_tokens=700)
        plan = self._extract_json(response)
        if plan.get("action") not in {"chat", "tutor", "resource"}:
            plan["action"] = "chat"
        plan.setdefault("topic", message[:30])
        plan.setdefault("tasks", [{"agent": "conversation", "instruction": "回答当前学习问题"}])
        plan.setdefault("acceptance", ["回答与用户问题相关", "结论清晰且没有空结果"])
        return plan

    async def accept(self, plan: dict[str, Any], result: str) -> dict[str, Any]:
        """由主 Agent 验收 subagent 结果；模型不可用时使用本地兜底规则。"""
        if not result.strip():
            return {"accepted": False, "reason": "subagent 没有返回内容"}
        try:
            response = await chat_complete([
                {"role": "system", "content": "你是主 Agent 的验收器，只输出 JSON：{\"accepted\":true|false,\"reason\":\"一句话\"}"},
                {"role": "user", "content": f"验收标准：{plan.get('acceptance', [])}\nsubagent 结果：{result[:5000]}"},
            ], temperature=0.0, max_tokens=180)
            data = self._extract_json(response)
            if isinstance(data.get("accepted"), bool):
                return {"accepted": data["accepted"], "reason": data.get("reason") or "已完成检查"}
        except Exception:
            pass
        return {"accepted": True, "reason": "结果非空，已通过基础验收"}
