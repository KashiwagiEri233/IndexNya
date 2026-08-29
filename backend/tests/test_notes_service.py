"""对话导出为笔记/思维导图（direct 模式）测试。"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import Conversation, Message, Student
from app.services.notes_service import export_notes


def _make_db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _seed(db: Session) -> int:
    student = Student(name="测试")
    db.add(student)
    db.flush()
    sid = student.id
    conv = Conversation(id=1, student_id=sid, title="二叉树学习")
    db.add(conv)
    db.flush()
    db.add_all([
        Message(id=1, conversation_id=1, role="user", content="什么是二叉树？"),
        Message(id=2, conversation_id=1, role="assistant", content="二叉树是一种每个节点最多有两个子节点的树结构。"),
    ])
    db.commit()
    return sid


def test_export_notes_direct_both():
    db = _make_db()
    _seed(db)
    result = asyncio.run(export_notes(db, [1], fmt="both", mode="direct"))
    assert result["filename"].endswith(".md")
    assert "# IndexNya 学习笔记" in result["content"]
    assert "二叉树学习" in result["content"]
    assert "什么是二叉树？" in result["content"]
    assert "```mermaid" in result["content"]
    assert "mindmap" in result["content"]


def test_export_notes_direct_notes_only():
    db = _make_db()
    _seed(db)
    result = asyncio.run(export_notes(db, [1], fmt="notes", mode="direct"))
    assert "# IndexNya 学习笔记" in result["content"]
    assert "```mermaid" not in result["content"]


def test_export_notes_direct_mindmap_only():
    db = _make_db()
    _seed(db)
    result = asyncio.run(export_notes(db, [1], fmt="mindmap", mode="direct"))
    assert "```mermaid" in result["content"]
    assert "# IndexNya 学习笔记" not in result["content"]


def test_export_notes_requires_selection():
    db = _make_db()
    _seed(db)
    with pytest.raises(ValueError):
        asyncio.run(export_notes(db, [], fmt="both", mode="direct"))
