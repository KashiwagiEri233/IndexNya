"""图片理解 Agent — 使用文本模型的多模态能力。

流程：用户上传图片 + 提问
     → 把图片转成 base64 data URL，随问题一起发给当前选择的文本模型
     → 返回模型的针对性解答（不再依赖讯飞或其他图像专用 API）

要求：当前使用的文本模型需支持 OpenAI 兼容的 vision 输入
      （即 content 数组中的 image_url 类型）。
"""
from __future__ import annotations

import base64
import logging
from typing import Any

from ..llm.factory import chat_complete
from .base import BaseAgent

logger = logging.getLogger(__name__)


class ImageReaderAgent(BaseAgent):
    name = "image_reader"
    system_prompt = """你是一位图片理解辅导智能体。学生会上传图片（题目、图表、代码截图、教学插图等）并提出问题。
请直接查看图片内容，结合学生画像（专业、薄弱点、认知风格）做针对性解答。

任务：
1. 先简要描述图片里有什么（题目/图表的关键信息）
2. 再针对学生的问题给出结构化、易于理解的解答（必要时分步骤）
3. 若图片信息不足以完整作答，明确指出缺少什么，并提示用户补充

回答要求：
- 用中文，语气鼓励
- 直接基于图片内容回答，不要泛泛而谈
- 标注图片中的关键信息"""

    async def understand(
        self,
        image_bytes: bytes,
        question: str,
        content_type: str = "image/jpeg",
        history: list[dict] | None = None,
    ) -> dict[str, Any]:
        """端到端图片理解（文本模型多模态）。

        返回：
            {
              "recognition": 模型对图片内容的简要描述（可为空）,
              "answer": 模型针对性解答,
              "question": 用户问题,
              "status": "completed" | "failed",
              "error": ...,
            }
        """
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        data_url = f"data:{content_type};base64,{image_b64}"

        user_content: list[dict[str, Any]] = [
            {"type": "text", "text": question or "请描述这张图片并解释相关知识点"},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]

        try:
            answer = await chat_complete(
                [
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.5,
                max_tokens=2048,
            )
        except Exception as e:
            logger.exception("multimodal image understanding failed")
            return {
                "recognition": None,
                "answer": None,
                "question": question,
                "status": "failed",
                "error": f"图片理解失败：{e}",
            }

        if not (answer or "").strip():
            return {
                "recognition": None,
                "answer": None,
                "question": question,
                "status": "failed",
                "error": "模型没有返回有效内容（当前模型可能不支持图片输入）",
            }

        return {
            "recognition": None,
            "answer": answer,
            "question": question,
            "status": "completed",
            "error": None,
        }