"""LLM Provider 封装 — 基于讯飞星火 X1（OpenAI 兼容协议）。

切换 provider 只需改 .env 三行：
    LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
"""
from __future__ import annotations

from typing import Any, AsyncIterator, Optional

from openai import AsyncOpenAI

from ..config import settings


def get_llm() -> AsyncOpenAI:
    """获取异步 OpenAI 兼容客户端。

    星火 X1 配置：
        base_url = https://spark-api-open.xf-yun.com/v2/
        api_key  = 控制台 APIPassword
        model    = spark-x
    """
    return AsyncOpenAI(
        api_key=settings.llm_api_key or "missing",
        base_url=settings.llm_base_url,
        # 讯飞 X2 偶发 504，加长超时 + 自动重试 3 次
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
    llm = get_llm()
    kwargs: dict[str, Any] = dict(
        model=settings.llm_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if tools:
        kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
    resp = await llm.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


async def chat_stream(
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.7,
    max_tokens: int = 4096,
) -> AsyncIterator[str]:
    """流式补全，yield 增量文本 chunk。

    星火 X1 兼容 OpenAI SSE 格式：choices[0].delta.content
    """
    llm = get_llm()
    stream = await llm.chat.completions.create(
        model=settings.llm_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    async for chunk in stream:
        try:
            delta = chunk.choices[0].delta
            if delta and getattr(delta, "content", None):
                yield delta.content
        except (IndexError, AttributeError):
            continue


async def json_complete(
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    """请求 JSON 格式输出（星火遵循 prompt 指令）。

    我们在 messages 末尾追加 JSON 指令，并尝试解析。
    """
    prompt = messages[-1]["content"] if messages else ""
    messages = list(messages)
    messages[-1] = {
        **messages[-1],
        "content": prompt + "\n\n请只输出合法 JSON，不要 markdown 代码块包裹，不要解释。",
    }
    return await chat_complete(messages, temperature=temperature, max_tokens=max_tokens)
