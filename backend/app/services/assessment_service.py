"""学习效果评估服务 — 功能5。

实时跟踪学习行为、练习测试、资源使用反馈，多维度精准评估，
根据评估结果动态调整资源推送策略与学习计划。
"""
from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from ..agents.base import BaseAgent
from ..llm.factory import chat_complete
from ..models import Assessment, Progress, Resource


def track_progress(
    db: Session,
    student_id: int,
    resource_id: int | None,
    status: str,
    score: float | None,
    time_spent_min: float,
    feedback: str | None,
) -> Progress:
    p = Progress(
        student_id=student_id,
        resource_id=resource_id,
        status=status,
        score=score,
        time_spent_min=time_spent_min,
        feedback=feedback,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


async def assess(db: Session, student_id: int) -> dict[str, Any]:
    """对学生学习效果做多维度精准评估。返回仪表盘数据。"""
    progress_rows = (
        db.query(Progress).filter(Progress.student_id == student_id).all()
    )
    resources = (
        db.query(Resource).filter(Resource.student_id == student_id).all()
    )

    # 原始统计
    total = len(progress_rows)
    completed = sum(1 for p in progress_rows if p.status == "completed")
    learning = sum(1 for p in progress_rows if p.status == "learning")
    scores = [p.score for p in progress_rows if p.score is not None]
    avg_score = sum(scores) / len(scores) if scores else 0.0
    total_time = sum(p.time_spent_min for p in progress_rows)
    type_counts: dict[str, int] = {}
    for r in resources:
        type_counts[r.type] = type_counts.get(r.type, 0) + 1

    summary = {
        "total_resources": len(resources),
        "by_type": type_counts,
        "progress_total": total,
        "completed": completed,
        "learning": learning,
        "avg_score": round(avg_score, 2),
        "total_time_min": round(total_time, 1),
        "recent_feedback": [p.feedback for p in progress_rows[-5:] if p.feedback],
    }

    # 用 LLM 做多维度评估
    eval_prompt = f"""你是学习效果评估智能体。基于以下学生学习行为数据，输出多维度精准评估。

学习数据：
{json.dumps(summary, ensure_ascii=False)}

评估维度（每个给出 0-100 分和依据）：
- 掌握度（mastery）：知识掌握程度
- 参与度（engagement）：学习投入与持续性
- 效率（efficiency）：时间-产出比
- 完整性（completeness）：路径完成率
- 反馈质量（feedback_quality）：自评反馈的有用性

输出 JSON：
{{
  "dimensions": [
    {{"name": "掌握度", "key": "mastery", "score": 80, "evidence": "..."}},
    {{"name": "参与度", "key": "engagement", "score": 70, "evidence": "..."}},
    {{"name": "效率", "key": "efficiency", "score": 65, "evidence": "..."}},
    {{"name": "完整性", "key": "completeness", "score": 50, "evidence": "..."}},
    {{"name": "反馈质量", "key": "feedback_quality", "score": 60, "evidence": "..."}}
  ],
  "total_score": 65,
  "recommendation": "针对薄弱维度给出动态调整建议（资源类型倾斜、节奏调整等）"
}}"""

    text = await chat_complete(
        [{"role": "user", "content": eval_prompt}],
        temperature=0.3,
        max_tokens=2048,
    )
    data: dict[str, Any] = {}
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
        except Exception:
            pass

    dimensions = data.get("dimensions", [])
    # 落库每个维度
    for d in dimensions:
        a = Assessment(
            student_id=student_id,
            dimension=d.get("key", d.get("name", "unknown")),
            score=float(d.get("score", 0)),
            evidence={"name": d.get("name"), "evidence": d.get("evidence", "")},
        )
        db.add(a)
    db.commit()

    return {
        "student_id": student_id,
        "dimensions": dimensions,
        "total_score": data.get("total_score", 0),
        "recommendation": data.get("recommendation", ""),
        "raw_stats": summary,
    }
