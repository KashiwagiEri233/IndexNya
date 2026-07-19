"""讯飞图片理解 API 调用工具 — WebSocket 协议。

参考：https://www.xfyun.cn/doc/spark/ImageUnderstanding.html

流程：HMAC-SHA256 鉴权 URL（与 tti 同套通用签名，复用 IMAGE_* 凭证）
     → wss 连接 → 发送 {header.app_id, parameter.chat.domain,
                       payload.message.text[{role:user,content:base64,content_type:image},
                                            {role:user,content:question}]}
     → 流式接收 payload.choices.text[].content，status==2 结束。

约束：图片 jpg/jpeg/png ≤ 4MB，base64 传入。
"""
from __future__ import annotations

import base64
import json
import logging
from pathlib import Path
from typing import AsyncIterator

import websockets

from ..config import settings
from .xfyun_video import _auth_url

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 4 * 1024 * 1024  # 4MB


def _ws_auth_url() -> str:
    """生成 wss 鉴权 URL。

    _auth_url 默认返回 https://，讯飞 ws 接口需替换为 wss://。
    """
    url = _auth_url(
        settings.image_understanding_path,
        method="GET",  # WebSocket 握手用 GET
        host=settings.image_host,
        api_key=settings.image_api_key,
        api_secret=settings.image_api_secret,
    )
    return url.replace("https://", "wss://", 1)


def _build_payload(image_b64: str, question: str, history: list[dict] | None = None) -> dict:
    """构建请求 payload。

    讯飞图片理解多轮规则：首条必须是图片，最后一条是 user 当前问题。
    history 格式：[{role, content, content_type?}]
    """
    text: list[dict] = []
    # 首条图片
    text.append({"role": "user", "content": image_b64, "content_type": "image"})
    # 历史（若有多轮，按 user->assistant 顺序拼接）
    if history:
        for h in history:
            text.append({
                "role": h.get("role", "user"),
                "content": h.get("content", ""),
                "content_type": h.get("content_type", "text"),
            })
    # 当前问题
    text.append({"role": "user", "content": question})

    return {
        "header": {"app_id": settings.image_app_id},
        "parameter": {
            "chat": {
                "domain": settings.image_understanding_domain,
                "temperature": 0.5,
                "top_k": 4,
                "max_tokens": 2028,
            }
        },
        "payload": {"message": {"text": text}},
    }


async def understand_image(
    image_bytes: bytes,
    question: str,
    history: list[dict] | None = None,
) -> str:
    """同步接收完整识别结果（聚合所有分片）。"""
    result = ""
    async for chunk in understand_image_stream(image_bytes, question, history):
        result += chunk
    return result


async def understand_image_stream(
    image_bytes: bytes,
    question: str,
    history: list[dict] | None = None,
) -> AsyncIterator[str]:
    """流式接收识别结果，yield 增量文本 chunk。

    会自动校验图片大小，转 base64。
    """
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError(f"image too large: {len(image_bytes)} bytes (max 4MB)")

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = _build_payload(image_b64, question, history)
    ws_url = _ws_auth_url()

    logger.info("connecting xfyun image understanding ws: %s", ws_url[:60] + "...")
    # proxy=None 显式禁用系统代理检测（websockets 默认会读系统代理）
    async with websockets.connect(ws_url, max_size=8 * 1024 * 1024, proxy=None) as ws:
        await ws.send(json.dumps(payload, ensure_ascii=False))
        while True:
            try:
                resp = await ws.recv()
            except websockets.exceptions.ConnectionClosed:
                break
            data = json.loads(resp)
            header = data.get("header", {})
            code = header.get("code", -1)
            if code != 0:
                raise RuntimeError(f"xfyun image understanding failed: {data}")
            choices = (data.get("payload") or {}).get("choices") or {}
            status = choices.get("status", 0)
            text_list = choices.get("text") or []
            for t in text_list:
                content = t.get("content", "")
                if content:
                    yield content
            if status == 2:
                break


async def understand_image_file(
    image_path: str | Path,
    question: str,
    history: list[dict] | None = None,
) -> str:
    """便利方法：从文件读取图片并理解。"""
    data = Path(image_path).read_bytes()
    return await understand_image(data, question, history)
