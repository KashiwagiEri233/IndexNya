"""智能辅导路由 — 功能4后端接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..agents.tutor import TutorAgent
from ..db import get_db
from ..models import Resource
from ..schemas import TutorAskRequest

router = APIRouter()


@router.post("/ask")
async def ask(payload: TutorAskRequest, db: Session = Depends(get_db)) -> dict:
    profile: dict = {}  # 学习画像功能已移除
    context = ""
    if payload.context_resource_id:
        r = db.get(Resource, payload.context_resource_id)
        if r:
            context = f"{r.title}（{r.type}）：{str(r.content)[:500]}"
    agent = TutorAgent()
    result = await agent.answer(
        payload.question, profile, context=context, modality=payload.modality
    )
    return result
