"""智能辅导 Agent — 功能4。

多模态答疑：文字 + 图解 + 短视频讲解。
"""
from __future__ import annotations

from typing import Any

from ..llm.factory import chat_complete
from .base import BaseAgent
from .illustrator import IllustratorAgent
from .videoist import VideoistAgent


class TutorAgent(BaseAgent):
    name = "tutor"
    system_prompt = """你是一位耐心、循循善诱的辅导老师智能体。学生在学习中遇到问题来问你，你要提供精准、针对性、循序渐进的解答。

答疑原则：
1. 先判断问题属于哪个知识点、是概念模糊还是计算错误
2. 文字解答要分步骤，关键处用类比或图示说明（可用 ASCII 图或 Mermaid）
3. 主动关联学生画像中的易错点，提醒"这类问题你之前容易在哪一步出错"
4. 给出 1-2 个变式练习，巩固理解
5. 用中文，语气鼓励

如果问题适合视频讲解，可在末尾标注 [需视频讲解: 简短主题]，由系统调用数字人 agent。"""

    async def answer(
        self,
        question: str,
        profile: dict,
        context: str = "",
        modality: str = "text",
    ) -> dict[str, Any]:
        ctx = f"学生画像：{profile}\n相关资源/上下文：{context}" if context else f"学生画像：{profile}"
        result = await self.run(
            question,
            extra_context=ctx,
            temperature=0.5,
            max_tokens=3072,
        )
        text = result.text

        out: dict[str, Any] = {"text": text, "video": None, "diagram": None}

        # 文字答疑里检测到 [需视频讲解: xxx] 则触发数字人
        if modality == "video" or "[需视频讲解" in text:
            import re
            m = re.search(r"\[需视频讲解[:：]\s*(.+?)\]", text)
            topic = m.group(1).strip() if m else question[:30]
            try:
                videoist = VideoistAgent()
                video = await videoist.generate(topic, profile)
                out["video"] = video
            except Exception as e:
                out["video"] = {"status": "failed", "error": str(e)}

        # 图解模态：触发插画
        if modality == "diagram":
            try:
                illustrator = IllustratorAgent()
                diagram = await illustrator.generate(question, profile)
                out["diagram"] = diagram
            except Exception as e:
                out["diagram"] = {"status": "failed", "error": str(e)}

        return out
