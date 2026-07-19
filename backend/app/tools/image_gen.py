"""讯飞文生图 tti API 调用工具。

参考：https://www.xfyun.cn/doc/spark/ImageGeneration.html

流程：HMAC-SHA256 鉴权（与视频 API 同套通用签名）→
     POST /v2.1/tti → 同步返回 base64 图片 → 落盘到 outputs/images/ → 返回本地访问 URL。

请求体：
    header.app_id
    parameter.chat.{domain: "general", width, height}
    payload.message.text[{role:"user", content: prompt}]

返回：
    payload.choices.text[0].content  # base64 图片数据
"""
from __future__ import annotations

import base64
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# 图片落盘目录
IMAGES_DIR = Path(__file__).resolve().parent.parent.parent / "outputs" / "images"


async def generate_image(prompt: str, width: int | None = None, height: int | None = None) -> dict[str, Any]:
    """调用讯飞 tti 生成图片。

    返回：
        {
          "prompt": ...,
          "image_path": 本地文件绝对路径,
          "image_url": "/api/resources/{id}/file" 形式由 service 填,
          "base64": 原始 base64（可选）,
          "status": "completed" | "failed",
          "error": ...,
        }
    """
    # 复用视频 API 的通用签名函数（传入图像功能的独立凭证）
    from .xfyun_video import _auth_url

    host = settings.image_host
    path = settings.image_path
    width = width or settings.image_width
    height = height or settings.image_height

    url = _auth_url(
        path, method="POST", host=host,
        api_key=settings.image_api_key, api_secret=settings.image_api_secret,
    )
    body = {
        "header": {"app_id": settings.image_app_id},
        "parameter": {
            "chat": {
                "domain": "general",
                "width": width,
                "height": height,
            }
        },
        "payload": {
            "message": {
                "text": [
                    {"role": "user", "content": prompt[:1000]},  # 文档限制 1000 字
                ]
            }
        },
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()

        code = data.get("header", {}).get("code", -1)
        if code != 0:
            return {
                "prompt": prompt,
                "status": "failed",
                "error": f"xfyun tti failed: {data}",
            }

        # payload.choices.text[0].content 是 base64
        choices = (data.get("payload") or {}).get("choices") or {}
        text_list = choices.get("text") or []
        if not text_list:
            return {"prompt": prompt, "status": "failed", "error": "no image in response"}

        b64 = text_list[0].get("content", "")
        if not b64:
            return {"prompt": prompt, "status": "failed", "error": "empty image content"}

        # 落盘
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^\w\u4e00-\u9fa5-]", "_", prompt)[:20] or "image"
        filename = f"{safe}_{int(time.time())}.png"
        file_path = IMAGES_DIR / filename
        # 文档提示用字节流写入，避免元数据丢失
        file_path.write_bytes(base64.b64decode(b64))

        return {
            "prompt": prompt,
            "image_path": str(file_path),
            "filename": filename,
            "status": "completed",
            "error": None,
        }
    except Exception as e:
        logger.exception("image generation failed")
        return {
            "prompt": prompt,
            "status": "failed",
            "error": str(e),
        }
