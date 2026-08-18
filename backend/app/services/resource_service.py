"""资源生成服务 — 调度对应 agent 生成并落库。"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from ..agents.coder import CoderAgent
from ..agents.lecturer import LecturerAgent
from ..agents.mindmap import MindmapAgent
from ..agents.quizmaster import QuizmasterAgent
from ..agents.reader import ReaderAgent
from ..models import Profile, Resource
from .profile_service import get_latest_profile, profile_to_dict

logger = logging.getLogger(__name__)

# type → (title prefix, agent factory)
_GENERATORS = {
    "lecture": ("讲解文档", LecturerAgent),
    "mindmap": ("思维导图", MindmapAgent),
    "quiz": ("练习题库", QuizmasterAgent),
    "reading": ("拓展阅读", ReaderAgent),
    "code": ("代码实操", CoderAgent),
}


async def generate_resource(
    db: Session,
    student_id: int,
    resource_type: str,
    topic: str,
    conversation_id: int | None = None,
    extra: dict[str, Any] | None = None,
) -> Resource:
    """统一资源生成入口。"""
    if resource_type not in _GENERATORS:
        raise ValueError(f"unknown resource type: {resource_type}")

    prefix, agent_cls = _GENERATORS[resource_type]
    profile = profile_to_dict(get_latest_profile(db, student_id))

    # 拼接对话历史作为 agent 上下文（保留多轮对话信息）
    history_text = ""
    if conversation_id:
        from ..models import Message
        msgs = (
            db.query(Message)
            .filter(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc())
            .limit(20)  # 最近 20 条避免上下文过长
            .all()
        )
        if msgs:
            history_text = "\n".join(f"{m.role}: {m.content[:1200]}" for m in msgs)

    # 把历史合并进 extra 字符串传给 agent
    extra_dict = dict(extra or {})
    if history_text:
        prev_extra = str(extra_dict) if extra_dict else ""
        extra_dict["_history"] = history_text
        extra_str = f"对话历史：\n{history_text}" + (f"\n额外要求：{prev_extra}" if prev_extra else "")
    else:
        extra_str = str(extra_dict) if extra_dict else ""

    # 注入思维宇宙知识锚点（学生已用自己的话掌握的相关理解）
    from .universe_service import get_anchor_context
    anchor_ctx = get_anchor_context(db, student_id, topic)
    if anchor_ctx:
        extra_str = (extra_str + "\n\n" + anchor_ctx) if extra_str else anchor_ctx

    # 先建一个 pending 记录
    r = Resource(
        student_id=student_id,
        conversation_id=conversation_id,
        type=resource_type,
        title=f"{prefix}：{topic}",
        content={},
        status="processing",
    )
    db.add(r)
    db.commit()
    db.refresh(r)

    try:
        if resource_type == "lecture":
            text = await agent_cls().generate(topic, profile, extra=extra_str)
            content = {"markdown": text}
        elif resource_type == "mindmap":
            content = await agent_cls().generate(topic, profile, extra=extra_str)
        elif resource_type == "quiz":
            content = await agent_cls().generate(topic, profile, extra=extra_str)
        elif resource_type == "reading":
            text = await agent_cls().generate(topic, profile, extra=extra_str)
            content = {"markdown": text}
        elif resource_type == "code":
            text = await agent_cls().generate(topic, profile, extra=extra_str)
            content = {"markdown": text}
        else:
            content = {}

        r.content = content
        r.status = "completed"
    except Exception as e:
        logger.exception("resource generation failed: %s", resource_type)
        r.status = "failed"
        r.content = {"error": str(e)}

    db.commit()
    db.refresh(r)
    return r


def list_resources(
    db: Session, student_id: int, resource_type: str | None = None
) -> list[Resource]:
    q = db.query(Resource).filter(Resource.student_id == student_id)
    if resource_type:
        q = q.filter(Resource.type == resource_type)
    return q.order_by(Resource.created_at.desc()).all()
