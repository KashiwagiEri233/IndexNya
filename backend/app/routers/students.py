"""学生管理路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Student
from ..schemas import StudentCreate, StudentOut

router = APIRouter()


@router.post("", response_model=StudentOut)
def create_student(payload: StudentCreate, db: Session = Depends(get_db)) -> Student:
    s = Student(name=payload.name)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.get("/{student_id}", response_model=StudentOut)
def get_student(student_id: int, db: Session = Depends(get_db)) -> Student:
    s = db.get(Student, student_id)
    if not s:
        from fastapi import HTTPException
        raise HTTPException(404, "student not found")
    return s


@router.get("", response_model=list[StudentOut])
def list_students(db: Session = Depends(get_db)) -> list[Student]:
    return db.query(Student).order_by(Student.created_at.desc()).all()
