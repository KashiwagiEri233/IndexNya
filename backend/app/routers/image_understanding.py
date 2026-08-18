"""图片理解路由 — 上传图片 + 提问，由文本模型的多模态能力直接解答。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..agents.image_reader import ImageReaderAgent
from ..db import get_db

router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/jpg", "image/png"}
MAX_SIZE = 4 * 1024 * 1024  # 4MB（多模态模型输入限制）


@router.post("/understand")
async def understand(
    student_id: int | None = Form(None),
    question: str = Form("请描述这张图片的内容"),
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """上传图片 + 提问，返回文本模型（多模态）的针对性解答。"""
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"unsupported image type: {image.content_type}（仅支持 jpg/png）")

    image_bytes = await image.read()
    if len(image_bytes) > MAX_SIZE:
        raise HTTPException(400, f"image too large: {len(image_bytes)} bytes (max 4MB)")

    agent = ImageReaderAgent()
    result = await agent.understand(image_bytes, question, content_type=image.content_type)
    return result
