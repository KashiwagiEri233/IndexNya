"""思维宇宙 / 文献工具的最小单元测试。"""
from __future__ import annotations

import math

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.services.universe_service import build_graph, cosine, local_embed
from app.routers.literature import _chunk_text


def _make_db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return Session()


def test_local_embed_deterministic():
    a = local_embed("分治算法把大问题拆成小问题")
    b = local_embed("分治算法把大问题拆成小问题")
    assert a == b
    assert len(a) == 512


def test_local_embed_normalized():
    vec = local_embed("动态规划 状态转移 最优子结构 重叠子问题")
    norm = math.sqrt(sum(v * v for v in vec))
    assert abs(norm - 1.0) < 1e-6


def test_local_embed_distinct():
    a = local_embed("快速排序 时间复杂度 分治")
    b = local_embed("文艺复兴 油画 达芬奇")
    assert cosine(a, b) < 0.3


def test_cosine_similar_terms():
    a = local_embed("递归 基线条件 栈 函数调用")
    b = local_embed("递归 函数调用 栈 基线条件")
    c = local_embed("微积分 导数 积分 极限")
    assert cosine(a, b) > cosine(a, c)


def test_build_graph_empty():
    db = _make_db()
    graph = build_graph(db, 1)
    assert graph == {"nodes": [], "links": []}


def test_chunk_text_single():
    assert _chunk_text("短文本") == ["短文本"]


def test_chunk_text_overlap():
    text = "词" * 9000
    chunks = _chunk_text(text, size=4000, overlap=300)
    assert len(chunks) == 3
    # 相邻块共享重叠区间
    assert chunks[1].startswith("词" * 300)
    # 拼接后可覆盖原文
    assert "".join(chunks).count("词") >= 9000
