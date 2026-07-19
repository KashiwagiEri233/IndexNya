"""视频 Agent — 多模态教学视频（资源类型 2-f）。

调用讯飞数字人视频生成 API，把知识点讲解文案交给数字人播报。
"""
from __future__ import annotations

import logging
from typing import Any

from ..llm.factory import chat_complete
from ..tools.xfyun_video import generate_video
from .base import BaseAgent

logger = logging.getLogger(__name__)


class VideoistAgent(BaseAgent):
    name = "videoist"
    system_prompt = """你是一位教学视频策划智能体，擅长把知识点转化为适合数字人播报的讲解文案。

要求：
1. 文案口语化、有节奏，适合听讲（不是文档风格）
2. **严格控制字数**：测试模式 ≤50 字（视频时长约 10 秒内）；正常模式 80-150 字
3. 开头一句话引入主题，中间 1 个核心要点，结尾简短总结
4. 避免复杂公式、代码（口述不出来）
5. 只输出文案本身，不要解释或标签"""

    async def plan_script(self, topic: str, profile: dict, short: bool = False) -> str:
        """根据主题和学生画像生成数字人讲解文案。

        short=True 时控制文案 ≤50 字，使生成的视频时长在 10 秒以内。
        """
        ctx = f"学生画像：{profile}"
        mode_hint = "（测试模式：文案严格 ≤50 字，一句话讲清核心，视频时长目标 10 秒内）" if short else "（正常模式：80-150 字）"
        text = await chat_complete(
            [
                {"role": "system", "content": self.system_prompt},
                {"role": "system", "content": ctx},
                {"role": "user", "content": f"请为「{topic}」写一段数字人讲解文案{mode_hint}。"},
            ],
            temperature=0.5,
            max_tokens=256 if short else 512,
        )
        return text.strip()

    async def generate(
        self,
        topic: str,
        profile: dict,
        script: str | None = None,
        short: bool = False,
    ) -> dict[str, Any]:
        """生成数字人视频。script 为空时自动策划文案。

        short=True 时生成短文案（≤50 字），视频时长约 10 秒内。
        """
        script = script or await self.plan_script(topic, profile, short=short)
        # 清洗文案：去 markdown 符号、多余空白、引号，避免讯飞审核 400
        import re
        script = re.sub(r"```.*?```", "", script, flags=re.DOTALL)  # 代码块
        script = re.sub(r"[*_#>`\-]{2,}", "", script)  # markdown 强调符号
        script = script.replace("\n", " ").replace('"', "").replace("'", "")
        script = re.sub(r"\s+", " ", script).strip()
        if not script:
            script = topic  # 兜底
        # 讯飞要求 prompt ≤ 300 字符；short 模式截到 80 字以内（视频 ≤10s），正常 ≤200 字
        limit = 80 if short else 200
        if len(script) > limit:
            script = script[:limit].rsplit("，", 1)[0] + "。"
        try:
            # word_count 是讯飞 API 的文案字数上限（50-300，必须整数）。
            wc = 50 if short else int(min(max(len(script) // 3, 50), 300))
            logger.info("video generate: script_len=%d, word_count=%d, script=%s",
                        len(script), wc, script[:80])
            # 提交任务后立即返回 task_id，不阻塞等待（视频生成耗时数分钟）
            from ..tools.xfyun_video import create_video_task
            task_id = await create_video_task(script, word_count=wc)
            return {
                "topic": topic,
                "script": script,
                "video_url": None,
                "cover_url": None,
                "audio_url": None,
                "text_url": None,
                "task_id": task_id,
                "status": "processing",  # 前端可轮询查询
                "error": None,
            }
        except Exception as e:
            logger.exception("video generation failed")
            return {
                "topic": topic,
                "script": script,
                "video_url": None,
                "status": "failed",
                "error": str(e),
            }
