"""Pydantic 请求/响应模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ===== 学生 =====
class StudentCreate(BaseModel):
    name: str = "同学"


class StudentOut(BaseModel):
    id: int
    name: str
    created_at: datetime

    class Config:
        from_attributes = True


# ===== 画像 =====
class ProfileOut(BaseModel):
    id: int
    student_id: int
    version: int
    dimensions: dict[str, Any]
    raw_summary: str
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    """手动微调画像维度。"""
    dimensions: dict[str, Any]


# ===== 对话 =====
class ChatModelConfig(BaseModel):
    """前端可选的 OpenAI 兼容模型配置。密钥仅用于当前请求，不写入数据库。"""
    id: Optional[str] = None
    name: Optional[str] = None
    model: str
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class BranchConversationRequest(BaseModel):
    title: Optional[str] = None


class ChatRequest(BaseModel):
    """流式对话请求。

    resource_type: 若提供，则本次对话路由到指定资源生成 agent
    """
    conversation_id: Optional[int] = None
    student_id: Optional[int] = None
    message: str
    resource_type: Optional[str] = None  # lecture/mindmap/quiz/reading/code/illustration/ppt
    mode: str = "chat"  # chat / profile / resource / tutor
    model: Optional[ChatModelConfig] = None
    context: Optional[str] = None


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    role: str
    content: str
    meta: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ConversationOut(BaseModel):
    id: int
    student_id: int
    title: str
    parent_conversation_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ===== 资源 =====
class ResourceGenerateRequest(BaseModel):
    student_id: int
    conversation_id: Optional[int] = None
    type: str  # lecture/mindmap/quiz/reading/code/illustration/ppt
    topic: str
    extra: dict[str, Any] = Field(default_factory=dict)
    model: Optional[ChatModelConfig] = None


class ResourceOut(BaseModel):
    id: int
    student_id: int
    type: str
    title: str
    content: dict[str, Any]
    file_url: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ===== 学习路径 =====
class PathPlanRequest(BaseModel):
    student_id: int
    goal: str


class PathOut(BaseModel):
    id: int
    student_id: int
    goal: str
    nodes: list[dict[str, Any]]
    version: int
    created_at: datetime

    class Config:
        from_attributes = True


# ===== 智能辅导 =====
class TutorAskRequest(BaseModel):
    student_id: int
    question: str
    context_resource_id: Optional[int] = None
    modality: str = "text"  # text / diagram / video（推荐相关视频）


# ===== 学习效果评估 =====
class AssessmentTrack(BaseModel):
    student_id: int
    resource_id: Optional[int] = None
    status: str = "not_started"
    score: Optional[float] = None
    time_spent_min: float = 0.0
    feedback: Optional[str] = None


class AssessmentOut(BaseModel):
    id: int
    student_id: int
    dimension: str
    score: float
    evidence: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AssessmentDashboard(BaseModel):
    student_id: int
    dimensions: list[dict[str, Any]]  # [{name, score, evidence}]
    total_score: float
    recommendation: str


# ===== 通用 =====
class HealthOut(BaseModel):
    status: str
    app_name: str
    llm_ready: bool
