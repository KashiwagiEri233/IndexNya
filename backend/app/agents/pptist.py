"""本地 PPT 生成 Agent — 不调用模型和在线 PPT 服务。"""
from __future__ import annotations

import asyncio
from typing import Any

from ..tools.local_ppt import generate_local_ppt
from .base import BaseAgent


class PPTistAgent(BaseAgent):
    """根据主题使用固定教学模板生成本地 PPT 文件。"""

    name = "pptist"

    async def generate(
        self,
        topic: str,
        profile: dict,
        extra: str = "",
    ) -> dict[str, Any]:
        # python-pptx 是同步库，放到线程中避免阻塞异步请求。
        return await asyncio.to_thread(generate_local_ppt, topic, extra=extra)
