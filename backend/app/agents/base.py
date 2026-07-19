"""Agent 基类 — 定义角色、system prompt、统一调用入口。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

from ..llm.factory import chat_complete, chat_stream, json_complete


@dataclass
class AgentResult:
    """agent 输出统一容器。"""
    text: str = ""
    json_data: Optional[dict] = None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class BaseAgent:
    """所有智能体的基类。

    子类需设置：
        name: 角色名
        system_prompt: 角色 system 指令
    """
    name: str = "base"
    system_prompt: str = "你是一个乐于助人的 AI 助手。"

    def build_messages(
        self,
        user_input: str,
        history: Optional[list[dict[str, str]]] = None,
        extra_context: str = "",
    ) -> list[dict[str, Any]]:
        msgs: list[dict[str, Any]] = [{"role": "system", "content": self.system_prompt}]
        if extra_context:
            msgs.append({"role": "system", "content": extra_context})
        if history:
            msgs.extend(history)
        msgs.append({"role": "user", "content": user_input})
        return msgs

    async def run(
        self,
        user_input: str,
        history: Optional[list[dict[str, str]]] = None,
        extra_context: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AgentResult:
        msgs = self.build_messages(user_input, history, extra_context)
        text = await chat_complete(msgs, temperature=temperature, max_tokens=max_tokens)
        return AgentResult(text=text, meta={"agent": self.name})

    async def stream(
        self,
        user_input: str,
        history: Optional[list[dict[str, str]]] = None,
        extra_context: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> AsyncIterator[str]:
        msgs = self.build_messages(user_input, history, extra_context)
        async for chunk in chat_stream(msgs, temperature=temperature, max_tokens=max_tokens):
            yield chunk

    async def run_json(
        self,
        user_input: str,
        history: Optional[list[dict[str, str]]] = None,
        extra_context: str = "",
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> tuple[dict, str]:
        """返回 (解析后的 dict, 原始文本)。解析失败时 dict 为空。"""
        import json
        import re

        msgs = self.build_messages(user_input, history, extra_context)
        raw = await json_complete(msgs, temperature=temperature, max_tokens=max_tokens)

        # 兼容 ```json ... ``` 包裹
        cleaned = raw.strip()
        m = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", cleaned, re.DOTALL)
        if m:
            cleaned = m.group(1)
        else:
            # 尝试提取首个 { 到末尾 }
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1 and end > start:
                cleaned = cleaned[start : end + 1]

        try:
            data = json.loads(cleaned)
            if isinstance(data, list):
                data = {"items": data}
            return data, raw
        except Exception:
            return {}, raw
