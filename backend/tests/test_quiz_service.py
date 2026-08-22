"""互动刷题服务的最小单元测试 — 本地判定与正文出题容错。"""
from __future__ import annotations

from app.services.quiz_service import grade_answer, summary_text, try_extract_question_from_text


def _choice_item(answer: str = "B. 叶绿体") -> dict:
    return {
        "question": "绿色植物进行光合作用的场所是细胞中的哪个结构？",
        "options": ["A. 细胞膜", "B. 叶绿体", "C. 细胞核", "D. 线粒体"],
        "answer": answer,
    }


# ============================================================
# grade_answer — 本地确定性判定
# ============================================================

def test_grade_choice_letter_correct():
    assert grade_answer("我的答案：B. 叶绿体", _choice_item()) is True


def test_grade_choice_letter_wrong():
    assert grade_answer("我的答案：C. 细胞核", _choice_item()) is False


def test_grade_choice_letter_only():
    assert grade_answer("我的答案：B", _choice_item()) is True
    assert grade_answer("选A", _choice_item()) is False


def test_grade_choice_answer_letter_only():
    item = _choice_item(answer="B")
    assert grade_answer("我的答案：B. 叶绿体", item) is True
    assert grade_answer("我的答案：A", item) is False


def test_grade_choice_full_option_text_without_letter():
    # 选项题作答写完整选项正文（无字母前缀），标准答案带字母
    assert grade_answer("我的答案：叶绿体", _choice_item()) is True


def test_grade_choice_wrong_option_full_text():
    # 作答是另一个选项的完整正文 → 判定为答错（而非 None）
    assert grade_answer("我的答案：细胞膜", _choice_item()) is False
    assert grade_answer("我的答案：A. 细胞膜", _choice_item()) is False


def test_grade_choice_answer_without_letter_matches_option_content():
    # 标准答案只存选项正文（无字母），作答是完整选项正文 → 正确
    item = _choice_item(answer="叶绿体")
    assert grade_answer("我的答案：叶绿体", item) is True
    assert grade_answer("我的答案：细胞膜", item) is None


def test_grade_choice_typed_answer_body_contained():
    # 作答是选项正文的扩展描述（如贴了选项说明）
    item = _choice_item(answer="B. 叶绿体（chloroplast）")
    assert grade_answer("我的答案：B. 叶绿体", item) is True


def test_grade_free_text_exact():
    item = {"question": "二分查找的前提是什么？", "options": [], "answer": "数组有序"}
    assert grade_answer("我的答案：数组有序", item) is True


def test_grade_free_text_conservative_no_containment():
    # 自由作答不做包含匹配，避免误判（如答案「树」不能判定「二叉树」正确）
    item = {"question": "数据结构？", "options": [], "answer": "树"}
    assert grade_answer("二叉树", item) is None


def test_grade_free_text_letter_guard():
    # 简答题正文含字母也不走选项字母判定，避免误判
    item = {"question": "快速排序的时间复杂度？", "options": [], "answer": "O(n log n)"}
    assert grade_answer("时间复杂度是O(n log n)", item) is None


def test_grade_ambiguous_returns_none():
    assert grade_answer("随便猜一个", _choice_item()) is None
    assert grade_answer("", _choice_item()) is None
    assert grade_answer("我的答案：B. 叶绿体", None) is None
    assert grade_answer("我的答案：B. 叶绿体", {"question": "q", "options": [], "answer": ""}) is None


# ============================================================
# try_extract_question_from_text — 正文出题容错
# ============================================================

def test_extract_next_question_prefix():
    text = "答对啦！下一题：二叉树的遍历方式有哪些？"
    result = try_extract_question_from_text(text)
    assert result is not None
    assert "二叉树的遍历方式" in result["question"]


def test_extract_nth_question_prefix():
    text = "很好，继续！第 2 题：哈希表解决冲突的常见方法是什么？"
    result = try_extract_question_from_text(text)
    assert result is not None
    assert "哈希表解决冲突" in result["question"]


def test_extract_question_with_options():
    text = (
        "请听题：\n"
        "A. 栈\n"
        "B. 队列\n"
        "C. 树\n"
        "D. 图"
    )
    result = try_extract_question_from_text(text)
    assert result is not None
    assert result["question"]
    assert result["options"] == ["A. 栈", "B. 队列", "C. 树", "D. 图"]


def test_extract_rejects_feedback_only():
    # 仅点评（含「第 2 题」但无出题提示词 / 无选项列表）不得提取为新题
    text = (
        "🌱 第一题答对啦！给你点赞！\n"
        "**题目回顾：** 绿色植物进行光合作用的场所是细胞中的哪个结构？\n"
        "✅ **你的答案：B. 叶绿体 —— 完全正确！**\n"
        "**解析：** 光合作用发生在叶绿体中…"
    )
    assert try_extract_question_from_text(text) is None


def test_extract_rejects_summary():
    text = "练习结束！本次共 5 道题，答对 4 道，建议复习二叉树章节。"
    assert try_extract_question_from_text(text) is None


def test_extract_rejects_feedback_containing_nth():
    # 「第 2 题又答对了」缺少出题提示词格式，不得误提取
    assert try_extract_question_from_text("第 2 题又答对了，漂亮！") is None


# ============================================================
# summary_text — 本地兜底小结
# ============================================================

def test_summary_text_counts_and_rate():
    text = summary_text({"index": 4, "score": 3, "topic": "二叉树", "active": False})
    assert "共 4 题" in text
    assert "答对 3 题" in text
    assert "75%" in text
    assert "二叉树" in text


def test_summary_text_empty_session():
    text = summary_text({"index": 0, "score": 0, "topic": "", "active": False})
    assert "共 0 题" in text
    assert "0%" in text
    assert "再来几题" in text


def test_summary_text_zero_score():
    text = summary_text({"index": 5, "score": 0, "topic": "排序"})
    assert "共 5 题" in text
    assert "答对 0 题" in text
    assert "0%" in text
