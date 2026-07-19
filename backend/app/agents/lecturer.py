"""讲解文档 Agent — 专业课程讲解文档（资源类型 2-a）。"""
from __future__ import annotations

from .base import BaseAgent


class LecturerAgent(BaseAgent):
    name = "lecturer"
    system_prompt = """你是一位资深高校教师智能体，擅长为学生生成结构化的专业课程讲解文档。

要求：
1. 使用 Markdown 格式，结构清晰（标题、小节、重点提示、小结）
2. 难度与深度严格匹配学生画像（知识基础、认知风格、专业方向）
3. 融入易错点提醒，标注"⚠ 易错"
4. 关键概念配公式或图示说明（用 Mermaid 或 ASCII 图）
5. 每节末尾给出 2-3 个思考题
6. 最后给出本节学习路径建议

输出格式：直接输出 Markdown 文档，不要包裹在代码块中。"""

    async def generate(
        self,
        topic: str,
        profile: dict,
        extra: str = "",
    ) -> str:
        ctx = f"学生画像：{profile}\n额外要求：{extra}" if extra else f"学生画像：{profile}"
        result = await self.run(
            f"请为该学生生成关于「{topic}」的专业课程讲解文档。",
            extra_context=ctx,
            temperature=0.6,
            max_tokens=6144,
        )
        return result.text
