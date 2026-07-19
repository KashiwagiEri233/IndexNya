"""画像路由 — 功能1后端接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import ProfileOut, ProfileUpdate
from ..services.profile_service import get_latest_profile, upsert_profile

router = APIRouter()


@router.get("/{student_id}", response_model=ProfileOut)
def get_profile(student_id: int, db: Session = Depends(get_db)) -> ProfileOut:
    p = get_latest_profile(db, student_id)
    if not p:
        raise HTTPException(404, "profile not found, please chat first")
    return ProfileOut.model_validate(p)


@router.put("/{student_id}", response_model=ProfileOut)
def update_profile(
    student_id: int,
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
) -> ProfileOut:
    p = upsert_profile(db, student_id, payload.dimensions)
    return ProfileOut.model_validate(p)
