"""应用入口 — FastAPI。"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.info("初始化数据库...")
    init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="面向学习记录、资料整理与路径规划的工具",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)


# 注册路由
from .routers import assessment, chat, hierarchy, image_understanding, literature, paths, practice, profile, resources, skills, students, tutoring, universe  # noqa: E402

app.include_router(students.router, prefix="/api/students", tags=["students"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(profile.router, prefix="/api/profile", tags=["profile"])
app.include_router(resources.router, prefix="/api/resources", tags=["resources"])
app.include_router(paths.router, prefix="/api/paths", tags=["paths"])
app.include_router(tutoring.router, prefix="/api/tutor", tags=["tutor"])
app.include_router(assessment.router, prefix="/api/assessment", tags=["assessment"])
app.include_router(image_understanding.router, prefix="/api/image", tags=["image"])
app.include_router(hierarchy.router, prefix="/api/hierarchy", tags=["hierarchy"])
app.include_router(literature.router, prefix="/api/literature", tags=["literature"])
app.include_router(universe.router, prefix="/api/universe", tags=["universe"])
app.include_router(skills.router, prefix="/api/skills", tags=["skills"])
app.include_router(practice.router, prefix="/api/practice", tags=["practice"])


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    return {
        "status": "ok",
        "app_name": settings.app_name,
        "llm_ready": settings.llm_ready,
    }
