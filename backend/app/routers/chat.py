"""对话流路由 — SSE 流式输出，融合画像构建与多智能体协同。

事件类型：
  token   — 增量文本
  meta    — 会话/学生/资源元信息
  profile — 画像更新通知
  done    — 结束
  error   — 错误
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..agents.base import BaseAgent
from ..db import get_db
from ..models import Conversation, Message, Student
from ..schemas import ChatRequest
from ..services.profile_service import (
    extract_profile_from_history,
    get_latest_profile,
    profile_to_dict,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _format_resource_preview(r) -> str:
    """把生成的资源格式化为对话流中的预览 Markdown。"""
    type_label = {
        "lecture": "讲解文档", "mindmap": "思维导图", "quiz": "练习题库",
        "reading": "拓展阅读", "code": "代码实操", "video": "教学视频",
        "illustration": "教学插图", "ppt": "教学PPT",
    }.get(r.type, r.type)
    header = f"✅ 已生成 **{type_label}**：{r.title}\n\n"
    content = r.content or {}
    if r.status == "failed":
        return f"⚠️ {type_label} 生成失败：{content.get('error', '未知错误')}"
    if r.type == "video" and r.file_url:
        return header + f"[▶ 查看视频]({r.file_url})"
    if r.type == "illustration" and r.file_url:
        return header + f"![教学插图]({r.file_url})"
    if r.type == "ppt" and r.file_url:
        return header + f"[📥 下载 PPT]({r.file_url})"
    if content.get("markdown"):
        return header + content["markdown"]
    if content.get("mermaid"):
        return header + "```mermaid\n" + content["mermaid"] + "\n```"
    if content.get("questions"):
        qs = content["questions"]
        return header + f"共 {len(qs)} 道题，请在资源库查看完整题库。"
    return header + "资源已生成，请在资源库查看。"


DEFAULT_PROFILE_AGENT_PROMPT = """你是一位学习画像构建智能体，同时也是学习顾问。当前正在和学生对话。

你的双重职责：
1. 自然地了解学生的专业、目标、基础、易错点、学习节奏、兴趣（构建画像）
2. 回答学生的学习问题，给出有针对性的建议

当学生提供了足够画像信息（自然地说出专业、目标、一个薄弱点、偏好），可在回复末尾加上一行：
[[PROFILE_READY]]

回复用中文，语气亲切像辅导员。一次不要问太多问题。"""


async def _stream_chat(
    db: Session,
    payload: ChatRequest,
) -> AsyncIterator[str]:
    """生成 SSE 事件流。"""
    # 1. 解析 / 创建学生与对话
    student = None
    if payload.student_id:
        student = db.get(Student, payload.student_id)
    if not student:
        student = Student(name="同学")
        db.add(student)
        db.commit()
        db.refresh(student)

    conv = None
    if payload.conversation_id:
        conv = db.get(Conversation, payload.conversation_id)
    if not conv:
        title = payload.message[:24] if payload.message else "新对话"
        conv = Conversation(student_id=student.id, title=title)
        db.add(conv)
        db.commit()
        db.refresh(conv)

    # 2. 保存用户消息
    user_msg = Message(conversation_id=conv.id, role="user", content=payload.message)
    db.add(user_msg)
    db.commit()

    # 发送 meta 事件
    yield _sse("meta", {
        "conversation_id": conv.id,
        "student_id": student.id,
        "mode": payload.mode,
        "resource_type": payload.resource_type,
    })

    # 3. 拉取历史 + 当前画像，构建 agent 上下文
    history_rows = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.created_at.asc())
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in history_rows[:-1]]  # 排除刚存的当前消息
    profile = profile_to_dict(get_latest_profile(db, student.id))

    # 4. 意图路由：LLM 判断用哪个智能体响应
    #    payload.resource_type 显式指定时跳过路由，直接用指定类型
    explicit = payload.resource_type
    if explicit:
        route = {"action": "resource", "resource_type": explicit, "topic": payload.message}
    else:
        try:
            from ..agents.router import RouterAgent
            router = RouterAgent()
            route = await router.route(payload.message, profile, history)
        except Exception as e:
            logger.warning("intent routing error: %s, fallback to chat", e)
            route = {"action": "chat", "topic": ""}

    # 通知前端路由决策
    yield _sse("route", {
        "action": route.get("action", "chat"),
        "resource_type": route.get("resource_type"),
        "topic": route.get("topic", ""),
    })

    # 5. 按路由结果分流执行
    action = route.get("action", "chat")
    full_text_parts: list[str] = []

    if action == "resource":
        # 调资源生成智能体（非流式，生成后一次性返回 + 触发资源刷新）
        rtype = route.get("resource_type", "lecture")
        topic = route.get("topic") or payload.message
        yield _sse("token", {"text": f"正在调度「{rtype}」智能体生成关于「{topic}」的资源…\n\n"})
        try:
            from ..services.resource_service import generate_resource
            r = await generate_resource(db, student.id, rtype, topic, conversation_id=conv.id)
            preview = _format_resource_preview(r)
            full_text_parts.append(preview)
            yield _sse("token", {"text": preview})
            yield _sse("resource", {"id": r.id, "type": r.type, "title": r.title, "file_url": r.file_url})
        except Exception as e:
            logger.exception("resource generation in chat failed")
            err = f"⚠️ 资源生成失败：{e}"
            full_text_parts.append(err)
            yield _sse("token", {"text": err})
    elif action == "tutor":
        # 调辅导智能体
        topic = route.get("topic") or payload.message
        try:
            from ..agents.tutor import TutorAgent
            tutor = TutorAgent()
            result = await tutor.answer(topic, profile, modality="text")
            text = result.get("text", "")
            full_text_parts.append(text)
            yield _sse("token", {"text": text})
            if result.get("video", {}).get("video_url"):
                yield _sse("token", {"text": "\n\n📹 [数字人讲解视频](" + result["video"]["video_url"] + ")"})
        except Exception as e:
            logger.exception("tutor in chat failed")
            err = f"⚠️ 辅导失败：{e}"
            full_text_parts.append(err)
            yield _sse("token", {"text": err})
    else:
        # chat：默认对话流式（画像构建 + 通用回答）
        agent = BaseAgent()
        extra_context = f"当前学生画像：{json.dumps(profile, ensure_ascii=False)}" if profile else ""
        try:
            async for chunk in agent.stream(
                payload.message,
                history=history,
                extra_context=extra_context,
                temperature=0.7,
                max_tokens=3072,
            ):
                full_text_parts.append(chunk)
                yield _sse("token", {"text": chunk})
        except Exception as e:
            logger.exception("chat stream failed")
            yield _sse("error", {"message": str(e)})
            return

    full_text = "".join(full_text_parts)

    # 6. 画像抽取：每次对话后自动触发（不再依赖 [[PROFILE_READY]] 标记）
    #    节流：累计消息 ≥3 条才抽；且不论是否更新都尝试（ProfilerAgent 会基于全历史判断）
    profile_updated = False
    # 去掉遗留的标记（兼容旧 prompt）
    if "[[PROFILE_READY]]" in full_text:
        full_text = full_text.replace("[[PROFILE_READY]]", "").strip()

    # 仅 chat 动作触发（resource/tutor 不触发，避免干扰）
    if action == "chat":
        try:
            conv_text = "\n".join(
                f"{m.role}: {m.content}" for m in history_rows
            ) + f"\nassistant: {full_text}"
            p = await extract_profile_from_history(db, student.id, conv_text)
            profile_updated = True
            yield _sse("profile", {
                "version": p.version,
                "dimensions": p.dimensions,
                "summary": p.raw_summary,
            })
        except Exception as e:
            logger.warning("profile extraction failed: %s", e)
            # 不发 error 事件，画像抽取失败不影响主对话

    # 7. 保存 assistant 消息
    asst_msg = Message(
        conversation_id=conv.id,
        role="assistant",
        content=full_text,
        meta={"profile_updated": profile_updated, "mode": payload.mode, "action": action},
    )
    db.add(asst_msg)
    db.commit()

    yield _sse("done", {"conversation_id": conv.id, "student_id": student.id})


def _sse(event: str, data: dict) -> str:
    """格式化为 SSE 事件。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(payload: ChatRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    """流式对话主入口。"""
    if not payload.message:
        raise HTTPException(400, "message is required")
    return StreamingResponse(
        _stream_chat(db, payload),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/conversations/{conversation_id}/messages")
def list_messages(conversation_id: int, db: Session = Depends(get_db)) -> list[dict]:
    msgs = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .all()
    )
    return [
        {"id": m.id, "role": m.role, "content": m.content, "meta": m.meta,
         "created_at": m.created_at.isoformat()}
        for m in msgs
    ]


@router.get("/conversations")
def list_conversations(student_id: int, db: Session = Depends(get_db)) -> list[dict]:
    convs = (
        db.query(Conversation)
        .filter(Conversation.student_id == student_id)
        .order_by(Conversation.created_at.desc())
        .all()
    )
    return [
        {"id": c.id, "student_id": c.student_id, "title": c.title,
         "created_at": c.created_at.isoformat()}
        for c in convs
    ]
