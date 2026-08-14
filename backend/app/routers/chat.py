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
import re
from typing import Any, AsyncIterator
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..agents.base import BaseAgent
from ..agents.main_agent import MainAgent
from ..llm.factory import chat_complete, get_llm, json_complete, reset_active_model, set_active_model
from ..db import get_db
from ..models import Conversation, Message, Resource, Student
from ..schemas import BranchConversationRequest, ChatModelConfig, ChatRequest
from ..services.profile_service import (
    extract_profile_from_history,
    get_latest_profile,
    profile_to_dict,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _model_payload(payload: ChatRequest) -> dict | None:
    """只将允许的模型字段传给 LLM 工厂，避免把未知字段带入请求。"""
    return payload.model.model_dump(exclude_none=True) if payload.model else None


def _is_local_illustration_request(message: str) -> bool:
    return bool(re.search(r"(?:生成|制作|画|做一张|创建).{0,12}(?:插图|配图|示意图)", message))


def _is_local_ppt_request(message: str) -> bool:
    return bool(re.search(r"(?:生成|制作|做个|做一份|创建|导出).{0,12}(?:PPT|ppt|幻灯片|演示文稿|课件)", message))


def _bilibili_search_markdown(topic: str) -> str:
    clean_topic = (topic or "学习讲解").strip()[:80]
    url = "https://search.bilibili.com/all?keyword=" + quote(clean_topic)
    return f"\n\n📺 Bilibili 相关视频：[搜索「{clean_topic}」]({url})"


def _friendly_model_test_error(error: Exception) -> str:
    """把供应商返回的长 HTML/错误堆栈转换成可读提示。"""
    raw = str(error).strip()
    lower = raw.lower()
    if "<!doctype html" in lower or "<html" in lower or "404 - page not found" in lower:
        return "接口返回了网页 404，而不是模型 API 响应。请检查 Base URL，填写 OpenAI 兼容 API 地址，不要填写网页首页地址。"
    if len(raw) > 360:
        return raw[:360].rstrip() + "…"
    return raw or "未知连接错误"


async def _extract_terms(answer: str) -> list[dict[str, str]]:
    """从回答中提取可点击的专有名词，失败时返回空列表。"""
    if len(answer.strip()) < 24:
        return []
    sample = answer[:8000]
    prompt = f"""请从下面这段学习助手回答中提取适合学生点击追问的专有名词。

要求：
1. 只提取技术名词、学科概念、实体名称、方法/框架/协议名称，不要提取普通动词、形容词或泛化词。
2. text 必须是回答中原样出现的连续短语，不能改写。
3. 最多提取 10 个，优先选择最值得展开解释的词。
4. explanation 用一句中文简要解释这个词，方便子对话展示。
5. 如果没有合适的词，返回空数组。

只输出 JSON 数组，格式如下：
[{{"text":"虚拟 DOM","explanation":"用于描述界面结构并优化更新过程的内存表示"}}]

回答内容：
{sample}"""
    try:
        raw = await json_complete([
            {"role": "system", "content": "你是一个严谨的学习内容术语标注器。"},
            {"role": "user", "content": prompt},
        ], temperature=0.1, max_tokens=1200)
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        data: Any = json.loads(cleaned)
        if isinstance(data, dict):
            data = data.get("terms", [])
        if not isinstance(data, list):
            return []

        terms: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in data:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip()
            explanation = str(item.get("explanation") or "").strip()
            if not text or text in seen or len(text) > 48 or text not in answer:
                continue
            if len(explanation) > 180:
                explanation = explanation[:180].rstrip() + "…"
            terms.append({"text": text, "explanation": explanation})
            seen.add(text)
            if len(terms) >= 10:
                break
        return terms
    except Exception as exc:
        logger.debug("term extraction skipped: %s", exc)
        return []


def _format_resource_preview(r) -> str:
    """把生成的资源格式化为对话流中的预览 Markdown。"""
    type_label = {
        "lecture": "讲解文档", "mindmap": "思维导图", "quiz": "练习题库",
        "reading": "拓展阅读", "code": "代码实操",
        "illustration": "教学插图", "ppt": "教学PPT",
    }.get(r.type, r.type)
    header = f"✅ 已生成 **{type_label}**：{r.title}\n\n"
    content = r.content or {}
    if r.status == "failed":
        return f"⚠️ {type_label} 生成失败：{content.get('error', '未知错误')}"
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


async def _stream_chat_impl(
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
    if conv and payload.student_id and conv.student_id != student.id:
        raise HTTPException(403, "conversation does not belong to student")
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
        if explicit == "video":
            route = {"action": "tutor", "topic": payload.message, "video_topic": payload.message}
        else:
            route = {"action": "resource", "resource_type": explicit, "topic": payload.message}
        main_plan = {"action": route["action"], "resource_type": route.get("resource_type"), "topic": route.get("topic"), "tasks": [{"agent": route.get("resource_type") or route["action"], "instruction": "完成当前请求"}], "acceptance": ["结果与用户请求相关", "结果可以直接展示给用户"]}
    elif _is_local_ppt_request(payload.message):
        # PPT 使用本地模板生成，不需要模型路由。
        route = {"action": "resource", "resource_type": "ppt", "topic": payload.message}
        main_plan = {"action": "resource", "resource_type": "ppt", "topic": payload.message, "tasks": [{"agent": "ppt", "instruction": "读取上文学习内容并生成本地 PPT"}], "acceptance": ["PPT 包含上文知识点", "文件可以下载"]}
    elif _is_local_illustration_request(payload.message):
        # 插图提示词使用本地模板，不需要文本模型路由。
        route = {"action": "resource", "resource_type": "illustration", "topic": payload.message}
        main_plan = {"action": "resource", "resource_type": "illustration", "topic": payload.message, "tasks": [{"agent": "illustration", "instruction": "根据主题生成教学插图"}], "acceptance": ["图片文件生成成功"]}
    else:
        try:
            main_plan = await MainAgent().plan(payload.message, profile, history)
            route = {
                "action": main_plan.get("action", "chat"),
                "resource_type": main_plan.get("resource_type"),
                "topic": main_plan.get("topic") or payload.message,
                "video_topic": main_plan.get("video_topic"),
            }
        except Exception as e:
            logger.warning("main agent planning error: %s, fallback to chat", e)
            route = {"action": "chat", "topic": payload.message}
            main_plan = {"action": "chat", "topic": payload.message, "tasks": [{"agent": "conversation", "instruction": "回答当前学习问题"}], "acceptance": ["回答与问题相关且内容非空"]}

    yield _sse("plan", {
        "agent": "main",
        "tasks": main_plan.get("tasks", []),
        "acceptance": main_plan.get("acceptance", []),
    })
    yield _sse("progress", {
        "phase": "planning",
        "agent": "main",
        "status": "completed",
        "detail": "主 Agent 已完成任务规划，准备派发 subagent。",
    })

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
        yield _sse("progress", {"phase": "subagent", "agent": route.get("resource_type") or "resource", "status": "running", "detail": "subagent 正在执行专门任务。"})
        # 调资源生成智能体（非流式，生成后一次性返回 + 触发资源刷新）
        rtype = route.get("resource_type", "lecture")
        topic = route.get("topic") or payload.message
        yield _sse("token", {"text": f"正在调度「{rtype}」智能体生成关于「{topic}」的资源…\n\n"})
        try:
            from ..services.resource_service import generate_resource
            r = await generate_resource(
                db, student.id, rtype, topic, conversation_id=conv.id,
                image_model_config=payload.image_model.model_dump(exclude_none=True) if payload.image_model else None,
            )
            preview = _format_resource_preview(r)
            full_text_parts.append(preview)
            yield _sse("token", {"text": preview})
            yield _sse("resource", {"id": r.id, "type": r.type, "title": r.title, "file_url": r.file_url})
            yield _sse("progress", {"phase": "subagent", "agent": rtype, "status": "completed", "detail": "subagent 已返回结果，主 Agent 即将验收。"})
        except Exception as e:
            logger.exception("resource generation in chat failed")
            err = f"⚠️ 资源生成失败：{e}"
            full_text_parts.append(err)
            yield _sse("token", {"text": err})
    elif action == "tutor":
        yield _sse("progress", {"phase": "subagent", "agent": "tutor", "status": "running", "detail": "辅导 subagent 正在整理回答。"})
        # 调辅导智能体
        topic = route.get("topic") or payload.message
        try:
            from ..agents.tutor import TutorAgent
            tutor = TutorAgent()
            result = await tutor.answer(topic, profile, modality="text")
            text = result.get("text", "")
            full_text_parts.append(text)
            yield _sse("token", {"text": text})
            video_topic = result.get("video_topic") or route.get("video_topic")
            if video_topic:
                video_url = result.get("video_url")
                link = (
                    f"\n\n📺 Bilibili 相关视频：[搜索「{video_topic}」]({video_url})"
                    if video_url
                    else _bilibili_search_markdown(video_topic)
                )
                full_text_parts.append(link)
                yield _sse("token", {"text": link})
            yield _sse("progress", {"phase": "subagent", "agent": "tutor", "status": "completed", "detail": "辅导 subagent 已完成，主 Agent 即将验收。"})
        except Exception as e:
            logger.exception("tutor in chat failed")
            err = f"⚠️ 辅导失败：{e}"
            full_text_parts.append(err)
            yield _sse("token", {"text": err})
    else:
        yield _sse("progress", {"phase": "subagent", "agent": "conversation", "status": "running", "detail": "对话 subagent 正在生成回答。"})
        # chat：默认对话流式（画像构建 + 通用回答）
        agent = BaseAgent()
        extra_context_parts: list[str] = []
        if profile:
            extra_context_parts.append(f"当前学生画像：{json.dumps(profile, ensure_ascii=False)}")
        if payload.context:
            extra_context_parts.append(f"当前子对话聚焦上下文：{payload.context[:4000]}")
        extra_context = "\n\n".join(extra_context_parts)
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
            yield _sse("progress", {"phase": "subagent", "agent": "conversation", "status": "completed", "detail": "对话 subagent 已完成，主 Agent 即将验收。"})
        except Exception as e:
            logger.exception("chat stream failed")
            yield _sse("error", {"message": str(e)})
            return

    full_text = "".join(full_text_parts)
    # 去掉遗留的画像标记后再提取专有名词，避免标记进入术语列表。
    if "[[PROFILE_READY]]" in full_text:
        full_text = full_text.replace("[[PROFILE_READY]]", "").strip()

    # 6. 主 Agent 验收 subagent 结果。
    if payload.model:
        acceptance = await MainAgent().accept(main_plan, full_text)
    else:
        acceptance = {"accepted": bool(full_text.strip()), "reason": "本地任务结果非空，已通过基础验收"}
    yield _sse("acceptance", {"agent": "main", **acceptance})
    yield _sse("progress", {
        "phase": "acceptance",
        "agent": "main",
        "status": "completed" if acceptance.get("accepted") else "failed",
        "detail": acceptance.get("reason", "主 Agent 验收完成"),
    })

    # 7. 提取回答中的专有名词，供前端渲染为可点击子对话入口。
    terms: list[dict[str, str]] = []
    if action in {"chat", "tutor"}:
        terms = await _extract_terms(full_text)
        if terms:
            yield _sse("terms", {"terms": terms})

    # 7. 画像抽取：每次对话后自动触发（不再依赖 [[PROFILE_READY]] 标记）
    #    节流：累计消息 ≥3 条才抽；且不论是否更新都尝试（ProfilerAgent 会基于全历史判断）
    profile_updated = False
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
        meta={
            "profile_updated": profile_updated,
            "mode": payload.mode,
            "action": action,
            "terms": terms,
            "model_id": payload.model.id if payload.model else None,
            "main_plan": {"tasks": main_plan.get("tasks", []), "acceptance": main_plan.get("acceptance", [])},
            "acceptance": acceptance,
        },
    )
    db.add(asst_msg)
    db.commit()

    yield _sse("done", {"conversation_id": conv.id, "student_id": student.id})


async def _stream_chat(db: Session, payload: ChatRequest) -> AsyncIterator[str]:
    """在当前请求上下文启用前端选择的模型。"""
    from ..llm.factory import reset_active_model, set_active_model

    token = set_active_model(_model_payload(payload))
    try:
        async for event in _stream_chat_impl(db, payload):
            yield event
    finally:
        reset_active_model(token)


def _sse(event: str, data: dict) -> str:
    """格式化为 SSE 事件。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/models/test")
async def test_model_connection(payload: ChatModelConfig) -> dict:
    """临时测试模型连接，不保存配置，也不写入数据库。"""
    token = set_active_model(payload.model_dump(exclude_none=True))
    try:
        if payload.type == "image":
            await get_llm().models.list()
            preview = "模型接口可访问"
        else:
            preview = await chat_complete(
                [
                    {"role": "system", "content": "请只回复：连接成功"},
                    {"role": "user", "content": "测试模型连接。"},
                ],
                temperature=0,
                max_tokens=16,
            )
        return {
            "ok": True,
            "model": payload.model,
            "message": "模型连接成功",
            "preview": preview[:120],
        }
    except Exception as exc:
        logger.warning("model connection test failed for %s: %s", payload.model, exc)
        raw_detail = str(exc).strip()
        if payload.api_key:
            raw_detail = raw_detail.replace(payload.api_key, "***")
        return {
            "ok": False,
            "model": payload.model,
            "message": f"模型连接失败：{_friendly_model_test_error(exc)}",
            "detail": raw_detail[:4000],
        }
    finally:
        reset_active_model(token)


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


@router.post("/conversations/{conversation_id}/branch")
def branch_conversation(
    conversation_id: int,
    payload: BranchConversationRequest | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """从已有对话复制出一个独立侧边对话，保留当前上下文但后续消息互不影响。"""
    source = db.get(Conversation, conversation_id)
    if not source:
        raise HTTPException(404, "conversation not found")

    title = (payload.title if payload else None) or f"侧边：{source.title}"
    branch = Conversation(
        student_id=source.student_id,
        title=title[:128],
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
    return {
        "id": branch.id,
        "student_id": branch.student_id,
        "title": branch.title,
        "parent_conversation_id": branch.parent_conversation_id,
        "created_at": branch.created_at.isoformat(),
        "branched_from": source.id,
    }


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)) -> dict:
    """删除一条对话及其所有子对话、消息；资源本身保留但解除会话关联。"""
    root = db.get(Conversation, conversation_id)
    if not root:
        raise HTTPException(404, "conversation not found")

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
    return {"deleted_ids": ids}


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
    result = []
    for conversation in convs:
        parent_id = conversation.parent_conversation_id
        # 兼容早期已经创建的分支：分支消息中保存了 branched_from。
        if parent_id is None:
            first_message = (
                db.query(Message)
                .filter(Message.conversation_id == conversation.id)
                .order_by(Message.id.asc())
                .first()
            )
            parent_id = (first_message.meta or {}).get("branched_from") if first_message else None
        result.append({
            "id": conversation.id,
            "student_id": conversation.student_id,
            "title": conversation.title,
            "parent_conversation_id": parent_id,
            "created_at": conversation.created_at.isoformat(),
        })
    return result
