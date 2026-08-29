"""Pydantic 请求/响应模型。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ===== 对话 =====
class ChatModelConfig(BaseModel):
    """前端可选的 OpenAI 兼容模型配置。密钥仅用于当前请求，不写入数据库。"""
    id: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = "chat"
    model: str
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    reasoning_effort: Optional[str] = None  # off/minimal/low/medium/high/xhigh/max，透传给支持的接口


class BranchConversationRequest(BaseModel):
    title: Optional[str] = None


class ChatRequest(BaseModel):
    """流式对话请求。

    resource_type: 若提供，则本次对话路由到指定资源生成 agent
    """
    conversation_id: Optional[int] = None
    student_id: Optional[int] = None
    message: str
    resource_type: Optional[str] = None  # lecture/mindmap/reading/code
    mode: str = "chat"  # chat / resource / tutor / quiz_session
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
    student_id: Optional[int] = None  # 本地单用户：缺省使用本地学生
    conversation_id: Optional[int] = None
    type: str  # lecture/mindmap/reading/code
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


# ===== 智能辅导 =====
class TutorAskRequest(BaseModel):
    question: str
    context_resource_id: Optional[int] = None
    modality: str = "text"  # text / video（推荐相关视频）


# ===== 通用 =====
class HealthOut(BaseModel):
    status: str
    app_name: str


# ===== 层级对话（探索卡片） =====
class ExploreRequest(BaseModel):
    """打开/重新生成一张探索卡片。

    mode: child(深挖背景) / related(横向对比) / branch(继承上下文的分支对话)
    card_id: 重开已有卡片时传入，复用该行而非新建
    """
    student_id: Optional[int] = None  # 本地单用户：缺省使用本地学生
    term: str
    explanation: Optional[str] = None
    context: str = ""
    mode: str = "child"
    conversation_id: Optional[int] = None
    source_message_id: Optional[int] = None
    parent_card_id: Optional[int] = None
    card_id: Optional[int] = None
    seed_message: Optional[str] = None
    model: Optional[ChatModelConfig] = None


class CardOut(BaseModel):
    id: int
    student_id: int
    conversation_id: Optional[int] = None
    parent_card_id: Optional[int] = None
    source_message_id: Optional[int] = None
    type: str
    term: str
    context: str = ""
    branch_conversation_id: Optional[int] = None
    content: Optional[dict[str, Any]] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ===== 消息编辑 / 删除 =====
class MessageUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)


# ===== 文献 =====
class LiteratureTermsRequest(BaseModel):
    model: Optional[ChatModelConfig] = None


class LiteratureOut(BaseModel):
    id: int
    student_id: int
    title: str
    source_type: str
    terms: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime

    class Config:
        from_attributes = True


class LiteratureDetailOut(LiteratureOut):
    text: str = ""


# ===== 思维宇宙 =====
class EvaluateRequest(BaseModel):
    concept: str = Field(min_length=1, max_length=128)
    summary: str = Field(min_length=1, max_length=20000)
    model: Optional[ChatModelConfig] = None


class UnderstandingOut(BaseModel):
    id: int
    student_id: int
    concept: str
    summary: str
    ai_score: float
    ai_feedback: str
    anchors: list = Field(default_factory=list)
    created_at: datetime

    class Config:
        from_attributes = True


class UniverseGraphOut(BaseModel):
    nodes: list[dict[str, Any]]
    links: list[dict[str, Any]]


class AnchorOut(BaseModel):
    topic: str
    anchors: list[dict[str, Any]]


# ===== 数据导出（session log / 笔记导出） =====
class NotesExportRequest(BaseModel):
    """把选中对话导出为笔记/思维导图。

    format: both（笔记+导图）/ notes（仅笔记）/ mindmap（仅导图）
    mode:   direct（直接整理原文）/ ai（调用模型提炼）
    """
    conversation_ids: list[int]
    format: str = "both"
    mode: str = "direct"
    model: Optional[ChatModelConfig] = None
