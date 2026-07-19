"""PPT 生成 Agent — 资源类型 ppt。

流程：LLM 把主题 + 学生画像组织成适合讯飞 PPT API 的 query 文本
     → 调用讯飞智能 PPT v2 API 在线生成 → 返回 pptUrl。
"""
from __future__ import annotations

import logging
from typing import Any

from ..llm.factory import chat_complete
from ..tools.xfyun_ppt import generate_ppt
from .base import BaseAgent

logger = logging.getLogger(__name__)


class PPTistAgent(BaseAgent):
    name = "pptist"
    system_prompt = """你是一位 PPT 策划智能体。任务：把知识点 + 学生画像组织成一段适合提交给 PPT 生成 API 的 query 文本。

要求：
1. query 文本要明确：PPT 主题、目标受众（专业/水平）、要点大纲、页数建议、风格倾向
2. 突出学生的薄弱点与易错点，让 PPT 有针对性
3. query 文本 200-600 字，要点列表式，便于 PPT API 理解分页
4. 只输出 query 文本本身，不要任何解释、前缀、代码块"""

    async def plan_query(self, topic: str, profile: dict) -> str:
        """根据主题和画像生成 PPT API 的 query 文本。"""
        ctx = f"学生画像：{profile}"
        text = await chat_complete(
            [
                {"role": "system", "content": self.system_prompt},
                {"role": "system", "content": ctx},
                {
                    "role": "user",
                    "content": f"请为知识点「{topic}」生成 PPT 的 query 文本。",
                },
            ],
            temperature=0.5,
            max_tokens=1024,
        )
        return text.strip()

    async def generate(
        self,
        topic: str,
        profile: dict,
        extra: str = "",
    ) -> dict[str, Any]:
        """端到端生成 PPT。返回 pptUrl 与 query。"""
        query = await self.plan_query(topic, profile)
        if extra:
            query = f"{query}\n\n额外要求：{extra}"
        try:
            result = await generate_ppt(query, is_card_note=True, is_figure=True)
            return {
                "topic": topic,
                "query": query,
                "ppt_url": result.get("ppt_url"),
                "sid": result.get("sid"),
                "status": "completed" if result.get("ppt_url") else "failed",
                "error": None if result.get("ppt_url") else "no ppt_url returned",
            }
        except Exception as e:
            logger.exception("ppt generation failed")
            return {
                "topic": topic,
                "query": query,
                "ppt_url": None,
                "status": "failed",
                "error": str(e),
            }
