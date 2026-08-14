"""术语抽取 — 从回答/文献文本中提取可点击追问的专有名词。

供对话主流程（chat.py）、层级对话（hierarchy.py）、文献导入（literature.py）共用。
每个术语带 relation：
  background — 理解本段所需的背景知识（点开默认 → 子卡片深挖）
  related    — 与主题并列/对比的相关概念（点开默认 → 关联卡片发散）

鲁棒性设计（保证"名词可点击"在任何模型下都成立）：
  1. 匹配目标为回答全文（不截断），忽略空白差异——避免长回答尾部术语丢失
  2. LLM 输出非纯 JSON 时，正则降级抽取 text 字段（兼容中文引号）
  3. 全部失败时本地启发式兜底，保证返回非空，术语始终可点
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..llm.factory import json_complete

logger = logging.getLogger(__name__)

# 启发式兜底黑名单（常见虚词/泛词，避免把"但是""比如"变成可点术语）
_STOP_WORDS = {
    "因为", "所以", "但是", "如果", "就是", "可以", "我们", "你们", "他们", "这个", "那个",
    "什么", "怎么", "一个", "不是", "没有", "自己", "然后", "而且", "或者", "对于", "通过",
    "进行", "使用", "其中", "以及", "一些", "这样", "那样", "比如", "例如", "所谓", "等等",
    "以上", "以下", "部分", "主要", "重要", "基本", "常见", "通常", "一般", "可能", "需要",
    "应该", "能够", "已经", "开始", "之后", "之前", "同时", "由于", "根据", "相关", "涉及",
    "包括", "这些", "那些", "一种", "两种", "三种", "第一", "第二", "第三", "首先", "其次",
    "最后", "其实", "本质", "简单", "复杂", "过程", "问题", "情况", "时候", "方式", "方法",
    "内容", "概念", "思想", "原理", "结构", "特点", "优势", "缺点", "方面", "层面", "角度",
    "值得注意", "可以看出", "总的来说", "也就是说", "换句话说", "来看", "来说", "而言",
    "换个角度", "进一步", "本质上", "实际上", "也就是说",
}


async def extract_terms(answer: str, max_terms: int = 10) -> list[dict[str, str]]:
    """从一段文本中提取可点击的专有名词；失败时逐级降级，保证尽量非空。"""
    if len(answer.strip()) < 24:
        return []
    sample = answer[:12000]
    prompt = f"""请从下面这段文本中提取适合学生点击追问的专有名词。

要求：
1. 只提取技术名词、学科概念、实体名称、方法/框架/协议名称，不要提取普通动词、形容词或泛化词。
2. text 必须是文本中原样出现的连续短语，不要改写（保留原文的空格与写法）。
3. 最多提取 {max_terms} 个，优先选择最值得展开解释的词。
4. explanation 用一句中文简要解释这个词，方便子对话展示。
5. relation 表示该词与文本主题的关系，只输出两种值：
   - "background"：理解这段内容所需的背景知识（如前置概念、底层原理）
   - "related"：与主题并列、可横向对比或发散的相关概念
6. 如果没有合适的词，返回空数组。

只输出 JSON 数组，格式如下：
[{{"text":"虚拟 DOM","explanation":"用于描述界面结构并优化更新过程的内存表示","relation":"background"}}]

文本内容：
{sample}"""
    cleaned = ""
    try:
        raw = await json_complete(
            [
                {"role": "system", "content": "你是一个严谨的学习内容术语标注器。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=1500,
        )
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        data: Any = json.loads(cleaned)
        if isinstance(data, dict):
            data = data.get("terms", [])
        if isinstance(data, list):
            terms = _normalize_terms(data, answer, max_terms)
            if terms:
                return terms
    except Exception as exc:
        logger.debug("term extraction parse failed, fallback: %s", exc)

    # 降级 1：LLM 输出不完整/非纯 JSON 时，正则抽取 text 字段
    fallback = _fallback_terms(cleaned or answer, answer, max_terms)
    if fallback:
        logger.debug("term extraction used regex fallback (%d terms)", len(fallback))
        return fallback

    # 降级 2：本地启发式兜底，保证术语始终可点
    heuristic = _heuristic_terms(answer, max_terms)
    if heuristic:
        logger.debug("term extraction used heuristic fallback (%d terms)", len(heuristic))
    return heuristic


def _matches(text: str, answer: str) -> bool:
    """宽松匹配：原文包含该文本（忽略空白差异，兼容全半角空格）。"""
    if text in answer:
        return True
    compact_text = text.replace(" ", "").replace("\u3000", "").replace("\t", "")
    compact_answer = answer.replace(" ", "").replace("\u3000", "").replace("\t", "")
    return compact_text in compact_answer


def _normalize_terms(data: Any, answer: str, max_terms: int) -> list[dict[str, str]]:
    terms: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        explanation = str(item.get("explanation") or "").strip()
        if not text or text in seen or len(text) > 48 or not _matches(text, answer):
            continue
        if len(explanation) > 180:
            explanation = explanation[:180].rstrip() + "…"
        relation = str(item.get("relation") or "").lower()
        if relation not in ("background", "related"):
            relation = "background"
        terms.append({"text": text, "explanation": explanation, "relation": relation})
        seen.add(text)
        if len(terms) >= max_terms:
            break
    return terms


def _fallback_terms(raw: str, answer: str, max_terms: int) -> list[dict[str, str]]:
    """从残缺 JSON 中按正则抽取 text 字段（兼容中英文引号、冒号变体）。"""
    patterns = [
        r'["“\']text["”\']?\s*[:：]\s*["“\']([^"”\']{1,48})["”\']',
        r'text\s*[:：]\s*["“\']([^"”\']{1,48})["”\']',
        r'["“\']([^"”\']{2,48})["”\']\s*[:：]',
    ]
    texts: list[str] = []
    for pattern in patterns:
        texts.extend(re.findall(pattern, raw or ""))
    terms: list[dict[str, str]] = []
    seen: set[str] = set()
    for text in texts:
        text = text.strip()
        if not text or text in seen or len(text) > 48 or not _matches(text, answer):
            continue
        seen.add(text)
        terms.append({"text": text, "explanation": "", "relation": "background"})
        if len(terms) >= max_terms:
            break
    return terms


def _heuristic_terms(answer: str, max_terms: int) -> list[dict[str, str]]:
    """本地启发式兜底（宁缺毋滥，避免碎片标注）。

    只提取三类可信片段：
      1. 拉丁/数字词（如 Q-learning、BFS）
      2. 引号/书名号包裹的实体（「递归」、「分治」）
      3. 完整的短汉字串（连续汉字整体不超过 4 字，或长串按连接词切分后的 2-4 字片段，
         且不包含黑名单虚词）——避免"使用分治""常见考点"这类碎片被标注
    """
    candidates: list[str] = []
    seen: set[str] = set()

    def add(word: str) -> None:
        word = word.strip()
        if word and word not in seen:
            seen.add(word)
            candidates.append(word)

    def is_stop(word: str) -> bool:
        return word in _STOP_WORDS or any(stop in word for stop in _STOP_WORDS)

    # 1. 拉丁/数字词（含常见符号）
    for word in re.findall(r"[A-Za-z][A-Za-z0-9+#.\-]{1,30}", answer):
        add(word)
    # 2. 引号/书名号包裹的实体
    for word in re.findall(r"[「『“”\"']([^「」『』“”\"'\n]{1,30})[」』“”\"']", answer):
        add(word)
    # 3. 完整短汉字串（整体 ≤4 字，不切块）；长串按连接词切分后取 2-4 字完整片段
    split_chars = "与和及或是的在于而之其这那都也很还又就才并且为对"
    for run in re.findall(r"[\u4e00-\u9fff]{2,}", answer):
        if len(run) <= 4:
            if not is_stop(run):
                add(run)
            continue
        for part in re.split(rf"[{split_chars}]", run):
            if 2 <= len(part) <= 4 and not is_stop(part):
                add(part)
    return [{"text": word, "explanation": "", "relation": "background"} for word in candidates[:max_terms]]
