"""本地单用户 — 全应用共用一个学生，不区分多用户。

项目定位为本地单用户工具：所有数据挂在同一个本地学生上，
该学生在首次使用时自动创建（已有数据库则复用最早的一条）。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Student


def get_local_student(db: Session) -> Student:
    """返回唯一的本地学生；不存在则自动创建。"""
    student = db.query(Student).order_by(Student.id.asc()).first()
    if student is None:
        student = Student(name="本地用户")
        db.add(student)
        db.commit()
        db.refresh(student)
    return student


def get_local_student_id(db: Session) -> int:
    """返回本地学生的 id（student_id 参数缺省时使用）。"""
    return get_local_student(db).id