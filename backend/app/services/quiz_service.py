"""互动刷题服务 — 让 agent 通过 ask_question 工具逐题向用户出练习题。

设计：复用 OpenAI 兼容的 function-calling（tools）机制——
模型每次只调用一次 ask_question 出一道题，等用户作答后再在下一轮
给点评并出下一题；全部做完后不再调用工具并给出小结。

会话状态以 JSON 形式持久化在最近一条 assistant 消息的 meta.quiz_session 中，
跨请求在对话上下文里存活，无需新增数据库表。
"""
from __future__ import annotations

import json
from typing import Any

# ============================================================
# 1. 工具 schema（暴露给模型）
# ============================================================

QUIZ_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "ask_question",
        "description": "向学生出一道练习题并等待学生作答。每次调用只能出一道题；出完题必须停下等学生回答，不要连续调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "本题题目内容"},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "选择题选项（选填；最多 4 个，如 [\"A. xxx\", \"B. xxx\"]；填空题/解答题不填）",
                },
                "answer": {"type": "string", "description": "本题正确答案（选择题填选项字母或内容，解答题填答案要点）"},
                "explanation": {"type": "string", "description": "答案解析（用户作答后讲解时使用）"},
                "previous_correct": {
                    "type": "boolean",
                    "description": "学生上一题是否回答正确（第一题可不填）",
                },
                "previous_feedback": {
                    "type": "string",
                    "description": "对上一题回答的点评（第一题可不填；会先展示点评再出新题）",
                },
            },
            "required": ["question", "answer", "explanation"],
        },
    },
}

QUIZ_SYSTEM_PROMPT = """你是「互动刷题」辅导员，负责一题一题地给学生出练习题、批改并讲解。

规则：
1. 每轮只调用一次 ask_question 出一道题，出完就停下等学生作答；绝对不要一次性抛出多道题。
2. 出下一题之前，先在上一条回复内容里点评学生上一题的回答（对错 + 为什么），第一题则说明本套练习的主题与大致题量。
3. 结合学生画像控制难度，循序渐进；选择题最多 4 个选项；解答题写清题意。
4. 学生全部答完（或中途表示结束）后：总结正确数/总题数并做针对性讲解，说明练习结束，不再调用工具。
5. 用中文，语气鼓励。"""

# 学生主动结束练习的信号（仅在会话进行中生效）
QUIZ_EXIT_PATTERN = r"(?:结束|不做了|不练了|不做题了|退出|够了|就(?:到|练)这|今天(?:就)?到这|不想练|暂停|到此为止)"

# ============================================================
# 2. 会话状态（持久化在消息 meta.quiz_session）
# ============================================================

SESSION_KEY = "quiz_session"


def new_session(topic: str = "") -> dict[str, Any]:
    return {
        "active": True,
        "topic": (topic or "")[:60],
        "index": 0,          # 已出的题数
        "score": 0,          # 答对题数
        "total": None,       # 计划题数（模型自定，可为空）
        "items": [],         # [{"question", "options", "answer", "explanation", "correct"}]
    }


def is_quiz_exit(text: str) -> bool:
    import re

    return bool(re.search(QUIZ_EXIT_PATTERN, (text or "").strip()))


def apply_tool_args(session: dict[str, Any], args: dict[str, Any]) -> None:
    """把模型一次 ask_question 的调用结果写入会话状态。"""
    if args.get("previous_correct") is not None:
        session["score"] = session.get("score", 0) + (1 if args["previous_correct"] else 0)
    session["index"] = session.get("index", 0) + 1
    if args.get("total"):
        session["total"] = int(args["total"])
    items = session.get("items") or []
    items.append({
        "question": args.get("question", ""),
        "options": args.get("options") or [],
        "answer": args.get("answer", ""),
        "explanation": args.get("explanation", ""),
        "correct": bool(args["previous_correct"]) if args.get("previous_correct") is not None else None,
    })
    session["items"] = items


def close_session(session: dict[str, Any]) -> None:
    session["active"] = False


def serialize(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "active": bool(session.get("active", False)),
        "topic": session.get("topic") or "",
        "index": int(session.get("index", 0)),
        "score": int(session.get("score", 0)),
        "total": session.get("total"),
        "items": session.get("items") or [],
    }


# ============================================================
# 3. 工具参数解析
# ============================================================

def parse_ask_question_args(raw: str) -> dict[str, Any] | None:
    """解析 ask_question 的参数 JSON；解析失败或缺少 question 时返回 None。"""
    try:
        data = json.loads(raw or "{}")
    except Exception:
        return None
    if not isinstance(data, dict) or not data.get("question"):
        return None
    return data


def find_ask_question(tool_calls: list[dict]) -> dict[str, Any] | None:
    """从模型返回的 tool_calls 中取出第一个 ask_question 的有效参数。"""
    for call in tool_calls or []:
        if str(call.get("name") or "") == "ask_question":
            parsed = parse_ask_question_args(str(call.get("arguments") or ""))
            if parsed:
                return parsed
    return None