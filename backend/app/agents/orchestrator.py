"""多智能体编排器 — 调度中心。

根据用户意图与请求参数，路由到对应角色 agent。
"""
from __future__ import annotations

from typing import Any, Optional

from .base import BaseAgent
from .coder import CoderAgent
from .image_reader import ImageReaderAgent
from .lecturer import LecturerAgent
from .mindmap import MindmapAgent
from .reader import ReaderAgent
from .tutor import TutorAgent

# 角色注册表
AGENT_REGISTRY: dict[str, type[BaseAgent]] = {
    "lecture": LecturerAgent,
    "mindmap": MindmapAgent,
    "reading": ReaderAgent,
    "code": CoderAgent,
    "image_reader": ImageReaderAgent,
    "tutor": TutorAgent,
}

# 资源类型 → agent 映射
RESOURCE_AGENT_MAP: dict[str, str] = {
    "lecture": "lecture",
    "mindmap": "mindmap",
    "reading": "reading",
    "code": "code",
}


def get_agent(role: str) -> BaseAgent:
    """按角色名实例化 agent。"""
    cls = AGENT_REGISTRY.get(role)
    if not cls:
        raise ValueError(f"unknown agent role: {role}")
    return cls()


async def route_intent(
    message: str,
    profile: Optional[dict] = None,
    explicit_mode: Optional[str] = None,
) -> str:
    """根据消息内容或显式 mode 决定路由到哪个 agent。

    返回 agent role 名。优先用显式 mode / resource_type。
    """
    if explicit_mode:
        if explicit_mode in AGENT_REGISTRY:
            return explicit_mode
        if explicit_mode in RESOURCE_AGENT_MAP:
            return RESOURCE_AGENT_MAP[explicit_mode]
    # 默认对话走通用 chat（在 chat router 里直接处理）
    return "chat"
