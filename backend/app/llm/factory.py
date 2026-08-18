"""LLM Provider 封装 — 支持前端传入或 .env 显式配置的 OpenAI 兼容模型。"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any, AsyncIterator, Callable, Optional

from openai import AsyncOpenAI

from ..config import settings


# 每个请求独立的模型配置，避免并发对话互相覆盖。
_active_model: ContextVar[dict[str, Any] | None] = ContextVar("active_model", default=None)


def set_active_model(config: Optional[dict[str, Any]]):
    """为当前异步请求设置模型配置，返回可用于 reset 的 token。"""
    return _active_model.set(config or None)


def reset_active_model(token) -> None:
    _active_model.reset(token)


def _model_settings() -> tuple[str, str, str]:
    override = _active_model.get() or {}
    model = str(override.get("model") or settings.llm_model).strip()
    base_url = str(override.get("base_url") or settings.llm_base_url).strip()
    api_key = str(override.get("api_key") or settings.llm_api_key).strip()
    if not model or not base_url or not api_key:
        raise RuntimeError("未配置可用模型，请先在前端添加并选择模型，或在 .env 中显式配置 LLM_MODEL、LLM_BASE_URL 和 LLM_API_KEY")
    return model, base_url, api_key


_REASONING_LEVELS = {"minimal", "low", "medium", "high", "xhigh", "max"}


def _reasoning_effort() -> str | None:
    """当前请求的推理强度（off/minimal/low/medium/high/xhigh/max）；off 或未设置时不传参。"""
    override = _active_model.get() or {}
    effort = str(override.get("reasoning_effort") or "").strip().lower()
    return effort if effort in _REASONING_LEVELS else None


def get_llm() -> AsyncOpenAI:
    """获取当前请求对应的 OpenAI 兼容异步客户端。"""
    _, base_url, api_key = _model_settings()
    return AsyncOpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=120.0,
        max_retries=3,
    )


async def chat_complete(
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    tools: Optional[list[dict]] = None,
    tool_choice: Optional[str] = None,
) -> str:
    """非流式补全，返回完整文本。"""
    content, _ = await chat_complete_message(
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
        tools=tools,
        tool_choice=tool_choice,
    )
    return content


async def chat_complete_message(
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    tools: Optional[list[dict]] = None,
    tool_choice: Optional[str] = None,
) -> tuple[str, list[dict]]:
    """非流式补全，返回 (content, tool_calls)。

    tool_calls 为 [{id, name, arguments(str)}]；模型未调用工具时为空列表。
    """
    llm = get_llm()
    model, _, _ = _model_settings()
    kwargs: dict[str, Any] = dict(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if tools:
        kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
    effort = _reasoning_effort()
    if effort:
        kwargs["extra_body"] = {"reasoning_effort": effort}
    resp = await llm.chat.completions.create(**kwargs)
    message = resp.choices[0].message
    content = message.content or ""
    tool_calls: list[dict] = []
    for call in (message.tool_calls or []):
        try:
            name = call.function.name
            args = call.function.arguments or "{}"
        except AttributeError:
            continue
        tool_calls.append({"id": getattr(call, "id", None), "name": name, "arguments": args})
    return content, tool_calls


async def chat_stream(
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    tools: Optional[list[dict]] = None,
    tool_choice: Optional[str] = None,
    on_tool_calls: Optional[Callable[[list[dict]], None]] = None,
) -> AsyncIterator[str]:
    """流式补全，yield 增量文本 chunk。

    tools/tool_choice: 透传给模型（OpenAI 兼容 function calling）；
    on_tool_calls: 流结束后回调收集到的工具调用列表 [{name, arguments}]（无则空列表）。
    """
    llm = get_llm()
    model, _, _ = _model_settings()
    kwargs: dict[str, Any] = dict(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    if tools:
        kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
    effort = _reasoning_effort()
    if effort:
        kwargs["extra_body"] = {"reasoning_effort": effort}
    stream = await llm.chat.completions.create(**kwargs)
    tool_parts: dict[int, dict] = {}
    async for chunk in stream:
        try:
            delta = chunk.choices[0].delta
        except (IndexError, AttributeError):
            continue
        if delta and getattr(delta, "content", None):
            yield delta.content
        for call in (getattr(delta, "tool_calls", None) or []):
            try:
                idx = int(call.index)
            except (TypeError, ValueError):
                idx = len(tool_parts)
            part = tool_parts.setdefault(idx, {"name": "", "arguments": ""})
            fn = getattr(call, "function", None)
            if fn is not None:
                if getattr(fn, "name", None):
                    part["name"] += fn.name
                if getattr(fn, "arguments", None):
                    part["arguments"] += fn.arguments
    if on_tool_calls is not None:
        on_tool_calls([
            {"name": part["name"], "arguments": part["arguments"]}
            for _, part in sorted(tool_parts.items())
        ])


async def json_complete(
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    """请求 JSON 格式输出。"""
    prompt = messages[-1]["content"] if messages else ""
    messages = list(messages)
    messages[-1] = {
        **messages[-1],
        "content": prompt + "\n\n请只输出合法 JSON，不要 markdown 代码块包裹，不要解释。",
    }
    return await chat_complete(messages, temperature=temperature, max_tokens=max_tokens)
