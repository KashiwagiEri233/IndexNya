"""互动刷题服务 — 让 agent 通过 ask_question 工具逐题向用户出练习题。

设计：复用 OpenAI 兼容的 function-calling（tools）机制——
模型每次只调用一次 ask_question 出一道题，等用户作答后再在下一轮
给点评并出下一题；全部做完后不再调用工具并给出小结。

会话状态以 JSON 形式持久化在最近一条 assistant 消息的 meta.quiz_session 中，
跨请求在对话上下文里存活，无需新增数据库表。
"""
from __future__ import annotations

import json
import re
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
                "question": {"type": "string", "description": "本题题目内容（题干）"},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "选择题选项（单选/多选题必填，4 个选项，如 [\"A. xxx\", \"B. xxx\", \"C. xxx\", \"D. xxx\"]；填空题/简答题传空数组 []）",
                },
                "answer": {"type": "string", "description": "本题正确答案（选择题填选项字母或内容，解答题填答案要点）"},
                "explanation": {"type": "string", "description": "答案解析（下一轮讲解时使用）"},
                "previous_correct": {
                    "type": "boolean",
                    "description": "学生上一题是否回答正确（第一题可不填）",
                },
                "previous_feedback": {
                    "type": "string",
                    "description": "对上一题回答的简明点评（第一题可不填）",
                },
            },
            "required": ["question", "answer", "explanation"],
        },
    },
}

QUIZ_SYSTEM_PROMPT = """你是「互动刷题」辅导员，负责一题一题地给学生出练习题、即时批改并深入讲解。

规则：
1. 职责分工：
   - 【正文回复】：专门用于对学生上一题回答的点评与讲解（指出对错、详细解析原因、梳理核心考点对比）。第一题则简要说明本套练习的主题与大致题量（默认 5 题）。注意：绝对不要在正文回复里写下一题的题干和选项！
   - 【ask_question 工具】：下一题的题干、选项、标准答案和解析必须且只能通过调用 ask_question 工具提供！
2. 逐题提问：每轮必须且只能调用一次 ask_question 工具出一道新题，出完题后立即停下等待学生作答，绝对不要一次性抛出多道题。
3. 选择题选项：如果是单选/多选题，options 必须包含 4 个完整的选项字符串，如 ["A. 选项一", "B. 选项二", "C. 选项三", "D. 选项四"]；简答/填空题 options 传 []。
4. 题目循序渐进：难度贴合学生水平，结合上一题的答题情况针对性强化薄弱点。
5. 结束条件：当全部 5 道题答完，或者学生中途明确表示结束/退出时：在正文回复中对整轮练习做总结（答对题数、正确率与重点复习建议），此时【不要】再调用 ask_question 工具。
6. 全程使用中文，语气专业亲切、积极鼓励。"""

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
        "total": 5,          # 默认计划 5 题
        "items": [],         # [{"question", "options", "answer", "explanation", "correct"}]
    }


def is_quiz_exit(text: str) -> bool:
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
# 3. 工具参数解析与容错修复
# ============================================================

def _repair_and_load_json(raw: str) -> dict | None:
    text = (raw or "").strip()
    if not text:
        return None
    # 剥离 markdown 代码块
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if m:
        text = m.group(1).strip()

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    # 尝试修复被截断的 JSON
    start = text.find("{")
    if start != -1:
        fragment = text[start:]
        # 去掉末尾未闭合的引号
        unescaped_quotes = len(re.findall(r'(?<!\\)"', fragment))
        if unescaped_quotes % 2 != 0:
            fragment += '"'
        open_brackets = fragment.count("[") - fragment.count("]")
        if open_brackets > 0:
            fragment += "]" * open_brackets
        open_braces = fragment.count("{") - fragment.count("}")
        if open_braces > 0:
            fragment += "}" * open_braces
        try:
            data = json.loads(fragment)
            if isinstance(data, dict):
                return data
        except Exception:
            pass

    return None


def parse_ask_question_args(raw: str) -> dict[str, Any] | None:
    """解析 ask_question 的参数 JSON；支持截断修复与正则回退。"""
    data = _repair_and_load_json(raw)
    if data and isinstance(data, dict) and data.get("question"):
        opts = data.get("options")
        if not isinstance(opts, list):
            opts = []
        data["options"] = opts
        return data

    # 正则提取 fallback
    text = str(raw or "")
    q_match = re.search(r'"question"\s*:\s*"((?:[^"\\]|\\.)+)', text)
    if not q_match:
        return None

    try:
        question = q_match.group(1).encode("utf-8").decode("unicode_escape", errors="ignore")
    except Exception:
        question = q_match.group(1)

    options = []
    opt_match = re.search(r'"options"\s*:\s*\[([\s\S]*?)\]', text)
    if opt_match:
        options = [o.strip('" \r\n\t') for o in re.findall(r'"((?:[^"\\]|\\.)+)"', opt_match.group(1))]

    ans_match = re.search(r'"answer"\s*:\s*"((?:[^"\\]|\\.)+)', text)
    try:
        answer = ans_match.group(1).encode("utf-8").decode("unicode_escape", errors="ignore") if ans_match else ""
    except Exception:
        answer = ans_match.group(1) if ans_match else ""

    exp_match = re.search(r'"explanation"\s*:\s*"((?:[^"\\]|\\.)+)', text)
    try:
        explanation = exp_match.group(1).encode("utf-8").decode("unicode_escape", errors="ignore") if exp_match else ""
    except Exception:
        explanation = exp_match.group(1) if exp_match else ""

    corr_match = re.search(r'"previous_correct"\s*:\s*(true|false)', text, re.IGNORECASE)
    previous_correct = (corr_match.group(1).lower() == "true") if corr_match else None

    feed_match = re.search(r'"previous_feedback"\s*:\s*"((?:[^"\\]|\\.)+)', text)
    try:
        previous_feedback = feed_match.group(1).encode("utf-8").decode("unicode_escape", errors="ignore") if feed_match else ""
    except Exception:
        previous_feedback = feed_match.group(1) if feed_match else ""

    return {
        "question": question,
        "options": options,
        "answer": answer,
        "explanation": explanation,
        "previous_correct": previous_correct,
        "previous_feedback": previous_feedback,
    }


def find_ask_question(tool_calls: list[dict]) -> dict[str, Any] | None:
    """从模型返回的 tool_calls 中取出第一个 ask_question 的有效参数。"""
    for call in tool_calls or []:
        name = str(call.get("name") or "")
        if name in ("ask_question", "functions.ask_question"):
            parsed = parse_ask_question_args(str(call.get("arguments") or ""))
            if parsed:
                return parsed
    return None


def try_extract_question_from_text(text: str) -> dict[str, Any] | None:
    """当模型未通过 tool_calls 出题但正文实际输出了题目时，从正文提取作为容错 fallback。"""
    if not text:
        return None
    raw = text.strip()

    # 提取选择题选项：A. xxx / A、xxx / A) xxx
    opt_matches = re.findall(r"(?:^|\n)\s*([A-D][.、\s\)].*?)(?=(?:\n\s*[A-D][.、\s\)])|$)", raw, re.DOTALL)
    options = [o.strip() for o in opt_matches if o.strip()]
    if len(options) >= 2:
        before_opts = raw[:raw.find(options[0])].strip()
        lines = [l.strip() for l in before_opts.split("\n") if l.strip()]
        if lines:
            question = lines[-1]
            question = re.sub(r"^(?:下一题[：:]?|第[一二三四五六七八九十0-9]+题[：:]?|题目[：:]?|\d+[.、]\s*)", "", question).strip()
            if question:
                return {
                    "question": question,
                    "options": options[:4],
                    "answer": "",
                    "explanation": "",
                    "previous_correct": "回答错误" not in raw and "❌" not in raw if ("回答正确" in raw or "答对" in raw or "✅" in raw or "❌" in raw or "回答错误" in raw) else None,
                }

    # 检查是否有明显的出题提示词
    q_match = re.search(r"(?:下一题[：:]|请问[：:]?|思考题[：:]?)([\s\S]+)$", raw)
    if q_match:
        q_text = q_match.group(1).strip()
        if 5 <= len(q_text) <= 500 and "练习结束" not in q_text and "小结" not in q_text and "总结" not in q_text:
            return {
                "question": q_text,
                "options": [],
                "answer": "",
                "explanation": "",
                "previous_correct": None,
            }

    return None
