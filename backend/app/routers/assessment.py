"""学习效果评估路由 — 功能5后端接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import AssessmentTrack
from ..services.assessment_service import assess, track_progress

router = APIRouter()


@router.post("/track")
def track(payload: AssessmentTrack, db: Session = Depends(get_db)) -> dict:
    p = track_progress(
        db,
        payload.student_id,
        payload.resource_id,
        payload.status,
        payload.score,
        payload.time_spent_min,
        payload.feedback,
    )
    return {"id": p.id, "status": "ok"}


@router.get("/{student_id}")
async def dashboard(student_id: int, db: Session = Depends(get_db)) -> dict:
    return await assess(db, student_id)
