"""术语抽取 — 从回答/文献文本中提取可点击追问的专有名词。

供对话主流程（chat.py）、层级对话（hierarchy.py）、文献导入（literature.py）共用。
每个术语带 relation：
  background — 理解本段所需的背景知识（点开默认 → 子卡片深挖）
  related    — 与主题并列/对比的相关概念（点开默认 → 关联卡片发散）

判定策略（两阶段，保证"名词可点击且不诡异"）：
  1. LLM 初提：按严格标准抽取候选（必须是原文连续短语、技术名词、无泛化词）
  2. LLM 复核判定：把候选列表交给 LLM 逐条质检（keep/drop），只保留真·专业术语
  3. 兜底降级：LLM 不可用/解析失败时，正则 → 本地启发式，并做
     英文停用词、泛化词、子串重叠、边界标点等过滤，宁缺毋滥
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
    "换个角度", "进一步", "本质上", "实际上", "也就是说", "常用", "详见", "如下", "所示",
    "如图", "可见", "综上", "总之", "其实",
}

# 英文常见虚词 / 泛化词（启发式拉丁词兜底时过滤）
_EN_STOP_WORDS = {
    "the", "and", "are", "for", "with", "you", "your", "that", "this", "these", "those",
    "from", "have", "has", "had", "was", "were", "will", "would", "can", "could", "should",
    "may", "might", "must", "shall", "not", "but", "all", "any", "each", "few", "more",
    "most", "other", "some", "such", "only", "own", "same", "too", "very", "just", "about",
    "into", "over", "after", "before", "between", "under", "again", "once", "also",
    "because", "until", "while", "when", "where", "why", "how", "what", "which", "who",
    "whom", "then", "than", "there", "here", "one", "two", "three", "new", "use", "used",
    "using", "make", "made", "like", "time", "way", "know", "see", "need", "want", "take",
    "get", "give", "find", "show", "tell", "come", "think", "say", "http", "https", "www",
    "com", "org", "net", "html", "md", "txt", "pdf",
}

# 中文泛化尾词：术语以这些结尾且总长 ≤3 时视为泛化（如"方法"单独出现不点）
_CJK_GENERIC_TAILS = ("方法", "方式", "问题", "内容", "概念", "原理", "结构", "过程", "情况", "方面", "特点", "作用", "原因", "结果", "例子")

_MAX_TERM_LEN = 48
_MIN_CJK_LEN = 2


# ============================================================
# 1. LLM 初提
# ============================================================

_EXTRACT_PROMPT = """请从下面这段文本中提取适合学生点击追问的专有名词（技术术语）。

判定标准（逐条严格检查）：
1. 只提取：技术名词、学科概念、方法/算法/框架/协议名称、实体名称、数学概念。
   绝不要提取：普通动词、形容词、副词、日常用语、代词、连词、泛化词（如"方法""问题""原理""结构""内容"这类词单独出现时）。
2. text 必须是文本中原样出现的连续短语，不要改写、不要拼接、不要截断；开头结尾不要带标点、引号或空白。
3. 中文术语 2-20 字；英文/数字术语至少 2 个字符；不要提取单个汉字或单个字母。
4. 最多提取 {max_terms} 个，优先选最值得展开解释的词；语义重复的只留一个。
5. explanation 用一句中文简要解释这个词，方便子对话展示。
6. relation 只输出两种值：
   - "background"：理解这段内容所需的背景知识（如前置概念、底层原理）
   - "related"：与主题并列、可横向对比或发散的相关概念
7. 如果没有合适的词，返回空数组，宁缺毋滥。

只输出 JSON 数组，格式如下：
[{{"text":"虚拟 DOM","explanation":"用于描述界面结构并优化更新过程的内存表示","relation":"background"}}]

文本内容：
{sample}"""


async def _llm_extract(sample: str, max_terms: int) -> list[dict[str, str]]:
    """第一阶段：LLM 初提候选术语。"""
    try:
        raw = await json_complete(
            [
                {"role": "system", "content": "你是一个严谨的学习内容术语标注器。"},
                {"role": "user", "content": _EXTRACT_PROMPT.format(max_terms=max_terms, sample=sample)},
            ],
            temperature=0.1,
            max_tokens=1500,
        )
        cleaned = (raw or "").strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        data: Any = json.loads(cleaned)
        if isinstance(data, dict):
            data = data.get("terms", [])
        if isinstance(data, list):
            return _normalize_terms(data, sample, max_terms)
    except Exception as exc:
        logger.debug("term extraction stage-1 parse failed: %s", exc)
    return []


# ============================================================
# 2. LLM 复核判定
# ============================================================

_JUDGE_PROMPT = """你是学习内容术语质检员。下面是从一段回答文本中初步提取的「可点击术语」候选列表。

请逐条判定每个候选是否值得保留，判定标准：
1. 必须是真正的专业术语 / 学科概念 / 方法算法框架 / 专有名词，学生点击后有值得深挖的背景知识；
2. 排除：泛化词（如"方法""问题""原理""结构""内容""部分""主要"等单独出现）、
   普通动词/形容词、日常用语、不完整的短语片段、纯连接词；
3. 保留的术语必须能在原文中找到（允许忽略空格差异）。

输出 JSON（不要输出其他文字）：
{{"keep": ["保留的术语原文1", "术语原文2"], "reasons": {{"术语原文": "一句话理由"}}}}
规则：keep 只能包含候选列表中出现的原文，不要新增、不要改写、不要改名；
不确定时优先丢弃（宁缺毋滥）。如果全部不合格，输出 {{"keep": []}}。

候选列表：
{candidates}

原文（截取）：
{sample}"""


async def _llm_judge(sample: str, candidates: list[dict[str, str]]) -> list[dict[str, str]]:
    """第二阶段：LLM 复核判定，只保留被判定为真·专业术语的候选。"""
    if not candidates:
        return []
    try:
        listing = "\n".join(f"- {c['text']}（{c.get('explanation') or '无解释'}）" for c in candidates)
        raw = await json_complete(
            [
                {"role": "system", "content": "你是严谨的术语质检员，只输出 JSON。"},
                {"role": "user", "content": _JUDGE_PROMPT.format(candidates=listing, sample=sample[:6000])},
            ],
            temperature=0.0,
            max_tokens=800,
        )
        data = _parse_json_object(raw)
        keep = data.get("keep")
        if not isinstance(keep, list):
            logger.debug("term judge: no keep list, fallback to candidates")
            return candidates
        kept = {str(k).strip() for k in keep if isinstance(k, str)}
        result = [c for c in candidates if c["text"] in kept]
        logger.debug("term judge: %d/%d candidates kept", len(result), len(candidates))
        return result
    except Exception as exc:
        logger.debug("term judge failed, keep candidates: %s", exc)
        return candidates


def _parse_json_object(raw: str) -> dict:
    """从 LLM 输出解析 JSON 对象（兼容 ```json 包裹与前后杂文）。"""
    cleaned = (raw or "").strip()
    m = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", cleaned, re.DOTALL)
    if m:
        cleaned = m.group(1)
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            cleaned = cleaned[start : end + 1]
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


# ============================================================
# 3. 归一化与过滤（LLM 与兜底共用）
# ============================================================

def _clean_term(text: str) -> str:
    """去掉首尾的引号/括号/标点/空白。"""
    text = (text or "").strip().strip("“”\"'‘’「」『』《》()（）[]【】,，。.．;；:：、!！?？…·*_`~")
    return text.strip()


def _is_latin(word: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+#.\-]*", word))


def _is_cjk(word: str) -> bool:
    return bool(word) and all("\u4e00" <= ch <= "\u9fff" for ch in word)


def _is_generic(word: str) -> bool:
    """泛化词判定：整体命中停用词 / 英文虚词，或中文术语过短且以泛化尾词结尾。"""
    if word in _STOP_WORDS:
        return True
    if _is_latin(word) and word.lower() in _EN_STOP_WORDS:
        return True
    if _is_cjk(word) and len(word) == 2 and word in ("学习", "知识", "内容", "方法", "问题", "概念", "原理", "结构", "方式", "作用"):
        return True
    if _is_cjk(word) and len(word) <= 3 and any(word.endswith(t) for t in _CJK_GENERIC_TAILS):
        return True
    # 两个停用词拼接的复合泛化词（如"一种方法""一些问题"）
    if _is_cjk(word) and len(word) in (4, 6):
        for head in _STOP_WORDS:
            if word.startswith(head) and word[len(head):] in _STOP_WORDS:
                return True
    return False


def _matches(text: str, answer: str) -> bool:
    """宽松匹配：原文包含该文本（忽略空白差异，兼容全半角空格）。"""
    if text in answer:
        return True
    compact_text = text.replace(" ", "").replace("\u3000", "").replace("\t", "")
    compact_answer = answer.replace(" ", "").replace("\u3000", "").replace("\t", "")
    return compact_text in compact_answer


def _dedupe_overlap(terms: list[dict[str, str]]) -> list[dict[str, str]]:
    """子串去重：长术语优先，被更长术语包含的短术语丢弃（避免"网络"高亮在"神经网络"内部）。

    注意：仅当短术语是更长术语的连续子串时丢弃；"机器学习"与"深度学习"互不包含，都保留。
    """
    accepted: list[dict[str, str]] = []
    for term in sorted(terms, key=lambda item: -len(item["text"])):
        text = term["text"]
        if any(text in a["text"] for a in accepted):
            continue
        accepted.append(term)
    return accepted


def _normalize_terms(data: Any, answer: str, max_terms: int) -> list[dict[str, str]]:
    """清洗 LLM 输出的候选：匹配原文、去泛化、去子串重叠、限长。"""
    terms: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        text = _clean_term(str(item.get("text") or ""))
        explanation = str(item.get("explanation") or "").strip()
        if not text or len(text) > _MAX_TERM_LEN:
            continue
        if _is_latin(text) and len(text) < 2:
            continue
        if _is_cjk(text) and len(text) < _MIN_CJK_LEN:
            continue
        if not (_is_latin(text) or _is_cjk(text) or re.fullmatch(r"[\u4e00-\u9fffA-Za-z0-9+#.\- ]+", text)):
            # 混合术语允许含空格（如 "virtual DOM"），但不得夹带标点
            continue
        if _is_generic(text):
            continue
        if text in seen or not _matches(text, answer):
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
    return _dedupe_overlap(terms)


# ============================================================
# 4. 兜底：正则抽取 + 本地启发式
# ============================================================

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
        text = _clean_term(text)
        if not text or text in seen or len(text) > _MAX_TERM_LEN or _is_generic(text):
            continue
        if _is_cjk(text) and len(text) < _MIN_CJK_LEN:
            continue
        if not _matches(text, answer):
            continue
        seen.add(text)
        terms.append({"text": text, "explanation": "", "relation": "background"})
        if len(terms) >= max_terms:
            break
    return _dedupe_overlap(terms)


def _heuristic_terms(answer: str, max_terms: int) -> list[dict[str, str]]:
    """本地启发式兜底（宁缺毋滥，避免碎片标注）。

    只提取三类可信片段：
      1. 拉丁/数字词（如 Q-learning、BFS），过滤英文虚词与网址碎片
      2. 引号/书名号包裹的实体（「递归」、「分治」）
      3. 完整的短汉字串（2-4 字整串，或长串按连接词切分后的 2-4 字片段），
         过滤泛化词，且不做子串重叠高亮
    """
    candidates: list[str] = []
    seen: set[str] = set()

    def add(word: str) -> None:
        word = word.strip()
        if word and word not in seen and not _is_generic(word):
            seen.add(word)
            candidates.append(word)

    # 1. 拉丁/数字词（含常见符号），过滤英文虚词与网址碎片；
    #    全小写且不含数字/符号的英文单词大概率是普通句子词而非术语（兜底宁缺毋滥）
    for word in re.findall(r"[A-Za-z][A-Za-z0-9+#.\-]{1,30}", answer):
        lower = word.lower()
        if lower in _EN_STOP_WORDS:
            continue
        if word.islower() and not re.search(r"[0-9+#.\-]", word):
            continue
        if re.fullmatch(r"[a-z0-9-]+\.(com|org|net|io|cn|edu|gov|html?|md|txt|pdf|png|jpg)", lower):
            continue
        add(word)
    # 2. 引号/书名号包裹的实体
    for word in re.findall(r"[「『“”\"']([^「」『』“”\"'\n]{1,30})[」』“”\"']", answer):
        add(word)
    # 3. 完整短汉字串（整体 ≤4 字，不切块）；长串按连接词切分后取 2-4 字完整片段
    split_chars = "与和及或是的在于而之其这那都也很还又就才并且为对"
    for run in re.findall(r"[\u4e00-\u9fff]{2,}", answer):
        if len(run) <= 4:
            if not _is_generic(run):
                add(run)
            continue
        for part in re.split(rf"[{split_chars}]", run):
            if 2 <= len(part) <= 4 and not _is_generic(part):
                add(part)

    terms = [{"text": word, "explanation": "", "relation": "background"} for word in candidates]
    return _dedupe_overlap(terms)[:max_terms]


# ============================================================
# 5. 入口
# ============================================================

async def extract_terms(answer: str, max_terms: int = 10) -> list[dict[str, str]]:
    """从一段文本中提取可点击的专有名词。

    流程：LLM 初提 → LLM 复核判定 → 正则兜底 → 本地启发式兜底。
    任一步失败都逐级降级，保证返回尽量合理、非空。
    """
    if len(answer.strip()) < 24:
        return []
    sample = answer[:12000]

    # 1+2. LLM 初提 + 复核判定
    candidates = await _llm_extract(sample, max_terms)
    if candidates:
        judged = await _llm_judge(sample, candidates)
        if judged:
            return judged[:max_terms]
        logger.debug("term extraction: LLM judge dropped all candidates, fallback")
    elif logger.isEnabledFor(logging.DEBUG):
        logger.debug("term extraction: stage-1 empty, fallback")

    # 3. 降级：LLM 输出不完整/非纯 JSON 时，正则抽取 text 字段
    fallback = _fallback_terms(sample, answer, max_terms)
    if fallback:
        logger.debug("term extraction used regex fallback (%d terms)", len(fallback))
        return fallback

    # 4. 降级：本地启发式兜底，保证术语始终可点
    heuristic = _heuristic_terms(answer, max_terms)
    if heuristic:
        logger.debug("term extraction used heuristic fallback (%d terms)", len(heuristic))
    return heuristic
