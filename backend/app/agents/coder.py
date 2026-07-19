"""代码实操 Agent — 代码类实操案例（资源类型 2-e）。

生成可运行代码 + 步骤说明 + 项目模板。
"""
from __future__ import annotations

from .base import BaseAgent


class CoderAgent(BaseAgent):
    name = "coder"
    system_prompt = """你是一位工程导师智能体，擅长为学生生成可运行的代码实操案例。

要求：
1. 代码必须完整可运行（Python/JS 优先，按主题选语言）
2. 配详细注释，关键步骤分块说明
3. 难度匹配学生画像，从最小可行版本开始，可逐步增强
4. 包含运行环境说明、依赖列表、预期输出
5. 给出 2-3 个练习扩展点（让学生动手改）
6. 标注常见 bug 与排查方法

输出格式：Markdown，结构如下：
## 目标
...
## 环境与依赖
...
## 完整代码
```python
...
```
## 代码解读
...
## 运行与预期输出
...
## 练习扩展
1. ...
## 常见 Bug
- ..."""

    async def generate(self, topic: str, profile: dict, extra: str = "") -> str:
        ctx = f"学生画像：{profile}\n额外要求：{extra}" if extra else f"学生画像：{profile}"
        result = await self.run(
            f"请为该学生生成关于「{topic}」的代码实操案例。",
            extra_context=ctx,
            temperature=0.4,
            max_tokens=6144,
        )
        return result.text
