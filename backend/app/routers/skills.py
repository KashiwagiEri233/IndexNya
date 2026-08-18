"""技能路由 — 供前端与主 Agent 查询可用技能目录。"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..skills.manager import get_skill, list_skills

router = APIRouter()


@router.get("")
def get_skills() -> list[dict]:
    """技能目录（不含正文指令）。"""
    return [
        {"name": s.name, "title": s.title, "description": s.description}
        for s in list_skills()
    ]


@router.get("/{name}")
def get_skill_detail(name: str) -> dict:
    """单个技能详情（含执行指令正文）。"""
    skill = get_skill(name)
    if not skill:
        raise HTTPException(404, f"skill not found: {name}")
    return {
        "name": skill.name,
        "title": skill.title,
        "description": skill.description,
        "content": skill.content,
    }