"""学习路径服务。"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..agents.pathplanner import PathPlannerAgent
from ..models import LearningPath, Resource
from .profile_service import get_latest_profile, profile_to_dict


async def plan_path(db: Session, student_id: int, goal: str) -> LearningPath:
    agent = PathPlannerAgent()
    profile = profile_to_dict(get_latest_profile(db, student_id))
    # 提供已生成资源供节点引用
    available = (
        db.query(Resource)
        .filter(Resource.student_id == student_id, Resource.status == "completed")
        .order_by(Resource.created_at.desc())
        .limit(20)
        .all()
    )
    available_dicts = [{"id": r.id, "type": r.type, "title": r.title} for r in available]
    data = await agent.plan(goal, profile, available_resources=available_dicts)

    # 给节点回填真实 resource_ids（按 type 匹配）
    by_type: dict[str, list[int]] = {}
    for r in available:
        by_type.setdefault(r.type, []).append(r.id)
    for node in data.get("nodes", []):
        if not node.get("resource_ids"):
            types = node.get("resource_types", []) or []
            ids: list[int] = []
            for t in types:
                ids.extend(by_type.get(t, [])[:2])
            node["resource_ids"] = ids

    latest = (
        db.query(LearningPath)
        .filter(LearningPath.student_id == student_id)
        .order_by(LearningPath.version.desc())
        .first()
    )
    new_version = (latest.version + 1) if latest else 1

    lp = LearningPath(
        student_id=student_id,
        goal=goal,
        nodes=data.get("nodes", []),
        version=new_version,
    )
    db.add(lp)
    db.commit()
    db.refresh(lp)
    return lp


def get_latest_path(db: Session, student_id: int) -> LearningPath | None:
    return (
        db.query(LearningPath)
        .filter(LearningPath.student_id == student_id)
        .order_by(LearningPath.version.desc(), LearningPath.created_at.desc())
        .first()
    )
