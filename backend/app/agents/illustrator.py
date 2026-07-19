"""插图 Agent — 教学插图（资源类型 2-g）。

调用图像生成 API（兼容 OpenAI DALL·E 协议）为知识点生成插画式配图。
"""
from __future__ import annotations

from typing import Any

from ..llm.factory import chat_complete
from ..tools.image_gen import generate_image
from .base import BaseAgent


class IllustratorAgent(BaseAgent):
    name = "illustrator"
    system_prompt = """你是一位教学插画策划智能体，擅长为知识点设计配图描述。

要求：
1. 输出一段适合图像生成模型的英文 prompt（描述画面，不要中文）
2. 风格偏向教学示意图、信息图、扁平插画
3. 突出关键概念，画面简洁
4. 只输出 prompt 本身，不要解释"""

    async def plan_prompt(self, topic: str, profile: dict) -> str:
        ctx = f"学生画像（专业方向、认知风格）：{profile}"
        text = await chat_complete(
            [
                {"role": "system", "content": self.system_prompt},
                {"role": "system", "content": ctx},
                {"role": "user", "content": f"请为知识点「{topic}」设计配图 prompt。"},
            ],
            temperature=0.6,
            max_tokens=256,
        )
        return text.strip()

    async def generate(self, topic: str, profile: dict) -> dict[str, Any]:
        prompt = await self.plan_prompt(topic, profile)
        result = await generate_image(prompt)
        return {
            "topic": topic,
            "prompt": prompt,
            "image_path": result.get("image_path"),
            "filename": result.get("filename"),
            "status": result.get("status", "failed"),
            "error": result.get("error"),
        }
