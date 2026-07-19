"""题库 Agent — 不同类型练习题目（资源类型 2-c）。

支持题型：单选 / 多选 / 判断 / 简答 / 编程
"""
from __future__ import annotations

import json
import re

from .base import BaseAgent


class QuizmasterAgent(BaseAgent):
    name = "quizmaster"
    system_prompt = """你是一位命题专家智能体，擅长根据学生画像生成针对性练习题库。

要求：
1. 题目难度匹配学生知识基础与易错点偏好，刻意覆盖易错点
2. 题型多样：单选、多选、判断、简答、编程（按主题选择合适的题型组合）
3. 每道题必须有标准答案和详细解析（点明考的什么、为什么这样选、易错点）
4. 简答题给出评分要点（3-5 条）
5. 编程题给出参考代码和测试用例

输出格式：只输出 JSON，结构如下：
{
  "topic": "主题",
  "questions": [
    {
      "id": 1,
      "type": "single_choice",  // single_choice/multiple_choice/true_false/short_answer/coding
      "stem": "题干",
      "options": {"A": "...", "B": "..."},  // 选择题才有
      "answer": "B",  // 选择题为字母，判断题为 true/false，简答/编程为参考答案文本
      "analysis": "解析",
      "key_points": ["要点1", "要点2"],  // 简答题
      "reference_code": "...",  // 编程题
      "test_cases": [{"input": "...", "expected": "..."}]  // 编程题
    }
  ]
}"""

    async def generate(self, topic: str, profile: dict, extra: str = "") -> dict:
        ctx = f"学生画像：{profile}\n额外要求：{extra}" if extra else f"学生画像：{profile}"
        result = await self.run(
            f"请为该学生生成关于「{topic}」的练习题库（5-8 道题，题型组合）。",
            extra_context=ctx,
            temperature=0.4,
            max_tokens=4096,
        )
        # 尝试提取 JSON
        text = result.text
        data = {}
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
            except Exception:
                pass
        return {"topic": topic, "questions": data.get("questions", []), "markdown": text}
