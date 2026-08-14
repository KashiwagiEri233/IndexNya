"""ORM 模型 — 学生、画像、对话、消息、资源、学习路径、进度、评估。"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), default="同学")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    profiles: Mapped[list["Profile"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    conversations: Mapped[list["Conversation"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    resources: Mapped[list["Resource"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    paths: Mapped[list["LearningPath"]] = relationship(back_populates="student", cascade="all, delete-orphan")


class Profile(Base):
    """学生画像 — 每次更新生成新版本，支持随学随新。

    dimensions_json 内含 ≥6 维度：
      major / knowledge_base / cognitive_style / common_mistakes /
      learning_goals / pace_preference / interests / attention_span
    """

    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    version: Mapped[int] = mapped_column(Integer, default=1)
    dimensions: Mapped[dict] = mapped_column(JSON, default=dict)
    raw_summary: Mapped[Optional[str]] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    student: Mapped["Student"] = relationship(back_populates="profiles")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    title: Mapped[str] = mapped_column(String(128), default="新对话")
    parent_conversation_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("conversations.id"), nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    student: Mapped["Student"] = relationship(back_populates="conversations")
    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    role: Mapped[str] = mapped_column(String(16))  # user / assistant / tool / system
    content: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")


class Resource(Base):
    """生成的学习资源 — 7 类之一。"""

    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    conversation_id: Mapped[Optional[int]] = mapped_column(ForeignKey("conversations.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(32))  # lecture/mindmap/quiz/reading/code/illustration/ppt
    title: Mapped[str] = mapped_column(String(256))
    content: Mapped[dict] = mapped_column(JSON, default=dict)  # 结构化内容
    file_url: Mapped[Optional[str]] = mapped_column(String(512), default=None)
    status: Mapped[str] = mapped_column(String(16), default="completed")  # pending/processing/completed/failed
    meta: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    student: Mapped["Student"] = relationship(back_populates="resources")


class LearningPath(Base):
    """个性化学习路径 — 版本化，支持动态调整。"""

    __tablename__ = "learning_paths"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    goal: Mapped[str] = mapped_column(String(256))
    nodes: Mapped[list] = mapped_column(JSON, default=list)  # [{step,title,resource_ids[],hours,depends_on[]}]
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    student: Mapped["Student"] = relationship(back_populates="paths")


class Progress(Base):
    """学生学习行为 / 资源使用 / 测试结果跟踪。"""

    __tablename__ = "progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    resource_id: Mapped[Optional[int]] = mapped_column(ForeignKey("resources.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="not_started")  # not_started/learning/completed
    score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    time_spent_min: Mapped[float] = mapped_column(Float, default=0.0)
    feedback: Mapped[Optional[str]] = mapped_column(Text, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Assessment(Base):
    """学习效果评估 — 多维度精准评分。"""

    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    dimension: Mapped[str] = mapped_column(String(64))  # 掌握度/参与度/效率/...
    score: Mapped[float] = mapped_column(Float, default=0.0)
    evidence: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ExploreCard(Base):
    """层级对话探索卡片 — 挂在对话/消息上的卡片树节点。

    type: child(子卡片/深挖背景) / related(关联卡片/横向对比) / branch(分支卡片/继承上下文另起炉灶)
    卡片结构与生成内容（content）持久化：关闭后重开可恢复先前的回复。
    """

    __tablename__ = "explore_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    conversation_id: Mapped[Optional[int]] = mapped_column(ForeignKey("conversations.id"), nullable=True)
    parent_card_id: Mapped[Optional[int]] = mapped_column(ForeignKey("explore_cards.id"), nullable=True)
    source_message_id: Mapped[Optional[int]] = mapped_column(ForeignKey("messages.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(16))  # child/related/branch
    term: Mapped[str] = mapped_column(String(128))
    context: Mapped[str] = mapped_column(Text, default="")  # 来源上下文快照，重开卡片时使用
    branch_conversation_id: Mapped[Optional[int]] = mapped_column(ForeignKey("conversations.id"), nullable=True)
    content: Mapped[Optional[dict]] = mapped_column(JSON, default=None)  # {"question", "messages":[{role,content,terms}]}
    status: Mapped[str] = mapped_column(String(16), default="completed")  # processing/completed/failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Literature(Base):
    """导入的文献 — 正文 + 抽取出的可点击术语。"""

    __tablename__ = "literatures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    title: Mapped[str] = mapped_column(String(256))
    source_type: Mapped[str] = mapped_column(String(16))  # pdf/txt/md
    text: Mapped[str] = mapped_column(Text, default="")
    terms: Mapped[list] = mapped_column(JSON, default=list)  # [{text, explanation, relation}]
    meta: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Understanding(Base):
    """思维宇宙 — 学生用自己的话表达、经 AI 认可后沉淀的理解。"""

    __tablename__ = "understandings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"))
    concept: Mapped[str] = mapped_column(String(128))
    summary: Mapped[str] = mapped_column(Text, default="")
    ai_score: Mapped[float] = mapped_column(Float, default=0.0)
    ai_feedback: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="approved")
    embedding: Mapped[Optional[list]] = mapped_column(JSON, default=list)  # 本地确定性向量，相似度/图/锚点统一空间
    anchors: Mapped[list] = mapped_column(JSON, default=list)  # 相关联的已掌握概念名
    source: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
