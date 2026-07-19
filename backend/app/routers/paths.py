"""学习路径路由 — 功能3后端接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import PathOut, PathPlanRequest
from ..services.path_service import get_latest_path, plan_path

router = APIRouter()


@router.post("/plan", response_model=PathOut)
async def plan(payload: PathPlanRequest, db: Session = Depends(get_db)) -> PathOut:
    lp = await plan_path(db, payload.student_id, payload.goal)
    return PathOut.model_validate(lp)


@router.get("/{student_id}", response_model=PathOut | None)
def get_path(student_id: int, db: Session = Depends(get_db)) -> PathOut | None:
    lp = get_latest_path(db, student_id)
    if not lp:
        return None
    return PathOut.model_validate(lp)
