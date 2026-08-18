"""错题本路由 — 互动刷题历史（题目/对错/解析）的查询与管理。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import PracticeRecord

router = APIRouter()


def _to_dict(r: PracticeRecord) -> dict:
    return {
        "id": r.id,
        "student_id": r.student_id,
        "conversation_id": r.conversation_id,
        "topic": r.topic or "",
        "question": r.question,
        "options": r.options or [],
        "answer": r.answer or "",
        "explanation": r.explanation or "",
        "is_correct": r.is_correct,  # None = 未作答
        "asked_at": r.asked_at.isoformat(),
        "answered_at": r.answered_at.isoformat() if r.answered_at else None,
    }


@router.get("")
def list_records(
    student_id: int,
    filter: str = Query("all", pattern="^(all|wrong|right|pending)$"),
    db: Session = Depends(get_db),
) -> list[dict]:
    """错题本列表。filter: all / wrong（答错）/ right（答对）/ pending（未作答）。"""
    q = db.query(PracticeRecord).filter(PracticeRecord.student_id == student_id)
    if filter == "pending":
        q = q.filter(PracticeRecord.is_correct.is_(None))
    elif filter in ("wrong", "right"):
        q = q.filter(PracticeRecord.is_correct.is_not(None), PracticeRecord.is_correct == (filter == "right"))
    return [_to_dict(r) for r in q.order_by(PracticeRecord.id.desc()).all()]


@router.delete("/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db)) -> dict:
    """删除单条错题记录。"""
    record = db.get(PracticeRecord, record_id)
    if not record:
        raise HTTPException(404, "practice record not found")
    db.delete(record)
    db.commit()
    return {"deleted_id": record_id}


@router.delete("")
def clear_records(student_id: int, db: Session = Depends(get_db)) -> dict:
    """清空该学生的全部错题记录。"""
    count = (
        db.query(PracticeRecord)
        .filter(PracticeRecord.student_id == student_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted_count": count}