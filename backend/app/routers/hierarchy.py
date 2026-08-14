"""层级对话路由 — 探索卡片（哪里不懂点哪里）。

POST /api/hierarchy/explore  SSE 流式生成一张探索卡片：
  child   — 子卡片：深挖背景知识
  related — 关联卡片：横向对比发散
  branch  — 分支卡片：继承上下文另起炉灶（创建真实分支对话）

GET/DELETE /api/cards*  — 卡片树查询与级联删除（供侧边栏节点树使用）。
"""
from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..agents.terms import extract_terms
from ..db import get_db
from ..llm.factory import chat_stream, reset_active_model, set_active_model
from ..models import Conversation, ExploreCard, Message, Student
from ..schemas import CardOut, ExploreRequest
from ..services.conversation_service import delete_conversation_tree
from ..services.profile_service import get_latest_profile, profile_to_dict
from ..services.universe_service import get_anchor_context

router = APIRouter()
logger = logging.getLogger(__name__)

CHILD_PROMPT = """你是一位背景知识深挖讲解智能体。学生点击了术语「{term}」，希望深入理解它的背景知识。

要求：
1. 先一句话给出清晰定义，再讲清楚它为什么存在、解决什么问题、依赖哪些前置知识（这是重点：深挖背景）
2. 难度与例子严格匹配学生画像（知识基础、认知风格、专业方向）
3. 关键概念配公式、Mermaid 或 ASCII 图示
4. 融入易错点提醒，标注"⚠ 易错"
5. 结尾给出 1-2 个延伸思考问题
6. 如果上下文给出了知识锚点，优先从学生已掌握的锚点出发建立联系

用中文，Markdown 输出，不要包裹在代码块中。"""

RELATED_PROMPT = """你是一位概念发散对比智能体。学生想围绕「{term}」做横向对比发散。

要求：
1. 找出与「{term}」最相关的 3-5 个概念/方法/变体，每个用一句话说明与它的关系
2. 给出 Markdown 对比表格，列：概念 | 核心区别 | 与「{term}」的联系 | 适用场景
3. 说明如何继续发散学习（给出 2-3 条关键词探索路径）
4. 难度与深度匹配学生画像；如上下文给出知识锚点，先建立与锚点的联系

用中文，Markdown 输出，不要包裹在代码块中。"""

BRANCH_PROMPT = """你是一条分支对话中的讲解智能体。学生从主线对话中另起炉灶，聚焦术语「{term}」。

要求：
1. 先一句话给出清晰定义，再系统讲解（背景、原理、例子、易错点）
2. 难度与例子严格匹配学生画像（知识基础、认知风格、专业方向）
3. 关键概念配公式、Mermaid 或 ASCII 图示
4. 结尾给出 1-2 个延伸思考问题
5. 如上下文给出知识锚点，优先从学生已掌握的锚点出发建立联系

用中文，Markdown 输出，不要包裹在代码块中。"""


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _mode_prompt(mode: str, term: str) -> str:
    template = {"child": CHILD_PROMPT, "related": RELATED_PROMPT, "branch": BRANCH_PROMPT}.get(mode, CHILD_PROMPT)
    return template.format(term=term)


def _context_block(payload: ExploreRequest, profile: dict, anchors: str) -> str:
    parts: list[str] = []
    if payload.explanation:
        parts.append(f"已有简要解释：{payload.explanation[:300]}")
    if payload.context:
        parts.append(f"来源上下文（学生点击的位置）：\n{payload.context[:8000]}")
    if profile:
        parts.append(f"学生画像：{json.dumps(profile, ensure_ascii=False)}")
    if anchors:
        parts.append(anchors)
    return "\n\n".join(parts)


def _get_or_reuse_card(db: Session, payload: ExploreRequest, mode: str, term: str) -> ExploreCard:
    """重开（card_id）时更新原行，否则新建。"""
    if payload.card_id:
        card = db.get(ExploreCard, payload.card_id)
        if card and card.student_id == payload.student_id:
            card.type = mode
            card.term = term
            card.context = (payload.context or "")[:8000]
            card.source_message_id = payload.source_message_id or card.source_message_id
            card.status = "processing"
            db.commit()
            db.refresh(card)
            return card
    card = ExploreCard(
        student_id=payload.student_id,
        conversation_id=payload.conversation_id,
        parent_card_id=payload.parent_card_id,
        source_message_id=payload.source_message_id,
        type=mode,
        term=term,
        context=(payload.context or "")[:8000],
        status="processing",
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return card


async def _stream_explore(db: Session, payload: ExploreRequest) -> AsyncIterator[str]:
    """生成一张探索卡片的 SSE 事件流。"""
    token = set_active_model(payload.model.model_dump(exclude_none=True) if payload.model else None)
    mode = payload.mode if payload.mode in ("child", "related", "branch") else "child"
    term = (payload.term or "").strip()[:120]
    profile = profile_to_dict(get_latest_profile(db, payload.student_id))
    anchors = get_anchor_context(db, payload.student_id, term)
    branch_conv: Conversation | None = None
    card: ExploreCard | None = None
    try:
        # 重开已有卡片时先取回原行（分支模式可复用原分支对话，避免重复创建）
        if payload.card_id:
            existing = db.get(ExploreCard, payload.card_id)
            if existing and existing.student_id == payload.student_id:
                card = existing

        # branch 模式：创建（或复用）继承上下文的分支对话
        if mode == "branch":
            conv_id = payload.conversation_id or (card.conversation_id if card else None)
            if not conv_id:
                yield _sse("error", {"message": "分支卡片需要来源对话（conversation_id）"})
                return
            source = db.get(Conversation, conv_id)
            if not source or source.student_id != payload.student_id:
                yield _sse("error", {"message": "来源对话不存在"})
                return
            if card and card.branch_conversation_id:
                branch_conv = db.get(Conversation, card.branch_conversation_id)
            if not branch_conv:
                from ..services.conversation_service import branch_conversation as create_branch
                branch_conv = create_branch(db, source.id, title=f"围绕「{term}」的分支")
                if card is None:
                    card = ExploreCard(
                        student_id=payload.student_id,
                        conversation_id=source.id,
                        parent_card_id=payload.parent_card_id,
                        source_message_id=payload.source_message_id,
                        type="branch",
                        term=term,
                        context=(payload.context or "")[:8000],
                        status="processing",
                    )
                    db.add(card)
                card.branch_conversation_id = branch_conv.id
                db.commit()
                db.refresh(card)
            seed = (payload.seed_message or "").strip() or f"请结合上文，完整讲解「{term}」。"
            db.add(Message(conversation_id=branch_conv.id, role="user", content=seed))
            db.commit()

        if card is None:
            card = _get_or_reuse_card(db, payload, mode, term)
        else:
            card.type = mode
            card.term = term
            card.context = (payload.context or "")[:8000]
            if payload.source_message_id:
                card.source_message_id = payload.source_message_id
            card.status = "processing"
            db.commit()
            db.refresh(card)

        yield _sse("meta", {
            "card_id": card.id,
            "mode": mode,
            "conversation_id": payload.conversation_id,
            "branch_conversation_id": branch_conv.id if branch_conv else None,
            "source_message_id": payload.source_message_id,
        })

        ctx = _context_block(payload, profile, anchors)
        messages: list[dict[str, Any]] = [{"role": "system", "content": _mode_prompt(mode, term)}]
        if ctx:
            messages.append({"role": "system", "content": ctx})
        # 用户补充的问题（seed_message）全模式生效；留空时使用默认讲解文案
        user_content = (payload.seed_message or "").strip() or f"请围绕术语「{term}」展开。"
        messages.append({"role": "user", "content": user_content})

        full_text_parts: list[str] = []
        async for chunk in chat_stream(messages, temperature=0.6, max_tokens=4096):
            full_text_parts.append(chunk)
            yield _sse("token", {"text": chunk})
        full_text = "".join(full_text_parts)

        terms = await extract_terms(full_text)
        if terms:
            yield _sse("terms", {"terms": terms})

        # 分支模式：把回答写入分支对话，供侧边栏/历史读取
        if mode == "branch" and branch_conv:
            db.add(Message(
                conversation_id=branch_conv.id,
                role="assistant",
                content=full_text,
                meta={"mode": "explore", "term": term, "terms": terms},
            ))
            db.commit()

        # 落库生成内容：关闭卡片后重开可恢复先前的回复
        card.content = {
            "question": user_content,
            "messages": [
                {"role": "user", "content": user_content},
                {"role": "assistant", "content": full_text, "terms": terms},
            ],
        }
        card.status = "completed"
        db.commit()
        yield _sse("done", {"card_id": card.id})
    except Exception as exc:
        logger.exception("explore card generation failed")
        if card:
            card.status = "failed"
            db.commit()
        yield _sse("error", {"message": f"探索卡片生成失败：{exc}"})
    finally:
        reset_active_model(token)


@router.post("/explore")
async def explore(payload: ExploreRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    """打开/重新生成一张探索卡片（SSE 流式）。"""
    if not (payload.term or "").strip():
        raise HTTPException(400, "term is required")
    if not db.get(Student, payload.student_id):
        raise HTTPException(404, "student not found")
    return StreamingResponse(
        _stream_explore(db, payload),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/cards", response_model=list[CardOut])
def list_cards(student_id: int, db: Session = Depends(get_db)) -> list[CardOut]:
    """返回该学生的全部探索卡片（前端按 conversation_id 分组、按 parent 组树）。"""
    rows = (
        db.query(ExploreCard)
        .filter(ExploreCard.student_id == student_id)
        .order_by(ExploreCard.created_at.desc())
        .all()
    )
    return [CardOut.model_validate(r) for r in rows]


@router.delete("/cards/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)) -> dict:
    """删除卡片及其全部后代；分支卡片附带删除其分支对话。"""
    card = db.get(ExploreCard, card_id)
    if not card:
        raise HTTPException(404, "card not found")

    all_cards = (
        db.query(ExploreCard)
        .filter(ExploreCard.student_id == card.student_id)
        .all()
    )
    parent_by_id = {c.id: c.parent_card_id for c in all_cards}
    ids = [card.id]
    frontier = [card.id]
    while frontier:
        current = frontier.pop()
        for child_id, parent_id in parent_by_id.items():
            if parent_id == current and child_id not in ids:
                ids.append(child_id)
                frontier.append(child_id)

    branch_conversation_ids = [
        c.branch_conversation_id for c in all_cards
        if c.id in ids and c.branch_conversation_id
    ]
    for conv_id in branch_conversation_ids:
        try:
            delete_conversation_tree(db, conv_id)
        except ValueError:
            pass

    db.query(ExploreCard).filter(ExploreCard.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted_ids": ids}
