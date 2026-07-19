"""画像服务 — 读取最新画像 / 抽取画像 / 更新画像。"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..agents.profiler import ProfilerAgent
from ..models import Profile, Student


def get_latest_profile(db: Session, student_id: int) -> Profile | None:
    return (
        db.query(Profile)
        .filter(Profile.student_id == student_id)
        .order_by(Profile.version.desc(), Profile.created_at.desc())
        .first()
    )


def profile_to_dict(p: Profile | None) -> dict:
    if not p:
        return {}
    return dict(p.dimensions or {})


async def extract_profile_from_history(
    db: Session, student_id: int, conversation_text: str
) -> Profile:
    """从对话历史抽取画像并落库。"""
    agent = ProfilerAgent()
    data = await agent.extract_profile(conversation_text)

    latest = get_latest_profile(db, student_id)
    new_version = (latest.version + 1) if latest else 1

    p = Profile(
        student_id=student_id,
        version=new_version,
        dimensions=data,
        raw_summary=data.get("summary", ""),
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def upsert_profile(db: Session, student_id: int, dimensions: dict) -> Profile:
    """手动更新画像（合并到最新版本或新建）。"""
    latest = get_latest_profile(db, student_id)
    if latest:
        merged = dict(latest.dimensions or {})
        merged.update(dimensions)
        latest.dimensions = merged
        latest.raw_summary = merged.get("summary", latest.raw_summary or "")
        db.commit()
        db.refresh(latest)
        return latest
    p = Profile(student_id=student_id, version=1, dimensions=dimensions,
                raw_summary=dimensions.get("summary", ""))
    db.add(p)
    db.commit()
    db.refresh(p)
    return p
