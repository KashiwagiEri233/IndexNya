"""通用 subagent 调度器。

主 Agent 只负责生成 AgentTask；调度器负责根据注册表启动一次性 subagent、
传入统一上下文并返回标准化结果。subagent 不持有跨请求状态。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from sqlalchemy.orm import Session


@dataclass
class AgentTask:
    agent: str
    kind: str
    topic: str
    instruction: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentContext:
    db: Session
    student_id: int
    conversation_id: int | None
    profile: dict[str, Any]
    extra: str = ""


@dataclass
class AgentResult:
    text: str = ""
    resource: Any | None = None
    data: dict[str, Any] = field(default_factory=dict)


Handler = Callable[[AgentTask, AgentContext], Awaitable[AgentResult]]


class AgentScheduler:
    """按 agent 名称注册和调度一次性 subagent。"""

    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}

    def register(self, name: str, handler: Handler) -> "AgentScheduler":
        self._handlers[name] = handler
        return self

    async def dispatch(self, task: AgentTask, context: AgentContext) -> AgentResult:
        handler = self._handlers.get(task.agent)
        if handler is None:
            raise ValueError(f"未注册的 subagent：{task.agent}")
        # handler 内部临时实例化 agent，dispatch 返回后不会保留运行状态。
        return await handler(task, context)


async def _run_tutor(task: AgentTask, context: AgentContext) -> AgentResult:
    from .tutor import TutorAgent

    result = await TutorAgent().answer(task.topic, context.profile, context=task.instruction, modality="text")
    return AgentResult(text=result.get("text", ""), data=result)


async def _run_resource(task: AgentTask, context: AgentContext) -> AgentResult:
    from ..services.resource_service import generate_resource

    resource = await generate_resource(
        context.db,
        context.student_id,
        task.kind,
        task.topic,
        conversation_id=context.conversation_id,
        extra={"instruction": task.instruction} if task.instruction else None,
    )
    return AgentResult(resource=resource, data={"resource_id": resource.id, "resource_type": resource.type})


def build_default_scheduler() -> AgentScheduler:
    scheduler = AgentScheduler()
    scheduler.register("tutor", _run_tutor)
    for resource_type in ("lecture", "mindmap", "quiz", "reading", "code"):
        scheduler.register(resource_type, _run_resource)
    return scheduler
