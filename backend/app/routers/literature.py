"""文献导入路由 — PDF/TXT/MD 正文提取 + 可点击术语抽取（哪里不懂点哪里）。"""
from __future__ import annotations

import io
import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..agents.terms import extract_terms
from ..db import get_db
from ..llm.factory import reset_active_model, set_active_model
from ..models import Literature
from ..schemas import LiteratureDetailOut, LiteratureOut, LiteratureTermsRequest

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_SIZE = 10 * 1024 * 1024  # 10MB
MAX_TEXT = 200_000  # 20 万字符
CHUNK_SIZE = 4000
CHUNK_OVERLAP = 300
MAX_TERMS = 40


def _extract_text(filename: str, raw: bytes) -> tuple[str, str]:
    """从上传文件提取纯文本，返回 (text, source_type)。"""
    name = filename.lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        pages = [(page.extract_text() or "") for page in reader.pages]
        return "\n\n".join(pages), "pdf"
    if name.endswith((".txt", ".md", ".markdown")):
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("gbk", errors="replace")
        return text, ("md" if name.endswith((".md", ".markdown")) else "txt")
    raise ValueError("仅支持 PDF / TXT / Markdown 文件")


def _chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """重叠分块，保证跨块术语不被漏掉。"""
    if len(text) <= size:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        chunks.append(text[start : start + size])
        start += size - overlap
    return chunks


async def _extract_terms_from_text(text: str, model: dict[str, Any] | None) -> list[dict[str, str]]:
    """分块抽取术语并合并去重。"""
    all_terms: list[dict[str, str]] = []
    seen: set[str] = set()
    token = set_active_model(model)
    try:
        for chunk in _chunk_text(text):
            try:
                for term in await extract_terms(chunk, max_terms=8):
                    if term["text"] not in seen:
                        seen.add(term["text"])
                        all_terms.append(term)
            except Exception as exc:
                logger.warning("literature chunk term extraction failed: %s", exc)
                continue
            if len(all_terms) >= MAX_TERMS:
                break
    finally:
        reset_active_model(token)
    return all_terms


@router.post("/upload", response_model=LiteratureOut)
async def upload(
    student_id: int | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> LiteratureOut:
    """上传文献（PDF/TXT/MD），提取正文并入库（术语随后用 POST /{id}/terms 提取）。"""
    from ..services.student_service import get_local_student_id

    sid = student_id or get_local_student_id(db)
    raw = await file.read()
    if len(raw) > MAX_SIZE:
        raise HTTPException(400, f"文件过大（{len(raw) // 1024 // 1024}MB），上限 10MB")

    try:
        text, source_type = _extract_text(file.filename or "", raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    text = text.strip()
    if len(text) < 20:
        raise HTTPException(400, "未从文件中提取到文本（扫描版 PDF 不支持），请改用 TXT/Markdown 或直接粘贴")

    title = (file.filename or "未命名").rsplit(".", 1)[0][:120]
    lit = Literature(
        student_id=sid,
        title=title,
        source_type=source_type,
        text=text[:MAX_TEXT],
        terms=[],
        meta={"chars": len(text)},
    )
    db.add(lit)
    db.commit()
    db.refresh(lit)
    return LiteratureOut.model_validate(lit)


@router.post("/{literature_id}/terms", response_model=LiteratureOut)
async def extract_literature_terms(
    literature_id: int,
    payload: LiteratureTermsRequest | None = None,
    db: Session = Depends(get_db),
) -> LiteratureOut:
    """从文献正文抽取可点击术语（可重试）。"""
    lit = db.get(Literature, literature_id)
    if not lit:
        raise HTTPException(404, "literature not found")
    model = payload.model.model_dump(exclude_none=True) if payload and payload.model else None
    try:
        lit.terms = await _extract_terms_from_text(lit.text, model)
    except Exception as exc:
        raise HTTPException(400, f"术语提取失败：{exc}")
    db.commit()
    db.refresh(lit)
    return LiteratureOut.model_validate(lit)


@router.get("", response_model=list[LiteratureOut])
def list_literatures(student_id: int | None = None, db: Session = Depends(get_db)) -> list[LiteratureOut]:
    from ..services.student_service import get_local_student_id

    sid = student_id or get_local_student_id(db)
    rows = (
        db.query(Literature)
        .filter(Literature.student_id == sid)
        .order_by(Literature.created_at.desc())
        .all()
    )
    return [LiteratureOut.model_validate(r) for r in rows]


@router.get("/{literature_id}", response_model=LiteratureDetailOut)
def get_literature(literature_id: int, db: Session = Depends(get_db)) -> LiteratureDetailOut:
    lit = db.get(Literature, literature_id)
    if not lit:
        raise HTTPException(404, "literature not found")
    return LiteratureDetailOut.model_validate(lit)


@router.delete("/{literature_id}")
def delete_literature(literature_id: int, db: Session = Depends(get_db)) -> dict:
    lit = db.get(Literature, literature_id)
    if not lit:
        raise HTTPException(404, "literature not found")
    db.delete(lit)
    db.commit()
    return {"id": literature_id, "status": "deleted"}
