"""技能系统 — 让主 Agent 能按需加载并使用 Markdown 定义的技能。"""
from .manager import Skill, get_skill, list_skills

__all__ = ["Skill", "get_skill", "list_skills"]