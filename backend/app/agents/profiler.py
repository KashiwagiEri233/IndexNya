"""画像构建 Agent — 功能1。

通过自然语言对话抽取学生特征，构建 ≥6 维度动态学生画像。
"""
from __future__ import annotations

import logging
from typing import Any

from .base import AgentResult, BaseAgent

logger = logging.getLogger(__name__)


PROFILE_DIMENSIONS = [
    "major",              # 专业方向
    "knowledge_base",     # 知识基础
    "cognitive_style",    # 认知风格（视觉/听觉/动手，归纳/演绎）
    "common_mistakes",    # 易错点偏好
    "learning_goals",     # 学习目标
    "pace_preference",    # 学习节奏（快进/精读/反复）
    "interests",          # 兴趣领域
    "attention_span",     # 专注时长
]


class ProfilerAgent(BaseAgent):
    name = "profiler"
    system_prompt = """你是一位学习画像构建智能体。你的任务是通过自然、亲切的对话，了解学生的专业、学习目标、知识基础、认知风格、易错点、学习节奏、兴趣等，为该学生构建动态学习画像。

对话原则：
1. 一次只问 1-2 个问题，避免问卷式轰炸
2. 用中文，语气温和、有引导性，像辅导员
3. 当信息收集足够（至少覆盖 6 个维度）时，主动告知用户画像已就绪
4. 不要主动暴露维度名称，自然地融入对话

画像维度（内部参考）：
- major：专业方向
- knowledge_base：知识基础与薄弱点
- cognitive_style：认知风格（视觉/听觉/动手 + 归纳/演绎）
- common_mistakes：易错点偏好
- learning_goals：短期/长期学习目标
- pace_preference：学习节奏偏好
- interests：兴趣领域
- attention_span：专注时长

当用户说"生成画像"或信息已充分时，请在最后一段严格按以下 JSON 格式输出画像（只输出 JSON，不要其他文字）：
{"major": "...", "knowledge_base": "...", "cognitive_style": "...", "common_mistakes": "...", "learning_goals": "...", "pace_preference": "...", "interests": "...", "attention_span": "...", "summary": "一句话总结该学生画像"}"""

    async def extract_profile(self, conversation_text: str) -> dict[str, Any]:
        """从对话历史中抽取画像 JSON。"""
        data, raw = await self.run_json(
            f"以下是该学生与你的对话历史，请基于此抽取学生画像 JSON：\n\n{conversation_text}\n\n"
            f"严格按以下扁平 JSON 结构输出（不要嵌套，不要 user_profile 外层）：\n"
            f'{{"major":"...","knowledge_base":"...","cognitive_style":"...",'
            f'"common_mistakes":"...","learning_goals":"...","pace_preference":"...",'
            f'"interests":"...","attention_span":"...","summary":"一句话总结"}}',
            temperature=0.2,
            max_tokens=1024,
        )
        if not data:
            logger.warning("profile extract: run_json returned empty, raw=%s", raw[:300])
        # 兼容 LLM 返回嵌套 {user_profile: {...}} 的情况
        if "user_profile" in data and isinstance(data["user_profile"], dict):
            inner = data["user_profile"]
            # 把内层字段映射到标准维度
            mapping = {
                "major": ["major", "专业", "专业方向"],
                "knowledge_base": ["knowledge_base", "基础", "知识基础", "weak_subjects", "薄弱点"],
                "learning_goals": ["learning_goals", "目标", "target_university", "考研目标"],
                "common_mistakes": ["common_mistakes", "易错点"],
                "cognitive_style": ["cognitive_style", "learning_style", "认知风格"],
                "pace_preference": ["pace_preference", "节奏"],
                "interests": ["interests", "兴趣"],
                "attention_span": ["attention_span", "专注"],
            }
            for std_key, aliases in mapping.items():
                if not data.get(std_key):
                    for alias in aliases:
                        if alias in inner:
                            v = inner[alias]
                            data[std_key] = ", ".join(str(x) for x in v) if isinstance(v, list) else str(v)
                            break
            if not data.get("summary"):
                # 用 grade + major + target 拼 summary
                parts = []
                if inner.get("grade"): parts.append(str(inner["grade"]))
                if data.get("major"): parts.append(data["major"])
                if inner.get("target_university"): parts.append(f"目标:{inner['target_university']}")
                if data.get("knowledge_base"): parts.append(f"薄弱:{data['knowledge_base']}")
                data["summary"] = " | ".join(parts)
        # 补全缺失维度
        for dim in PROFILE_DIMENSIONS:
            data.setdefault(dim, "")
        data.setdefault("summary", "")
        return data
