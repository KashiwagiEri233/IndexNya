"""对话流路由 — SSE 流式输出，融合画像构建与多智能体协同。

事件类型：
  token   — 增量文本
  meta    — 会话/学生/资源元信息
  profile — 画像更新通知
  done    — 结束
  error   — 错误
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Any, AsyncIterator
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..agents.main_agent import MainAgent
from ..agents.terms import extract_terms
from ..llm.factory import chat_complete, chat_complete_message, reset_active_model, set_active_model
from ..services.quiz_service import (
    QUIZ_SYSTEM_PROMPT,
    QUIZ_TOOL,
    SESSION_KEY,
    apply_tool_args,
    close_session,
    find_ask_question,
    is_quiz_exit,
    new_session,
    serialize as serialize_quiz_session,
)
from ..skills.manager import get_skill, list_skills
from ..db import get_db
from ..models import Conversation, ExploreCard, Message, Student
from ..schemas import BranchConversationRequest, ChatModelConfig, ChatRequest, MessageUpdate
from ..services.conversation_service import (
    branch_conversation as create_branch_conversation,
    delete_conversation_tree,
)
from ..services.profile_service import (
    extract_profile_from_history,
    get_latest_profile,
    profile_to_dict,
)
from ..services.universe_service import get_anchor_context

router = APIRouter()
logger = logging.getLogger(__name__)


def _model_payload(payload: ChatRequest) -> dict | None:
    """只将允许的模型字段传给 LLM 工厂，避免把未知字段带入请求。"""
    return payload.model.model_dump(exclude_none=True) if payload.model else None


def _bilibili_search_markdown(topic: str) -> str:
    clean_topic = (topic or "学习讲解").strip()[:80]
    url = "https://search.bilibili.com/all?keyword=" + quote(clean_topic)
    return f"\n\n📺 Bilibili 相关视频：[搜索「{clean_topic}」]({url})"


# 关键词快速路由：命中即确定需求，跳过 LLM。必须同时出现“生成意图 + 资源名词”，避免误判。
_KEYWORD_ROUTES: list[tuple[re.Pattern, str, str | None]] = [
    (re.compile(r"(?:生成|制作|做份?|创建|写|出|给我|帮我|整理|梳理).{0,8}(?:讲解(?:文档|讲义)|讲义|教学文档|讲解资料|课件)"), "resource", "lecture"),
    (re.compile(r"(?:生成|画|做份?|给我|帮我|整理|梳理|列).{0,8}(?:思维导图|脑图|知识(?:结构|框架|树))"), "resource", "mindmap"),
    (re.compile(r"(?:生成|出|做份?|给我|帮我|编).{0,8}(?:题目|练习题|习题|测试题|试卷|考卷)"), "resource", "quiz"),
    (re.compile(r"(?:生成|推荐|给我|帮我|找|整理).{0,8}(?:拓展阅读|阅读材料|参考文献?|书单|参考书|学习资料)"), "resource", "reading"),
    (re.compile(r"(?:推荐|给我|帮我|找).{0,12}书(?=[单籍本]?\s*$|[，。！？])"), "resource", "reading"),
    (re.compile(r"(?:生成|写|实现|做份?|给我|帮我).{0,8}(?:代码(?:案例|示例)?|小程序|脚本|demo)"), "resource", "code"),
    # 互动刷题：逐题提问练习（区别于一次性生成题库）
    (re.compile(r"(?:刷题|逐题|一题一题|互动练习|来几道题|出题考(?:考|我)|考考我|陪我练|练(?:习|一练).{0,6}(?:题|练))"), "quiz_session", None),
]


def _keyword_route(message: str) -> dict | None:
    """阶段A-2：本地关键词快速路由。未命中返回 None，由调用方决定是否走轻量 LLM 判定。"""
    text = (message or "").strip()
    if not text:
        return None
    for pattern, action, resource_type in _KEYWORD_ROUTES:
        if pattern.search(text):
            route: dict[str, Any] = {"action": action, "resource_type": resource_type, "topic": text[:40]}
            if action == "quiz_session":
                route.pop("resource_type", None)
            return route
    # 技能名/标题命中（如“记忆卡片”“复习计划”）→ 直接使用该技能
    for skill in list_skills():
        if skill.title and skill.title in text:
            return {"action": "skill", "skill": skill.name, "topic": text[:40]}
    return None


def _template_main_plan(route: dict, message: str) -> dict:
    """需求确定后，用本地模板生成 main_plan（tasks/acceptance 不再依赖 LLM）。"""
    action = route.get("action", "chat")
    topic = route.get("topic") or message
    plan: dict[str, Any] = {"action": action, "topic": topic}
    if action == "resource":
        rtype = route.get("resource_type") or "lecture"
        plan.update({
            "resource_type": rtype,
            "tasks": [{"agent": rtype, "instruction": "完成当前请求"}],
            "acceptance": ["结果与用户请求相关", "结果可以直接展示给用户"],
        })
    elif action == "skill":
        plan.update({
            "skill": route.get("skill"),
            "tasks": [{"agent": "conversation", "instruction": "按该技能的说明处理当前请求"}],
            "acceptance": ["结果符合技能要求", "结果可以直接展示给用户"],
        })
    elif action == "quiz_session":
        plan.update({
            "tasks": [{"agent": "quiz_session", "instruction": "逐题向学生出练习题并批改讲解"}],
            "acceptance": ["逐题出题", "每道题给出点评与解析"],
        })
    elif action == "tutor":
        plan.update({
            "tasks": [{"agent": "tutor", "instruction": "完成当前辅导任务"}],
            "acceptance": ["回答与用户问题相关", "结论清晰且没有空结果"],
        })
        if route.get("video_topic"):
            plan["video_topic"] = route["video_topic"]
    else:
        plan.update({
            "tasks": [{"agent": "main", "instruction": "由主 Agent 直接回答当前学习问题"}],
            "acceptance": ["回答与用户问题相关", "结论清晰且没有空结果"],
        })
    return plan


def _active_quiz_session(db: Session, conversation_id: int) -> dict | None:
    """读取最近一条 assistant 消息中活跃的刷题会话；无则返回 None。"""
    last = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.role == "assistant")
        .order_by(Message.id.desc())
        .first()
    )
    if not last or not last.meta:
        return None
    session = last.meta.get(SESSION_KEY)
    if isinstance(session, dict) and session.get("active"):
        return session
    return None


def _friendly_model_test_error(error: Exception) -> str:
    """把供应商返回的长 HTML/错误堆栈转换成可读提示。"""
    raw = str(error).strip()
    lower = raw.lower()
    if "<!doctype html" in lower or "<html" in lower or "404 - page not found" in lower:
        return "接口返回了网页 404，而不是模型 API 响应。请检查 Base URL，填写 OpenAI 兼容 API 地址，不要填写网页首页地址。"
    if len(raw) > 360:
        return raw[:360].rstrip() + "…"
    return raw or "未知连接错误"


def _format_resource_preview(r) -> str:
    """把生成的资源格式化为对话流中的预览 Markdown。"""
    type_label = {
        "lecture": "讲解文档", "mindmap": "思维导图", "quiz": "练习题库",
        "reading": "拓展阅读", "code": "代码实操",
    }.get(r.type, r.type)
    header = f"✅ 已生成 **{type_label}**：{r.title}\n\n"
    content = r.content or {}
    if r.status == "failed":
        return f"⚠️ {type_label} 生成失败：{content.get('error', '未知错误')}"
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

    # 4. 阶段A：确定需求（三层递进，命中即止，尽量不调用 LLM）
    #    ① 显式指定 → ② 关键词快速路由 → ③ 轻量意图判定（小 prompt）
    #    互动刷题特殊：会话中已有进行中的刷题时，直接继续，不再路由。
    active_quiz = _active_quiz_session(db, conv.id)
    explicit = payload.resource_type
    if active_quiz is not None:
        # 作答 / 结束都交给 quiz_session 分支处理
        route = {"action": "quiz_session", "topic": payload.message}
        main_plan = _template_main_plan(route, payload.message)
    elif payload.mode == "quiz_session":
        # 前端显式点选「互动刷题」入口
        route = {"action": "quiz_session", "topic": payload.message}
        main_plan = _template_main_plan(route, payload.message)
    elif explicit:
        if explicit == "video":
            route = {"action": "tutor", "topic": payload.message, "video_topic": payload.message}
        else:
            route = {"action": "resource", "resource_type": explicit, "topic": payload.message}
        main_plan = _template_main_plan(route, payload.message)
    elif payload.skill:
        # 用户在前端显式点选技能：直接按该技能执行。
        route = {"action": "skill", "skill": payload.skill, "topic": payload.message}
        main_plan = _template_main_plan(route, payload.message)
    else:
        route = _keyword_route(payload.message)
        if route is None:
            # 关键词未命中 → 轻量意图判定（需求确定后才调用功能 prompt）
            try:
                route = await MainAgent().route_light(payload.message, profile, history)
            except Exception as e:
                logger.warning("light routing error: %s, fallback to chat", e)
                route = {"action": "chat", "topic": payload.message}
        main_plan = _template_main_plan(route, payload.message)

    yield _sse("plan", {
        "agent": "main",
        "tasks": main_plan.get("tasks", []),
        "acceptance": main_plan.get("acceptance", []),
    })
    yield _sse("progress", {
        "phase": "planning",
        "agent": "main",
        "status": "completed",
        "detail": "需求已确定，开始执行。",
    })

    # 通知前端路由决策
    yield _sse("route", {
        "action": route.get("action", "chat"),
        "resource_type": route.get("resource_type"),
        "skill": route.get("skill"),
        "topic": route.get("topic", ""),
    })

    # 5. 按路由结果分流执行
    action = route.get("action", "chat")
    full_text_parts: list[str] = []

    # 5. 主 Agent 通过通用调度器派发一次性 subagent。
    from ..agents.scheduler import AgentContext, AgentTask, build_default_scheduler

    # 技能解析：action=skill 时加载技能说明；技能不存在则降级为普通对话。
    skill = None
    if action == "skill":
        skill = get_skill(str(route.get("skill") or ""))
        if skill is None:
            logger.warning("skill not found: %s, fallback to chat", route.get("skill"))
            action = "chat"
            route["action"] = "chat"

    # 互动刷题会话状态（quiz_session 分支写入，其余动作保持 None）
    quiz_session_state = None

    if action in {"resource", "tutor"}:
        task_data = (main_plan.get("tasks") or [{}])[0]
        topic = route.get("topic") or payload.message
        resource_type = route.get("resource_type") if action == "resource" else None
        task_agent = str(task_data.get("agent") or resource_type or "tutor")
        if task_agent in {"main", "subagent", "conversation"}:
            task_agent = resource_type or "tutor"
        task_kind = resource_type or "tutor"
        task = AgentTask(
            agent=task_agent,
            kind=task_kind,
            topic=topic,
            instruction=str(task_data.get("instruction") or "完成主 Agent 分派的专门任务"),
        )
        yield _sse("progress", {
            "phase": "subagent",
            "agent": task.agent,
            "status": "running",
            "detail": f"{task.agent} subagent 正在执行专门任务。",
        })
        try:
            result = await build_default_scheduler().dispatch(
                task,
                AgentContext(
                    db=db,
                    student_id=student.id,
                    conversation_id=conv.id,
                    profile=profile,
                    extra=payload.context or "",
                ),
            )
            if action == "resource":
                resource = result.resource
                preview = _format_resource_preview(resource)
                full_text_parts.append(preview)
                yield _sse("token", {"text": preview})
                yield _sse("resource", {"id": resource.id, "type": resource.type, "title": resource.title, "file_url": resource.file_url})
            else:
                text = result.text
                full_text_parts.append(text)
                yield _sse("token", {"text": text})
                video_topic = result.data.get("video_topic") or route.get("video_topic")
                if video_topic:
                    video_url = result.data.get("video_url")
                    link = (
                        f"\n\n📺 Bilibili 相关视频：[搜索「{video_topic}」]({video_url})"
                        if video_url
                        else _bilibili_search_markdown(video_topic)
                    )
                    full_text_parts.append(link)
                    yield _sse("token", {"text": link})
            yield _sse("progress", {
                "phase": "subagent",
                "agent": task.agent,
                "status": "completed",
                "detail": "subagent 已返回结果，主 Agent 即将验收。",
            })
        except Exception as e:
            logger.exception("subagent dispatch failed: %s", task.agent)
            err = f"⚠️ {task.agent} subagent 执行失败：{e}"
            full_text_parts.append(err)
            yield _sse("token", {"text": err})
            yield _sse("progress", {
                "phase": "subagent",
                "agent": task.agent,
                "status": "failed",
                "detail": str(e),
            })
    elif action == "skill":
        # 技能执行：把技能指令注入上下文，由文本模型按指令流式作答。
        assert skill is not None
        yield _sse("skill", {"skill": skill.name, "title": skill.title, "description": skill.description})
        yield _sse("progress", {
            "phase": "skill",
            "agent": "skill",
            "status": "running",
            "detail": f"正在使用技能「{skill.title}」处理你的请求。",
        })
        agent = MainAgent()
        extra_context_parts: list[str] = []
        if profile:
            extra_context_parts.append(f"当前学生画像：{json.dumps(profile, ensure_ascii=False)}")
        if payload.context:
            extra_context_parts.append(f"当前子对话聚焦上下文：{payload.context[:4000]}")
        extra_context_parts.append(
            f"当前正在使用技能「{skill.title}」（{skill.name}），请求主题：{route.get('topic') or payload.message}\n\n"
            f"【技能执行说明，请严格遵守】\n{skill.content}"
        )
        extra_context = "\n\n".join(extra_context_parts)
        try:
            async for chunk in agent.stream_answer(
                payload.message,
                history=history,
                extra_context=extra_context,
            ):
                full_text_parts.append(chunk)
                yield _sse("token", {"text": chunk})
            yield _sse("progress", {"phase": "skill", "agent": "skill", "status": "completed", "detail": "技能执行完成，准备验收。"})
        except Exception as e:
            logger.exception("skill execution failed: %s", skill.name)
            yield _sse("error", {"message": str(e)})
            return
    elif action == "quiz_session":
        # 互动刷题：用 ask_question 工具逐题提问，等学生作答后再批改与出下一题。
        yield _sse("progress", {
            "phase": "quiz_session",
            "agent": "quiz_session",
            "status": "running",
            "detail": "互动刷题中，正在出题/批改…",
        })
        quiz_session = active_quiz if active_quiz is not None else new_session()
        exiting = active_quiz is not None and is_quiz_exit(payload.message)
        try:
            messages: list[dict[str, Any]] = [{"role": "system", "content": QUIZ_SYSTEM_PROMPT}]
            if profile:
                messages.append({"role": "system", "content": f"学生画像：{json.dumps(profile, ensure_ascii=False)}"})
            for h in history[-8:]:
                messages.append({"role": h.get("role", "user"), "content": str(h.get("content", ""))[:1500]})
            messages.append({"role": "user", "content": payload.message})

            tools = None if exiting else [QUIZ_TOOL]
            content, tool_calls = await chat_complete_message(
                messages,
                tools=tools,
                temperature=0.5,
                max_tokens=1200,
            )
            text_out = (content or "").strip()
            answer_question: dict[str, Any] | None = find_ask_question(tool_calls)

            if exiting or answer_question is None:
                # 学生结束 / 模型不再出题 → 收尾（小结）
                close_session(quiz_session)
                quiz_event: dict[str, Any] = {
                    "action": "summary",
                    "session": serialize_quiz_session(quiz_session),
                }
            else:
                apply_tool_args(quiz_session, answer_question)
                index = quiz_session.get("index", 0)
                question = answer_question.get("question", "")
                options = answer_question.get("options") or []
                if question and question not in text_out:
                    text_out = (text_out + "\n\n" + question).strip()
                quiz_event = {
                    "action": "question",
                    "question": question,
                    "options": options,
                    "index": index,
                    "score": quiz_session.get("score", 0),
                    "session": serialize_quiz_session(quiz_session),
                }

            if text_out:
                full_text_parts.append(text_out)
                yield _sse("token", {"text": text_out})
            yield _sse("quiz", quiz_event)
            yield _sse("progress", {
                "phase": "quiz_session",
                "agent": "quiz_session",
                "status": "completed",
                "detail": "已出题/批改完成。" if quiz_event.get("action") == "question" else "本轮练习结束。",
            })
            quiz_session_state = serialize_quiz_session(quiz_session)
        except Exception as e:
            logger.exception("quiz_session failed")
            close_session(quiz_session)
            err = f"⚠️ 互动刷题失败：{e}"
            full_text_parts.append(err)
            yield _sse("token", {"text": err})
            yield _sse("progress", {
                "phase": "quiz_session",
                "agent": "quiz_session",
                "status": "failed",
                "detail": str(e),
            })
            quiz_session_state = serialize_quiz_session(quiz_session)
    else:
        yield _sse("progress", {"phase": "main", "agent": "main", "status": "running", "detail": "主 Agent 正在直接生成回答。"})
        # 普通对话由 MainAgent 直接流式回答，不派发 conversation subagent。
        agent = MainAgent()
        extra_context_parts: list[str] = []
        if profile:
            extra_context_parts.append(f"当前学生画像：{json.dumps(profile, ensure_ascii=False)}")
        if payload.context:
            extra_context_parts.append(f"当前子对话聚焦上下文：{payload.context[:4000]}")
        extra_context = "\n\n".join(extra_context_parts)
        try:
            async for chunk in agent.stream_answer(
                payload.message,
                history=history,
                extra_context=extra_context,
            ):
                full_text_parts.append(chunk)
                yield _sse("token", {"text": chunk})
            yield _sse("progress", {"phase": "main", "agent": "main", "status": "completed", "detail": "主 Agent 已完成直接回答，准备验收。"})
        except Exception as e:
            logger.exception("main agent chat stream failed")
            yield _sse("error", {"message": str(e)})
            return

    full_text = "".join(full_text_parts)
    # 去掉遗留的画像标记后再提取专有名词，避免标记进入术语列表。
    if "[[PROFILE_READY]]" in full_text:
        full_text = full_text.replace("[[PROFILE_READY]]", "").strip()

    # ===== 先保存消息并立即结束用户可见的流式状态（done 前置），后处理并行补齐 =====
    asst_msg = Message(
        conversation_id=conv.id,
        role="assistant",
        content=full_text,
        meta={
            "profile_updated": False,
            "mode": payload.mode,
            "action": action,
            "skill": skill.name if skill else None,
            "quiz_session": quiz_session_state,
            "terms": [],
            "model_id": payload.model.id if payload.model else None,
            "main_plan": {"tasks": main_plan.get("tasks", []), "acceptance": main_plan.get("acceptance", [])},
        },
    )
    db.add(asst_msg)
    db.commit()
    db.refresh(asst_msg)

    yield _sse("done", {"conversation_id": conv.id, "student_id": student.id})

    # ===== 后处理：验收 / 术语 / 画像 并行执行，不再阻塞 done =====

    async def _post_acceptance() -> dict:
        if action in {"resource", "tutor"} and payload.model:
            return await MainAgent().accept(main_plan, full_text)
        return {"accepted": bool(full_text.strip()), "reason": "结果非空，已通过基础验收"}

    async def _post_terms() -> list[dict]:
        if action not in {"chat", "tutor", "skill"} or len(full_text.strip()) < 24:
            return []
        return await extract_terms(full_text)

    async def _post_profile():
        # 仅 chat 动作触发（resource/tutor/skill 不触发，避免干扰画像）。
        # 只取最近 30 条、每条 600 字，控制输入 token。
        if action != "chat":
            return None
        recent_rows = history_rows[-30:]
        conv_text = "\n".join(
            f"{m.role}: {(m.content or '')[:600]}" for m in recent_rows
        ) + f"\nassistant: {full_text[:2000]}"
        try:
            return await extract_profile_from_history(db, student.id, conv_text)
        except Exception as e:
            logger.warning("profile extraction failed: %s", e)
            return None

    acc_task = asyncio.create_task(_post_acceptance())
    terms_task = asyncio.create_task(_post_terms())
    profile_task = asyncio.create_task(_post_profile())

    try:
        acceptance = await acc_task
    except Exception as e:
        logger.exception("acceptance failed")
        acceptance = {"accepted": True, "reason": "验收异常，按通过处理"}
    try:
        terms = await terms_task
    except Exception:
        logger.exception("term extraction failed")
        terms = []
    profile = None
    try:
        profile = await profile_task
    except Exception:
        logger.exception("profile extraction failed")
        profile = None

    yield _sse("acceptance", {"agent": "main", **acceptance})
    yield _sse("progress", {
        "phase": "acceptance",
        "agent": "main",
        "status": "completed" if acceptance.get("accepted") else "failed",
        "detail": acceptance.get("reason", "主 Agent 验收完成"),
    })

    if terms:
        yield _sse("terms", {"terms": terms})

    profile_updated = profile is not None
    if profile:
        yield _sse("profile", {
            "version": profile.version,
            "dimensions": profile.dimensions,
            "summary": profile.raw_summary,
        })

    # 回填消息 meta（terms / acceptance / profile_updated）
    meta = dict(asst_msg.meta or {})
    meta["terms"] = terms
    meta["acceptance"] = dict(acceptance)
    meta["profile_updated"] = profile_updated
    asst_msg.meta = meta
    db.commit()


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
    branch = create_branch_conversation(db, conversation_id, title=title)
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
    try:
        ids = delete_conversation_tree(db, conversation_id)
    except ValueError:
        raise HTTPException(404, "conversation not found")
    return {"deleted_ids": ids}


@router.put("/messages/{message_id}")
def update_message(message_id: int, payload: MessageUpdate, db: Session = Depends(get_db)) -> dict:
    """编辑用户自己的消息（仅 user 角色），记录 edited 标记。"""
    m = db.get(Message, message_id)
    if not m:
        raise HTTPException(404, "message not found")
    if m.role != "user":
        raise HTTPException(400, "只能编辑自己的提问消息")
    m.content = payload.content
    meta = dict(m.meta or {})
    meta["edited"] = True
    meta["edited_at"] = datetime.utcnow().isoformat()
    m.meta = meta
    db.commit()
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "role": m.role,
        "content": m.content,
        "meta": m.meta,
        "created_at": m.created_at.isoformat(),
    }


@router.delete("/messages/{message_id}")
def delete_message(message_id: int, scope: str = "message", db: Session = Depends(get_db)) -> dict:
    """删除一条消息；scope=round 时连同配对的 assistant 回复一起删除。

    级联删除以这些消息为来源的探索卡片（含后代卡片）。
    """
    m = db.get(Message, message_id)
    if not m:
        raise HTTPException(404, "message not found")

    conv = db.get(Conversation, m.conversation_id)
    student_id = conv.student_id if conv else None

    ids = [message_id]
    if scope == "round" and m.role == "user":
        next_msg = (
            db.query(Message)
            .filter(Message.conversation_id == m.conversation_id, Message.id > message_id)
            .order_by(Message.id.asc())
            .first()
        )
        if next_msg and next_msg.role == "assistant":
            ids.append(next_msg.id)

    # 级联删除来源消息命中的探索卡片及其全部后代
    cards = db.query(ExploreCard).filter(ExploreCard.source_message_id.in_(ids)).all()
    card_ids = [c.id for c in cards]
    if card_ids and student_id:
        all_cards = (
            db.query(ExploreCard)
            .filter(ExploreCard.student_id == student_id)
            .all()
        )
        parent_by_id = {c.id: c.parent_card_id for c in all_cards}
        descendants = set(card_ids)
        frontier = list(card_ids)
        while frontier:
            current = frontier.pop()
            for child_id, parent_id in parent_by_id.items():
                if parent_id == current and child_id not in descendants:
                    descendants.add(child_id)
                    frontier.append(child_id)
        db.query(ExploreCard).filter(ExploreCard.id.in_(list(descendants))).delete(synchronize_session=False)

    db.query(Message).filter(Message.id.in_(ids)).delete(synchronize_session=False)
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
