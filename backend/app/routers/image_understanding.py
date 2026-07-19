"""图片理解路由 — 上传图片 + 提问，返回识别 + 解答。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..agents.image_reader import ImageReaderAgent
from ..db import get_db
from ..services.profile_service import get_latest_profile, profile_to_dict

router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/jpg", "image/png"}
MAX_SIZE = 4 * 1024 * 1024  # 4MB（讯飞限制）


@router.post("/understand")
async def understand(
    student_id: int = Form(...),
    question: str = Form("请描述这张图片的内容"),
    image: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    """上传图片 + 提问，返回讯飞识别 + LLM 结合画像的解答。"""
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"unsupported image type: {image.content_type}（仅支持 jpg/png）")

    image_bytes = await image.read()
    if len(image_bytes) > MAX_SIZE:
        raise HTTPException(400, f"image too large: {len(image_bytes)} bytes (max 4MB)")

    profile = profile_to_dict(get_latest_profile(db, student_id))
    agent = ImageReaderAgent()
    result = await agent.understand(image_bytes, question, profile)
    return result
