"""数据导出/导入路由 — session log 备份与恢复 + 对话导出为笔记/导图。"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import NotesExportRequest
from ..services.data_service import export_data, import_data
from ..services.notes_service import export_notes
from ..services.student_service import get_local_student_id

router = APIRouter()

MAX_SIZE = 50 * 1024 * 1024  # 50MB


@router.get("/export")
def export(db: Session = Depends(get_db)) -> dict:
    """导出本地单用户的全部数据（JSON，可直接作为 session log 文件下载）。"""
    return export_data(db, get_local_student_id(db))


@router.post("/import")
async def import_sessionlog(
    file: UploadFile = File(...),
    mode: str = Form("merge"),  # restore（覆盖恢复）/ merge（合并追加）
    db: Session = Depends(get_db),
) -> dict:
    """导入 session log 文件。mode=restore 覆盖恢复；mode=merge 合并追加。"""
    if mode not in ("restore", "merge"):
        raise HTTPException(400, "mode 必须是 restore 或 merge")

    raw = await file.read()
    if len(raw) > MAX_SIZE:
        raise HTTPException(400, f"文件过大（{len(raw) // 1024 // 1024}MB），上限 50MB")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("gbk", errors="replace")
        except Exception:
            raise HTTPException(400, "文件不是有效的 UTF-8 文本")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(400, "文件不是有效的 JSON")

    try:
        return import_data(db, get_local_student_id(db), data, mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/export-notes")
async def export_notes_endpoint(payload: NotesExportRequest, db: Session = Depends(get_db)) -> dict:
    """把选中对话导出为笔记 / 思维导图（markdown）。"""
    fmt = payload.format if payload.format in ("both", "notes", "mindmap") else "both"
    mode = payload.mode if payload.mode in ("direct", "ai") else "direct"
    try:
        result = await export_notes(
            db,
            payload.conversation_ids,
            fmt=fmt,
            mode=mode,
            model=payload.model.model_dump(exclude_none=True) if payload.model else None,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return result

