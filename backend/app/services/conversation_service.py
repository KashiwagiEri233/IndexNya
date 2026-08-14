"""对话服务 — 分支创建与级联删除，供 chat / hierarchy 路由共用。"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Conversation, Message, Resource


def branch_conversation(
    db: Session,
    conversation_id: int,
    title: str | None = None,
    student_id: int | None = None,
) -> Conversation:
    """从已有对话复制出一个独立侧边对话，保留当前上下文但后续消息互不影响。"""
    source = db.get(Conversation, conversation_id)
    if not source:
        raise ValueError("conversation not found")
    if student_id is not None and source.student_id != student_id:
        raise ValueError("conversation does not belong to student")

    branch_title = (title or f"侧边：{source.title}")[:128]
    branch = Conversation(
        student_id=source.student_id,
        title=branch_title,
        parent_conversation_id=source.id,
    )
    db.add(branch)
    db.flush()
    source_messages = (
        db.query(Message)
        .filter(Message.conversation_id == source.id)
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )
    for message in source_messages:
        db.add(Message(
            conversation_id=branch.id,
            role=message.role,
            content=message.content,
            meta={**(message.meta or {}), "branched_from": source.id},
        ))
    db.commit()
    db.refresh(branch)
    return branch


def delete_conversation_tree(db: Session, conversation_id: int) -> list[int]:
    """删除一条对话及其所有子对话、消息；资源本身保留但解除会话关联。"""
    root = db.get(Conversation, conversation_id)
    if not root:
        raise ValueError("conversation not found")

    all_conversations = (
        db.query(Conversation)
        .filter(Conversation.student_id == root.student_id)
        .all()
    )
    parent_by_id: dict[int, int | None] = {}
    for conversation in all_conversations:
        parent_id = conversation.parent_conversation_id
        # 兼容添加父子字段前创建的旧分支。
        if parent_id is None:
            first_message = (
                db.query(Message)
                .filter(Message.conversation_id == conversation.id)
                .order_by(Message.id.asc())
                .first()
            )
            parent_id = (first_message.meta or {}).get("branched_from") if first_message else None
        parent_by_id[conversation.id] = parent_id

    ids = [root.id]
    index = 0
    while index < len(ids):
        ids.extend(
            conversation_id
            for conversation_id, parent_id in parent_by_id.items()
            if parent_id == ids[index] and conversation_id not in ids
        )
        index += 1

    # 资源不随聊天记录删除，只解除会话关联，避免资料库内容意外丢失。
    db.query(Resource).filter(Resource.conversation_id.in_(ids)).update(
        {Resource.conversation_id: None}, synchronize_session=False
    )
    db.query(Message).filter(Message.conversation_id.in_(ids)).delete(synchronize_session=False)
    db.query(Conversation).filter(Conversation.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return ids
