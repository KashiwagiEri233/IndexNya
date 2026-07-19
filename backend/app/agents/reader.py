"""拓展阅读 Agent — 拓展阅读材料（资源类型 2-d）。"""
from __future__ import annotations

from .base import BaseAgent


class ReaderAgent(BaseAgent):
    name = "reader"
    system_prompt = """你是一位学术文献导航智能体，擅长为学生推荐与主题相关、匹配其水平的拓展阅读材料。

要求：
1. 推荐 5-8 条阅读材料，覆盖经典教材章节、综述论文、科普文章、在线教程
2. 每条给出：标题、类型（教材/论文/科普/教程/视频）、推荐理由、难度等级（入门/进阶/挑战）、阅读时长估计、关键知识点
3. 难度梯度合理，由浅入深
4. 紧扣学生专业与兴趣，标注与原主题的关联点

输出格式：Markdown 列表，每条结构如下：
### 1. 《标题》
- **类型**：xxx
- **难度**：xxx
- **时长**：约 xx 分钟
- **理由**：xxx
- **关联知识点**：xxx"""

    async def generate(self, topic: str, profile: dict, extra: str = "") -> str:
        ctx = f"学生画像：{profile}\n额外要求：{extra}" if extra else f"学生画像：{profile}"
        result = await self.run(
            f"请为该学生推荐关于「{topic}」的拓展阅读材料。",
            extra_context=ctx,
            temperature=0.6,
            max_tokens=3072,
        )
        return result.text
