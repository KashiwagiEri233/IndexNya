"""思维导图 Agent — 知识点思维导图（资源类型 2-b）。

输出 Markdown 大纲格式（# / ## / ### / -），后端解析为树结构，
前端渲染为可展开折叠的树状图。
"""
from __future__ import annotations

import re
from typing import Any

from .base import BaseAgent


class MindmapAgent(BaseAgent):
    name = "mindmap"
    system_prompt = """你是一位知识可视化智能体，擅长把复杂知识结构化为思维导图大纲。

要求：
1. 输出 Markdown 大纲格式（用 # / ## / ### 表示层级，- 表示列表要点）
2. 层级 3-4 层：# 根主题，## 二级知识模块，### 三级知识点，- 四级关键细节
3. 节点文字简洁（每项 <15 字）
4. 用 | 分隔同级并列要点（如：时间复杂度 | 空间复杂度）
5. 覆盖该主题的核心知识体系，结构清晰

输出格式：直接输出 Markdown 大纲，不要包裹在代码块中，不要前后解释。"""

    async def generate(self, topic: str, profile: dict, extra: str = "") -> dict:
        ctx = f"学生画像：{profile}\n额外要求：{extra}" if extra else f"学生画像：{profile}"
        result = await self.run(
            f"请为该学生生成关于「{topic}」的知识点思维导图大纲。",
            extra_context=ctx,
            temperature=0.4,
            max_tokens=3072,
        )
        markdown = result.text.strip()
        # 去掉可能的代码块包裹
        m = re.search(r"```(?:markdown)?\s*(.*?)\s*```", markdown, re.DOTALL)
        if m:
            markdown = m.group(1).strip()
        tree = _parse_markdown_outline(markdown, topic)
        return {"markdown": markdown, "tree": tree}


def _parse_markdown_outline(markdown: str, default_title: str) -> dict[str, Any]:
    """把 Markdown 大纲解析为树结构。

    标题用 # 计 level（1-6）；列表项用 (indent//2 + 标题基准 level + 1) 计 level。
    相同 level 互为兄弟，更深 level 为子节点。
    """
    lines = markdown.split("\n")
    root: dict[str, Any] = {"title": default_title, "children": []}
    # 栈：(level, node)；用栈维护当前各层祖先链
    stack: list[tuple[int, dict]] = [(0, root)]

    def _add_node(level: int, node: dict) -> None:
        # 弹出 level >= 当前的栈顶（找父节点）
        while len(stack) > 1 and stack[-1][0] >= level:
            stack.pop()
        stack[-1][1]["children"].append(node)
        stack.append((level, node))

    # 当前最近标题的 level（列表项以此为基准）
    last_heading_level = 0

    for raw_line in lines:
        line = raw_line.rstrip()
        if not line.strip():
            continue
        # 标题
        m = re.match(r"^(#{1,6})\s+(.+)$", line)
        if m:
            level = len(m.group(1))
            last_heading_level = level
            # 标题入栈前先清掉比它浅的列表项栈
            while len(stack) > 1 and stack[-1][0] >= level:
                stack.pop()
            node = {"title": m.group(2).strip(), "children": []}
            stack[-1][1]["children"].append(node)
            stack.append((level, node))
            continue
        # 列表项
        m = re.match(r"^(\s*)[-*+]\s+(.+)$", line)
        if m:
            indent = len(m.group(1))
            text = m.group(2).strip()
            # 列表 level：标题基准 + 1 + indent//2
            level = last_heading_level + 1 + indent // 2
            parts = [p.strip() for p in text.split("|") if p.strip()]
            for part in parts:
                node = {"title": part, "children": []}
                _add_node(level, node)
            continue
        # 普通文本行
        text = line.strip()
        if text:
            level = last_heading_level + 1
            parts = [p.strip() for p in text.split("|") if p.strip()]
            for part in parts:
                node = {"title": part, "children": []}
                _add_node(level, node)

    if not root["children"]:
        root["markdown_fallback"] = markdown
    return root
