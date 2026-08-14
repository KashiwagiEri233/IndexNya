"""思维宇宙路由 — 理解沉淀、评审、3D 图数据、锚点探测。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..llm.factory import reset_active_model, set_active_model
from ..models import Understanding
from ..schemas import AnchorOut, EvaluateRequest, UnderstandingOut, UniverseGraphOut
from ..services.profile_service import get_latest_profile, profile_to_dict
from ..services.universe_service import (
    build_graph,
    create_or_update_understanding,
    evaluate_summary,
    list_understandings,
    related_dicts,
)

router = APIRouter()


@router.post("/evaluate")
async def evaluate(payload: EvaluateRequest, db: Session = Depends(get_db)) -> dict:
    """评审学生用自己的话表达的理解；认可则存入思维宇宙。"""
    concept = payload.concept.strip()
    summary = payload.summary.strip()
    if not concept or not summary:
        raise HTTPException(400, "概念与理解内容不能为空")

    profile = profile_to_dict(get_latest_profile(db, payload.student_id))
    token = set_active_model(payload.model.model_dump(exclude_none=True) if payload.model else None)
    try:
        verdict = await evaluate_summary(concept, summary, profile)
    except Exception as exc:
        raise HTTPException(500, f"评审失败：{exc}")
    finally:
        reset_active_model(token)

    if not verdict.get("approved"):
        return {"approved": False, "score": verdict.get("score", 0), "feedback": verdict.get("feedback", ""), "missing": verdict.get("missing", []), "understanding": None}

    u = create_or_update_understanding(db, payload.student_id, concept, summary, verdict)
    return {
        "approved": True,
        "score": verdict.get("score", 0),
        "feedback": verdict.get("feedback", ""),
        "missing": verdict.get("missing", []),
        "understanding": UnderstandingOut.model_validate(u).model_dump(),
    }


@router.get("/{student_id}", response_model=list[UnderstandingOut])
def list_all(student_id: int, db: Session = Depends(get_db)) -> list[UnderstandingOut]:
    return [UnderstandingOut.model_validate(u) for u in list_understandings(db, student_id)]


@router.get("/{student_id}/graph", response_model=UniverseGraphOut)
def graph(student_id: int, db: Session = Depends(get_db)) -> dict:
    return build_graph(db, student_id)


@router.get("/{student_id}/anchors", response_model=AnchorOut)
def anchors(student_id: int, topic: str, db: Session = Depends(get_db)) -> dict:
    """锚点探测：讲解某新概念时会调用哪些已掌握的理解。"""
    return {
        "topic": topic,
        "anchors": related_dicts(db, student_id, topic, k=5),
    }


@router.delete("/{understanding_id}")
def delete(understanding_id: int, db: Session = Depends(get_db)) -> dict:
    u = db.get(Understanding, understanding_id)
    if not u:
        raise HTTPException(404, "understanding not found")
    db.delete(u)
    db.commit()
    return {"id": understanding_id, "status": "deleted"}
