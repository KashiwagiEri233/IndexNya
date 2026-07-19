"""图片理解 Agent — 资源类型 image_understanding。

流程：用户上传图片 + 提问
     → 调讯飞图片理解 API 识别图片内容
     → 用 LLM 结合学生画像把识别结果转化为针对性解答
"""
from __future__ import annotations

import logging
from typing import Any

from ..llm.factory import chat_complete
from ..tools.xfyun_image_understanding import understand_image
from .base import BaseAgent

logger = logging.getLogger(__name__)


class ImageReaderAgent(BaseAgent):
    name = "image_reader"
    system_prompt = """你是一位图片理解辅导智能体。学生会上传图片（题目、图表、代码截图、教学插图等）并提出问题。

你的任务：
1. 接收图片识别的原始内容（由讯飞图片理解 API 提供）
2. 结合学生画像（专业、薄弱点、认知风格）做针对性解答
3. 输出结构化、易于理解的回答（必要时分步骤、配图示说明）

回答要求：
- 用中文，语气鼓励
- 直接基于识别内容回答，不要泛泛而谈
- 标注识别内容里的关键信息
- 若识别内容不完整，可提示用户补充上下文"""

    async def understand(
        self,
        image_bytes: bytes,
        question: str,
        profile: dict,
        history: list[dict] | None = None,
    ) -> dict[str, Any]:
        """端到端图片理解。

        返回：
            {
              "recognition": 讯飞原始识别结果,
              "answer": LLM 润色后的针对性解答,
              "question": 用户问题,
              "status": "completed" | "failed",
              "error": ...,
            }
        """
        # 1. 调讯飞图片理解
        try:
            recognition = await understand_image(image_bytes, question, history)
        except Exception as e:
            logger.exception("image understanding failed")
            return {
                "recognition": None,
                "answer": None,
                "question": question,
                "status": "failed",
                "error": f"图片识别失败：{e}",
            }

        # 2. LLM 结合画像做针对性解答
        ctx = f"学生画像：{profile}\n\n图片识别内容：\n{recognition}"
        try:
            answer = await chat_complete(
                [
                    {"role": "system", "content": self.system_prompt},
                    {"role": "system", "content": ctx},
                    {"role": "user", "content": question},
                ],
                temperature=0.5,
                max_tokens=2048,
            )
        except Exception as e:
            logger.exception("answer generation failed")
            answer = recognition  # 兜底：直接返回识别内容

        return {
            "recognition": recognition,
            "answer": answer,
            "question": question,
            "status": "completed",
            "error": None,
        }
