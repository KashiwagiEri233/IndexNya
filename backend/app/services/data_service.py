"""数据导出/导入 — session log 全量备份与恢复。

导出：把本地单用户的全部数据序列化为 JSON（不含 student_id，导入时重新绑定）。
导入：两种模式
  restore — 覆盖恢复：清空现有数据，用文件原始 ID 重建（外键关系天然保持）
  merge   — 合并追加：保留现有数据，为导入记录分配新 ID 并重映射全部外键
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    Conversation,
    ExploreCard,
    Literature,
    Message,
    PracticeRecord,
    Understanding,
)

logger = logging.getLogger(__name__)

FORMAT = "indexnya-sessionlog"
VERSION = 1

_EXPORT_MODELS = [
    "conversations",
    "messages",
    "explore_cards",
    "literatures",
    "understandings",
    "practice_records",
]


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _dt(value: Any) -> datetime | None:
    """解析 iso 时间字符串（兼容 Z 后缀）；失败返回 None。"""
    if not value:
        return None
    s = str(value)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def export_data(db: Session, student_id: int) -> dict[str, Any]:
    """导出该学生的全部数据为可下载的 JSON 结构。"""
    conversations = (
        db.query(Conversation)
        .filter(Conversation.student_id == student_id)
        .order_by(Conversation.id.asc())
        .all()
    )
    conv_ids = [c.id for c in conversations]
    messages = (
        db.query(Message)
        .filter(Message.conversation_id.in_(conv_ids))
        .order_by(Message.id.asc())
        .all()
    ) if conv_ids else []
    explore_cards = (
        db.query(ExploreCard)
        .filter(ExploreCard.student_id == student_id)
        .order_by(ExploreCard.id.asc())
        .all()
    )
    literatures = (
        db.query(Literature)
        .filter(Literature.student_id == student_id)
        .order_by(Literature.id.asc())
        .all()
    )
    understandings = (
        db.query(Understanding)
        .filter(Understanding.student_id == student_id)
        .order_by(Understanding.id.asc())
        .all()
    )
    practice_records = (
        db.query(PracticeRecord)
        .filter(PracticeRecord.student_id == student_id)
        .order_by(PracticeRecord.id.asc())
        .all()
    )

    return {
        "format": FORMAT,
        "version": VERSION,
        "exported_at": datetime.utcnow().isoformat(),
        "data": {
            "conversations": [
                {"id": c.id, "title": c.title, "parent_conversation_id": c.parent_conversation_id, "created_at": _iso(c.created_at)}
                for c in conversations
            ],
            "messages": [
                {"id": m.id, "conversation_id": m.conversation_id, "role": m.role, "content": m.content, "meta": m.meta or {}, "created_at": _iso(m.created_at)}
                for m in messages
            ],
            "explore_cards": [
                {
                    "id": c.id, "conversation_id": c.conversation_id, "parent_card_id": c.parent_card_id,
                    "source_message_id": c.source_message_id, "type": c.type, "term": c.term,
                    "context": c.context, "branch_conversation_id": c.branch_conversation_id,
                    "content": c.content, "status": c.status, "created_at": _iso(c.created_at),
                }
                for c in explore_cards
            ],
            "literatures": [
                {"id": l.id, "title": l.title, "source_type": l.source_type, "text": l.text, "terms": l.terms or [], "meta": l.meta or {}, "created_at": _iso(l.created_at)}
                for l in literatures
            ],
            "understandings": [
                {"id": u.id, "concept": u.concept, "summary": u.summary, "ai_score": u.ai_score, "ai_feedback": u.ai_feedback,
                 "status": u.status, "embedding": u.embedding or [], "anchors": u.anchors or [], "source": u.source or {}, "created_at": _iso(u.created_at)}
                for u in understandings
            ],
            "practice_records": [
                {"id": r.id, "conversation_id": r.conversation_id, "topic": r.topic, "question": r.question,
                 "options": r.options or [], "answer": r.answer, "explanation": r.explanation,
                 "is_correct": r.is_correct, "asked_at": _iso(r.asked_at), "answered_at": _iso(r.answered_at)}
                for r in practice_records
            ],
        },
    }


def _clear_student_data(db: Session, student_id: int) -> None:
    """清空该学生的全部数据（restore 覆盖前调用）。"""
    db.query(ExploreCard).filter(ExploreCard.student_id == student_id).delete(synchronize_session=False)
    conv_ids = [c.id for c in db.query(Conversation).filter(Conversation.student_id == student_id).all()]
    if conv_ids:
        db.query(Message).filter(Message.conversation_id.in_(conv_ids)).delete(synchronize_session=False)
        db.query(PracticeRecord).filter(PracticeRecord.conversation_id.in_(conv_ids)).delete(synchronize_session=False)
    db.query(Conversation).filter(Conversation.student_id == student_id).delete(synchronize_session=False)
    db.query(Literature).filter(Literature.student_id == student_id).delete(synchronize_session=False)
    db.query(Understanding).filter(Understanding.student_id == student_id).delete(synchronize_session=False)
    db.commit()


def _restore(db: Session, student_id: int, payload: dict) -> dict[str, int]:
    """覆盖恢复：按文件原始 ID 直接重建（student_id 重绑定到当前学生）。"""
    _clear_student_data(db, student_id)
    now = datetime.utcnow()

    conversations = payload.get("conversations") or []
    for r in conversations:
        db.add(Conversation(
            id=int(r["id"]), student_id=student_id, title=str(r.get("title") or "新对话")[:128],
            parent_conversation_id=r.get("parent_conversation_id"),
            created_at=_dt(r.get("created_at")) or now,
        ))
    db.flush()

    messages = payload.get("messages") or []
    for r in messages:
        db.add(Message(
            id=int(r["id"]), conversation_id=int(r["conversation_id"]),
            role=str(r.get("role") or "user"), content=str(r.get("content") or ""),
            meta=r.get("meta") or {}, created_at=_dt(r.get("created_at")) or now,
        ))
    db.flush()

    for r in payload.get("explore_cards") or []:
        db.add(ExploreCard(
            id=int(r["id"]), student_id=student_id, conversation_id=r.get("conversation_id"),
            parent_card_id=r.get("parent_card_id"), source_message_id=r.get("source_message_id"),
            type=str(r.get("type") or "child"), term=str(r.get("term") or "")[:128],
            context=str(r.get("context") or ""), branch_conversation_id=r.get("branch_conversation_id"),
            content=r.get("content"), status=str(r.get("status") or "completed"),
            created_at=_dt(r.get("created_at")) or now,
        ))

    for r in payload.get("literatures") or []:
        db.add(Literature(
            id=int(r["id"]), student_id=student_id, title=str(r.get("title") or "未命名")[:256],
            source_type=str(r.get("source_type") or "txt"), text=str(r.get("text") or ""),
            terms=r.get("terms") or [], meta=r.get("meta") or {},
            created_at=_dt(r.get("created_at")) or now,
        ))

    for r in payload.get("understandings") or []:
        db.add(Understanding(
            id=int(r["id"]), student_id=student_id, concept=str(r.get("concept") or "")[:128],
            summary=str(r.get("summary") or ""), ai_score=float(r.get("ai_score") or 0),
            ai_feedback=str(r.get("ai_feedback") or ""), status=str(r.get("status") or "approved"),
            embedding=r.get("embedding") or [], anchors=r.get("anchors") or [],
            source=r.get("source") or {}, created_at=_dt(r.get("created_at")) or now,
        ))

    for r in payload.get("practice_records") or []:
        db.add(PracticeRecord(
            id=int(r["id"]), student_id=student_id, conversation_id=r.get("conversation_id"),
            topic=str(r.get("topic") or "")[:128], question=str(r.get("question") or ""),
            options=r.get("options") or [], answer=str(r.get("answer") or ""),
            explanation=str(r.get("explanation") or ""), is_correct=r.get("is_correct"),
            asked_at=_dt(r.get("asked_at")) or now, answered_at=_dt(r.get("answered_at")),
        ))

    db.commit()
    return {
        "conversations": len(conversations),
        "messages": len(messages),
        "explore_cards": len(payload.get("explore_cards") or []),
        "literatures": len(payload.get("literatures") or []),
        "understandings": len(payload.get("understandings") or []),
        "practice_records": len(payload.get("practice_records") or []),
    }


def _assign_ids(db: Session, model: Any, rows: list[dict]) -> dict[int, int]:
    """为导入记录分配新自增 id（避开现有最大 id），返回 old_id → new_id 映射。"""
    if not rows:
        return {}
    max_id = db.query(func.max(model.id)).scalar() or 0
    return {int(r["id"]): max_id + 1 + index for index, r in enumerate(rows)}


def _remap_meta(meta: Any, conv_map: dict[int, int]) -> Any:
    """合并模式下，把消息 meta 里遗留的 branched_from 旧对话 id 映射为新 id。"""
    if not isinstance(meta, dict):
        return meta
    meta = dict(meta)
    if isinstance(meta.get("branched_from"), int) and meta["branched_from"] in conv_map:
        meta["branched_from"] = conv_map[meta["branched_from"]]
    return meta


def _merge(db: Session, student_id: int, payload: dict) -> dict[str, int]:
    """合并追加：为导入记录分配新 id 并重映射全部外键。"""
    now = datetime.utcnow()

    conversations = payload.get("conversations") or []
    messages = payload.get("messages") or []
    cards = payload.get("explore_cards") or []
    literatures = payload.get("literatures") or []
    understandings = payload.get("understandings") or []
    records = payload.get("practice_records") or []

    conv_map = _assign_ids(db, Conversation, conversations)
    msg_map = _assign_ids(db, Message, messages)
    card_map = _assign_ids(db, ExploreCard, cards)

    for r in conversations:
        db.add(Conversation(
            id=conv_map[int(r["id"])], student_id=student_id, title=str(r.get("title") or "新对话")[:128],
            parent_conversation_id=conv_map.get(r.get("parent_conversation_id")),
            created_at=_dt(r.get("created_at")) or now,
        ))
    for r in messages:
        db.add(Message(
            id=msg_map[int(r["id"])], conversation_id=conv_map.get(int(r["conversation_id"])),
            role=str(r.get("role") or "user"), content=str(r.get("content") or ""),
            meta=_remap_meta(r.get("meta"), conv_map), created_at=_dt(r.get("created_at")) or now,
        ))
    for r in cards:
        db.add(ExploreCard(
            id=card_map[int(r["id"])], student_id=student_id, conversation_id=conv_map.get(r.get("conversation_id")),
            parent_card_id=card_map.get(r.get("parent_card_id")), source_message_id=msg_map.get(r.get("source_message_id")),
            type=str(r.get("type") or "child"), term=str(r.get("term") or "")[:128],
            context=str(r.get("context") or ""), branch_conversation_id=conv_map.get(r.get("branch_conversation_id")),
            content=r.get("content"), status=str(r.get("status") or "completed"),
            created_at=_dt(r.get("created_at")) or now,
        ))

    # 无外键（除 student_id）的表：直接自增插入即可
    for r in literatures:
        db.add(Literature(
            student_id=student_id, title=str(r.get("title") or "未命名")[:256],
            source_type=str(r.get("source_type") or "txt"), text=str(r.get("text") or ""),
            terms=r.get("terms") or [], meta=r.get("meta") or {},
            created_at=_dt(r.get("created_at")) or now,
        ))
    for r in understandings:
        db.add(Understanding(
            student_id=student_id, concept=str(r.get("concept") or "")[:128],
            summary=str(r.get("summary") or ""), ai_score=float(r.get("ai_score") or 0),
            ai_feedback=str(r.get("ai_feedback") or ""), status=str(r.get("status") or "approved"),
            embedding=r.get("embedding") or [], anchors=r.get("anchors") or [],
            source=r.get("source") or {}, created_at=_dt(r.get("created_at")) or now,
        ))
    for r in records:
        db.add(PracticeRecord(
            student_id=student_id, conversation_id=conv_map.get(r.get("conversation_id")),
            topic=str(r.get("topic") or "")[:128], question=str(r.get("question") or ""),
            options=r.get("options") or [], answer=str(r.get("answer") or ""),
            explanation=str(r.get("explanation") or ""), is_correct=r.get("is_correct"),
            asked_at=_dt(r.get("asked_at")) or now, answered_at=_dt(r.get("answered_at")),
        ))

    db.commit()
    return {
        "conversations": len(conversations),
        "messages": len(messages),
        "explore_cards": len(cards),
        "literatures": len(literatures),
        "understandings": len(understandings),
        "practice_records": len(records),
    }


def import_data(db: Session, student_id: int, data: dict, mode: str = "merge") -> dict[str, Any]:
    """导入 session log / 个人配置。mode: restore（覆盖恢复）/ merge（合并追加）。

    兼容两种文件格式：indexnya-sessionlog 与 indexnya-profile（个人配置备份，
    其 data 部分结构与 session log 相同，缺表按空处理）。
    """
    if data.get("format") not in (FORMAT, "indexnya-profile"):
        raise ValueError("不是有效的 IndexNya session log / 个人配置文件")
    payload = data.get("data") or {}
    if not isinstance(payload, dict):
        raise ValueError("session log 数据格式错误")

    if mode == "restore":
        stats = _restore(db, student_id, payload)
        message = "已覆盖恢复：导入的聊天记录已完整还原为导出时的状态。"
    else:
        stats = _merge(db, student_id, payload)
        message = "已合并追加：导入内容已作为新数据加入，不影响现有记录。"

    return {"mode": mode, "message": message, "imported": stats}
