"""数据导出/导入（session log）的往返与重映射测试。"""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import (
    Conversation,
    ExploreCard,
    Literature,
    Message,
    PracticeRecord,
    Student,
    Understanding,
)
from app.services.data_service import export_data, import_data


def _make_db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _seed(db: Session) -> int:
    """插入一套完整数据，返回 student_id。"""
    student = Student(name="测试")
    db.add(student)
    db.flush()
    sid = student.id

    db.add_all([
        Conversation(id=1, student_id=sid, title="对话1", parent_conversation_id=None),
        Conversation(id=2, student_id=sid, title="分支", parent_conversation_id=1),
    ])
    db.flush()
    db.add_all([
        Message(id=1, conversation_id=1, role="user", content="你好", meta={}),
        Message(id=2, conversation_id=1, role="assistant", content="你好呀", meta={"terms": [{"text": "递归"}]}),
    ])
    db.add(ExploreCard(
        id=1, student_id=sid, conversation_id=1, parent_card_id=None,
        source_message_id=2, type="child", term="递归", context="上下文",
        branch_conversation_id=None, content={"messages": [{"role": "assistant", "content": "讲解"}]},
        status="completed",
    ))
    db.add(Literature(id=1, student_id=sid, title="文献", source_type="txt", text="正文", terms=[], meta={}))
    db.add(Understanding(
        id=1, student_id=sid, concept="递归", summary="自己调用自己", ai_score=80.0,
        ai_feedback="很好", status="approved", embedding=[0.1, 0.2], anchors=[], source={},
    ))
    db.add(PracticeRecord(
        id=1, student_id=sid, conversation_id=1, topic="算法", question="什么是递归？",
        options=[], answer="自调用", explanation="函数调用自身", is_correct=True,
    ))
    db.commit()
    return sid


def test_export_import_restore_roundtrip():
    db = _make_db()
    sid = _seed(db)

    data = export_data(db, sid)
    assert data["format"] == "indexnya-sessionlog"
    assert data["data"]["conversations"][0]["parent_conversation_id"] is None
    assert data["data"]["conversations"][1]["parent_conversation_id"] == 1

    result = import_data(db, sid, data, "restore")
    assert result["imported"]["conversations"] == 2
    assert result["imported"]["messages"] == 2

    # 数量一致
    assert db.query(Conversation).count() == 2
    assert db.query(Message).count() == 2
    assert db.query(ExploreCard).count() == 1
    assert db.query(Literature).count() == 1
    assert db.query(Understanding).count() == 1
    assert db.query(PracticeRecord).count() == 1

    # 外键关系完美保留（原始 id 不变）
    assert db.get(Conversation, 2).parent_conversation_id == 1
    card = db.get(ExploreCard, 1)
    assert card.conversation_id == 1
    assert card.source_message_id == 2
    msg = db.get(Message, 2)
    assert msg.meta["terms"][0]["text"] == "递归"


def test_import_merge_remaps_ids():
    db = _make_db()
    sid = _seed(db)

    # 制造冲突：文件里也含 id=1 的对话
    data = export_data(db, sid)
    data["data"]["conversations"] = [
        {"id": 1, "title": "导入的对话", "parent_conversation_id": None, "created_at": None},
    ]
    data["data"]["messages"] = [
        {"id": 1, "conversation_id": 1, "role": "user", "content": "导入消息", "meta": {}, "created_at": None},
    ]
    data["data"]["explore_cards"] = []
    data["data"]["literatures"] = []
    data["data"]["understandings"] = []
    data["data"]["practice_records"] = []

    result = import_data(db, sid, data, "merge")

    # 现有 2 个对话 + 新导入 1 个 = 3
    assert db.query(Conversation).count() == 3
    assert db.query(Message).count() == 3
    # 导入的对话获得新 id（不是 1），消息的 conversation_id 正确指向新 id
    imported_conv = db.query(Conversation).filter(Conversation.title == "导入的对话").first()
    assert imported_conv is not None
    assert imported_conv.id != 1
    imported_msg = db.query(Message).filter(Message.content == "导入消息").first()
    assert imported_msg is not None
    assert imported_msg.conversation_id == imported_conv.id
    # 原有数据未被破坏
    assert db.get(Conversation, 1).title == "对话1"


def test_import_rejects_wrong_format():
    db = _make_db()
    sid = _seed(db)
    try:
        import_data(db, sid, {"format": "something-else", "data": {}}, "merge")
        assert False, "应当抛出 ValueError"
    except ValueError as exc:
        assert "session log" in str(exc)
