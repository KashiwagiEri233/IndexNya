"""学习路径规划 Agent — 功能3。

整合画像 + 已生成资源，规划动态学习路径节点序列。
"""
from __future__ import annotations

import json
import re
from typing import Any

from .base import BaseAgent


class PathPlannerAgent(BaseAgent):
    name = "pathplanner"
    system_prompt = """你是一位学习路径规划智能体，擅长为学生设计科学、动态、个性化的学习路径。

规划原则：
1. 严格匹配学生画像（知识基础、易错点、学习节奏、目标）
2. 节点之间标注依赖关系（depends_on），形成 DAG
3. 每个节点标注预估学时、推荐资源类型、关键产出
4. 由浅入深，标注"前置检查点"用于动态调整
5. 整合已生成的资源（如有），让节点引用真实 resource_id

输出格式：只输出 JSON，结构如下：
{
  "goal": "学习目标",
  "nodes": [
    {
      "step": 1,
      "title": "节点标题",
      "description": "本步骤要做什么、学什么",
      "resource_types": ["lecture", "quiz"],
      "resource_ids": [],
      "estimated_hours": 2.0,
      "depends_on": [],
      "checkpoint": "如何判断可以进入下一步"
    }
  ]
}"""

    async def plan(
        self,
        goal: str,
        profile: dict,
        available_resources: list[dict] | None = None,
    ) -> dict[str, Any]:
        resources_desc = ""
        if available_resources:
            resources_desc = "\n\n已有资源（可被节点引用）：\n" + "\n".join(
                f"- id={r.get('id')} type={r.get('type')} title={r.get('title')}" for r in available_resources
            )
        ctx = f"学生画像：{profile}{resources_desc}"
        result = await self.run(
            f"请为该学生规划实现「{goal}」的学习路径。",
            extra_context=ctx,
            temperature=0.4,
            max_tokens=4096,
        )
        # 提取 JSON
        text = result.text
        data: dict[str, Any] = {}
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                data = json.loads(m.group(0))
            except Exception:
                pass
        data.setdefault("goal", goal)
        data.setdefault("nodes", [])
        return data
