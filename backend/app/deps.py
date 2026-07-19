"""FastAPI 依赖注入。"""
from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .db import get_db
from .models import Student


def get_student(student_id: int, db: Session = Depends(get_db)) -> Student:
    s = db.get(Student, student_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Student {student_id} not found")
    return s
