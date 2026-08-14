"""思维宇宙服务 — 本地确定性嵌入、相似度、锚点注入、图构建。

嵌入方案：本地字符 bigram + 词哈希（512 维归一化），无外部依赖、确定可比。
后续可扩展 OpenAI 兼容 embedding 模型，但相似度/图/锚点统一使用本地空间，
保证不同来源的向量可比。
"""
from __future__ import annotations

import hashlib
import math
import re
from typing import Any

from sqlalchemy.orm import Session

from ..llm.factory import json_complete
from ..models import Understanding

_DIM = 512
_SIMILAR_UPDATE_THRESHOLD = 0.92
_GRAPH_LINK_THRESHOLD = 0.45
_GRAPH_MAX_LINKS_PER_NODE = 3


def _tokens(text: str) -> list[str]:
    """分词：拉丁/数字词 + 单字 CJK + CJK 相邻二字组。"""
    text = (text or "").lower()
    tokens: list[str] = []
    for match in re.finditer(r"[a-z0-9_]+|[\u4e00-\u9fff]", text):
        token = match.group(0)
        if re.fullmatch(r"[a-z0-9_]+", token):
            if len(token) < 32:
                tokens.append(token)
        else:
            tokens.append(token)
    cjk = [c for c in text if "\u4e00" <= c <= "\u9fff"]
    tokens.extend(cjk[i] + cjk[i + 1] for i in range(len(cjk) - 1))
    return tokens


def local_embed(text: str) -> list[float]:
    """特征哈希词袋向量（带符号），L2 归一化。"""
    vec = [0.0] * _DIM
    for token in _tokens(text):
        digest = hashlib.md5(token.encode("utf-8")).hexdigest()
        index = int(digest[:8], 16) % _DIM
        sign = 1.0 if (int(digest[8:16], 16) & 1) else -1.0
        vec[index] += sign
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


def cosine(a: list[float], b: list[float]) -> float:
    """两向量余弦（假定均已归一化；长度不一致时安全兜底）。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


def _embedding_of(understanding: Understanding) -> list[float]:
    if understanding.embedding:
        return list(understanding.embedding)
    return local_embed(understanding.concept)


def list_understandings(db: Session, student_id: int) -> list[Understanding]:
    return (
        db.query(Understanding)
        .filter(Understanding.student_id == student_id, Understanding.status == "approved")
        .order_by(Understanding.created_at.desc())
        .all()
    )


def _find_similar(db: Session, student_id: int, concept: str, threshold: float) -> Understanding | None:
    """返回与该概念最相似且超过阈值的已有理解（用于更新而非重复）。"""
    target = local_embed(concept)
    best: Understanding | None = None
    best_score = threshold
    for u in list_understandings(db, student_id):
        score = cosine(target, _embedding_of(u))
        if score > best_score:
            best = u
            best_score = score
    return best


async def evaluate_summary(concept: str, summary: str, profile: dict) -> dict[str, Any]:
    """AI 评审学生用自己的话表达的理解。"""
    prompt = f"""你是「思维宇宙」的评审智能体。学生用自己的话表达了对某个概念的理解，
请判断这份理解是否准确、完整、清晰，并且确实是学生自己的表达（而非抄写）。

概念：{concept}
学生的理解：
{summary}

学生画像（供参考）：
{profile}

只输出 JSON，不要其他文字：
{{
  "approved": true,
  "score": 82,
  "feedback": "一句鼓励且具体的反馈",
  "missing": ["缺失或不够准确的点1", "点2"]
}}

评分标准：准确性 40 分、完整性 30 分、清晰度 15 分、原创性（自己的话）15 分，满分 100。
score >= 60 时 approved 为 true，否则为 false。"""
    try:
        raw = await json_complete(
            [
                {"role": "system", "content": "你是一位严谨而鼓励人的学习评审专家。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=1024,
        )
        data = _parse_json(raw)
        if not data:
            return {"approved": False, "score": 0, "feedback": "评审服务暂不可用，请稍后重试。", "missing": []}
        approved = bool(data.get("approved"))
        score = max(0.0, min(100.0, float(data.get("score") or 0)))
        if score >= 60:
            approved = True
        return {
            "approved": approved,
            "score": round(score, 1),
            "feedback": str(data.get("feedback") or ""),
            "missing": list(data.get("missing") or []),
        }
    except Exception:
        return {"approved": False, "score": 0, "feedback": "评审服务暂不可用，请稍后重试。", "missing": []}


def _parse_json(raw: str) -> dict:
    """从 LLM 输出解析 JSON（兼容 ```json 包裹与前后杂文）。"""
    import json as _json
    import re as _re

    cleaned = (raw or "").strip()
    m = _re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", cleaned, _re.DOTALL)
    if m:
        cleaned = m.group(1)
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            cleaned = cleaned[start : end + 1]
    try:
        data = _json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def create_or_update_understanding(
    db: Session,
    student_id: int,
    concept: str,
    summary: str,
    verdict: dict[str, Any],
) -> Understanding:
    """认可的理解入库；与既有概念高度相似时更新原节点。"""
    existing = _find_similar(db, student_id, concept, _SIMILAR_UPDATE_THRESHOLD)
    embedding = local_embed(f"{concept} {summary}")
    anchors = [
        {"concept": u.concept, "summary": u.summary[:120]}
        for u in _related(db, student_id, concept, k=3, exclude=existing.id if existing else None)
    ]
    if existing:
        existing.summary = summary
        existing.ai_score = float(verdict.get("score") or 0)
        existing.ai_feedback = str(verdict.get("feedback") or "")
        existing.embedding = embedding
        existing.anchors = anchors
        db.commit()
        db.refresh(existing)
        return existing
    u = Understanding(
        student_id=student_id,
        concept=concept,
        summary=summary,
        ai_score=float(verdict.get("score") or 0),
        ai_feedback=str(verdict.get("feedback") or ""),
        status="approved",
        embedding=embedding,
        anchors=anchors,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _related(
    db: Session,
    student_id: int,
    topic: str,
    k: int = 5,
    exclude: int | None = None,
) -> list[Understanding]:
    target = local_embed(topic)
    scored: list[tuple[float, Understanding]] = []
    for u in list_understandings(db, student_id):
        if exclude is not None and u.id == exclude:
            continue
        scored.append((cosine(target, _embedding_of(u)), u))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [u for _score, u in scored[:k]]


def related_dicts(
    db: Session,
    student_id: int,
    topic: str,
    k: int = 5,
    exclude: int | None = None,
) -> list[dict[str, Any]]:
    """带相似度的相关理解列表（锚点探测用）。"""
    target = local_embed(topic)
    scored: list[tuple[float, Understanding]] = []
    for u in list_understandings(db, student_id):
        if exclude is not None and u.id == exclude:
            continue
        scored.append((cosine(target, _embedding_of(u)), u))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [
        {
            "id": u.id,
            "concept": u.concept,
            "summary": u.summary,
            "score": u.ai_score,
            "similarity": round(sim, 3),
        }
        for sim, u in scored[:k]
    ]


def get_anchor_context(db: Session, student_id: int, topic: str, k: int = 5) -> str:
    """渲染知识锚点片段，供 chat / 资源生成 agent 注入上下文。"""
    related = _related(db, student_id, topic, k=k)
    if not related:
        return ""
    lines = [f"📌 你已掌握的思维锚点（学生用自己的话表达，讲解时请优先从这些出发建立联系）："]
    for u in related:
        summary = (u.summary or "").strip().replace("\n", " ")
        lines.append(f"- 「{u.concept}」：{summary[:140]}")
    lines.append(f"请结合新概念「{topic}」与上述锚点的联系来讲解。")
    return "\n".join(lines)


def build_graph(db: Session, student_id: int) -> dict[str, Any]:
    """构建思维宇宙图：节点 + 相似边（保留每节点 top-k，阈值过滤）。"""
    us = list_understandings(db, student_id)
    if not us:
        return {"nodes": [], "links": []}
    vectors = [_embedding_of(u) for u in us]
    nodes = [
        {
            "id": str(u.id),
            "concept": u.concept,
            "summary": (u.summary or "")[:200],
            "score": u.ai_score,
            "size": 4.0 + (u.ai_score / 25.0),
        }
        for u in us
    ]
    links: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for i in range(len(us)):
        scored = [
            (cosine(vectors[i], vectors[j]), j)
            for j in range(len(us))
            if j != i
        ]
        scored.sort(key=lambda item: item[0], reverse=True)
        for sim, j in scored[: _GRAPH_MAX_LINKS_PER_NODE]:
            if sim < _GRAPH_LINK_THRESHOLD:
                continue
            key = (str(us[i].id), str(us[j].id))
            rev = (key[1], key[0])
            if key in seen or rev in seen:
                continue
            seen.add(key)
            links.append({
                "source": str(us[i].id),
                "target": str(us[j].id),
                "weight": round(sim, 3),
            })
    return {"nodes": nodes, "links": links}
