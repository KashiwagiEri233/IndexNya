"""教学插图 Agent — 使用前端选择的图片模型生成本地图片。"""
from __future__ import annotations

from typing import Any

from ..tools.image_gen import generate_image
from .base import BaseAgent


class IllustratorAgent(BaseAgent):
    name = "illustrator"

    async def generate(
        self,
        topic: str,
        profile: dict,
        image_model: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        # 不再调用文本模型，直接使用稳定的教学插图提示模板。
        prompt = (
            f"Educational flat vector illustration about {topic}. "
            "Clean composition, clear labels, simple shapes, soft teal and coral palette, "
            "white background, suitable for a university learning slide, no photorealism, no watermark."
        )
        result = await generate_image(prompt, image_model)
        return {
            "topic": topic,
            "prompt": prompt,
            "image_path": result.get("image_path"),
            "filename": result.get("filename"),
            "status": result.get("status", "failed"),
            "error": result.get("error"),
        }
