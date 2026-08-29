"""对话导出 — 把选中的若干对话整理为 Markdown 笔记 / mermaid 思维导图。

mode:
  direct — 不调模型，忠实整理对话原文（笔记）+ 由对话结构推导导图（稳定、免费）
  ai     — 调用模型把对话提炼为结构化笔记与知识点导图（更精炼，需模型）
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..llm.factory import json_complete, reset_active_model, set_active_model
from ..models import Conversation, Message

logger = logging.getLogger(__name__)

_ROLE_LABEL = {"user": "问", "assistant": "答"}


def _plain(text: str) -> str:
    """去掉 markdown 语法与空白，得到单行纯文本（用于导图节点摘要）。"""
    t = re.sub(r"```.*?```", " ", text or "", flags=re.DOTALL)
    t = re.sub(r"[#>*_`~\[\](){}|!\-]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _summarize(text: str, limit: int = 28) -> str:
    plain = _plain(text)
    if len(plain) > limit:
        plain = plain[:limit] + "…"
    return plain or "（空）"


def _load_conversations(db: Session, conversation_ids: list[int]) -> tuple[list[Conversation], dict[int, list[Message]]]:
    """读取选中对话及其消息（保持对话顺序与消息时间顺序）。"""
    conversations = (
        db.query(Conversation)
        .filter(Conversation.id.in_(conversation_ids))
        .order_by(Conversation.id.asc())
        .all()
    )
    messages_by_conv: dict[int, list[Message]] = {}
    for conv in conversations:
        msgs = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id, Message.role.in_(("user", "assistant")))
            .order_by(Message.id.asc())
            .all()
        )
        messages_by_conv[conv.id] = msgs
    return conversations, messages_by_conv


def _direct_notes(conversations: list[Conversation], messages_by_conv: dict[int, list[Message]]) -> str:
    """直接整理：把每个对话的问答原文输出为结构化 markdown 笔记。"""
    parts: list[str] = [
        "# IndexNya 学习笔记",
        "",
        f"> 导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M')} · 共 {len(conversations)} 个对话",
        "",
    ]
    for conv in conversations:
        parts.append(f"## {conv.title}")
        parts.append("")
        msgs = messages_by_conv.get(conv.id, [])
        if not msgs:
            parts.append("（无消息）")
            parts.append("")
            continue
        for m in msgs:
            if m.role == "user":
                parts.append(f"**问：** {m.content.strip()}")
                parts.append("")
            else:
                parts.append("**答：**")
                parts.append("")
                parts.append(m.content.strip())
                parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def _direct_mindmap(conversations: list[Conversation], messages_by_conv: dict[int, list[Message]]) -> str:
    """直接整理：按「根 → 对话 → 问答轮 → 问答摘要」推导 mermaid mindmap。"""
    lines = ["mindmap", "  root((IndexNya 学习笔记))"]
    for conv in conversations:
        conv_node = _summarize(conv.title, 20)
        lines.append(f"    {conv_node}")
        msgs = messages_by_conv.get(conv.id, [])
        # 每「问+答」为一轮
        rounds: list[tuple[Message | None, Message | None]] = []
        current_question: Message | None = None
        for m in msgs:
            if m.role == "user":
                current_question = m
            elif current_question is not None:
                rounds.append((current_question, m))
                current_question = None
            else:
                rounds.append((None, m))
        if current_question is not None:
            rounds.append((current_question, None))
        for q, a in rounds:
            q_node = _summarize(q.content, 20) if q else "（问题）"
            lines.append(f"      {q_node}")
            if a is not None:
                a_node = _summarize(a.content, 24)
                lines.append(f"        {a_node}")
    return "\n".join(lines)


_AI_PROMPT = """你是学习内容整理助手。请把下面的对话内容整理为学习笔记和思维导图。

要求：
1. notes：用中文输出结构化 Markdown 笔记，提炼关键知识点、概念、结论与易错点，去除口语化，保留重要细节，分点清晰（标题用 ## / ###）。
2. mindmap：输出 mermaid 的 mindmap 语法源码，以知识点为节点组织成树（根节点用 root((学习主题))，子节点为知识点/概念/要点，节点文本简短、不含括号或特殊标点）。

只输出一个 JSON 对象，不要输出其他文字：
{{"notes": "markdown 笔记全文", "mindmap": "mindmap 语法源码"}}

对话内容：
{dialog}"""


async def _ai_summarize(
    conversations: list[Conversation],
    messages_by_conv: dict[int, list[Message]],
    model: dict | None,
) -> tuple[str, str]:
    """AI 提炼：调用模型把对话整理为笔记 + 导图。"""
    dialog_parts: list[str] = []
    for conv in conversations:
        dialog_parts.append(f"【对话：{conv.title}】")
        for m in messages_by_conv.get(conv.id, []):
            dialog_parts.append(f"{_ROLE_LABEL.get(m.role, m.role)}：{m.content[:4000]}")
    dialog = "\n".join(dialog_parts)[:30000]

    token = set_active_model(model)
    try:
        raw = await json_complete(
            [
                {"role": "system", "content": "你是严谨的学习内容整理助手，只输出 JSON。"},
                {"role": "user", "content": _AI_PROMPT.format(dialog=dialog)},
            ],
            temperature=0.3,
            max_tokens=6000,
        )
    finally:
        reset_active_model(token)

    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    try:
        data = json.loads(cleaned)
        if not isinstance(data, dict):
            return "", ""
        return str(data.get("notes") or ""), str(data.get("mindmap") or "")
    except Exception:
        logger.warning("ai notes summarize parse failed")
        return "", ""


async def export_notes(
    db: Session,
    conversation_ids: list[int],
    fmt: str = "both",
    mode: str = "direct",
    model: dict | None = None,
) -> dict[str, Any]:
    """导出选中对话为笔记/思维导图，返回 {filename, content}。"""
    if not conversation_ids:
        raise ValueError("请至少选择一个对话")
    conversations, messages_by_conv = _load_conversations(db, conversation_ids)
    if not conversations:
        raise ValueError("未找到所选对话")

    if mode == "ai":
        notes, mindmap = await _ai_summarize(conversations, messages_by_conv, model)
        if not notes and not mindmap:
            raise ValueError("AI 提炼失败：模型未返回有效内容，请稍后重试或改用「直接整理」")
    else:
        notes = _direct_notes(conversations, messages_by_conv)
        mindmap = _direct_mindmap(conversations, messages_by_conv)

    fence = "```"
    blocks: list[str] = []
    if fmt in ("both", "notes") and notes:
        blocks.append(notes)
    if fmt in ("both", "mindmap") and mindmap:
        blocks.append("\n---\n\n## 思维导图\n\n" + fence + "mermaid\n" + mindmap + "\n" + fence + "\n")

    content = "\n".join(blocks).strip() + "\n"
    if not content.strip():
        raise ValueError("没有可导出的内容")

    filename = f"indexnya-notes-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    return {"filename": filename, "content": content}
