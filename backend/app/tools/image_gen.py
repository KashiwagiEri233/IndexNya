"""OpenAI 兼容图片生成工具 — 使用前端选择的图片模型。"""
from __future__ import annotations

import base64
import re
import time
from pathlib import Path
from typing import Any

import httpx
from openai import AsyncOpenAI

IMAGES_DIR = Path(__file__).resolve().parent.parent.parent / "outputs" / "images"


async def generate_image(prompt: str, image_model: dict[str, Any] | None = None, *, size: str = "1024x1024") -> dict[str, Any]:
    """通过前端提供的 OpenAI 兼容图片模型生成图片并保存到本地。"""
    if not image_model:
        return {"prompt": prompt, "status": "failed", "error": "未配置图片生成模型，请先到设置中添加图片生成模型"}

    model_name = str(image_model.get("model") or "").strip()
    base_url = str(image_model.get("base_url") or "").strip()
    api_key = str(image_model.get("api_key") or "").strip()
    if not model_name or not base_url or not api_key:
        return {"prompt": prompt, "status": "failed", "error": "图片模型配置不完整，需要模型 ID、Base URL 和 API Key"}

    try:
        client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=180.0, max_retries=1)
        response = await client.images.generate(model=model_name, prompt=prompt[:2000], size=size)
        item = response.data[0] if response.data else None
        if not item:
            return {"prompt": prompt, "status": "failed", "error": "图片模型没有返回图片"}

        image_bytes: bytes | None = None
        if getattr(item, "b64_json", None):
            image_bytes = base64.b64decode(item.b64_json)
        elif getattr(item, "url", None):
            async with httpx.AsyncClient(timeout=120) as http:
                download = await http.get(item.url)
                download.raise_for_status()
                image_bytes = download.content
        if not image_bytes:
            return {"prompt": prompt, "status": "failed", "error": "图片模型返回中没有可下载的图片数据"}

        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^\w\u4e00-\u9fa5-]", "_", prompt)[:20] or "image"
        filename = f"{safe}_{int(time.time())}.png"
        file_path = IMAGES_DIR / filename
        file_path.write_bytes(image_bytes)
        return {"prompt": prompt, "image_path": str(file_path), "filename": filename, "status": "completed", "error": None}
    except Exception as exc:
        return {"prompt": prompt, "status": "failed", "error": str(exc)}
