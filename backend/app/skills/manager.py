"""技能管理器 — 加载 backend/app/skills/ 目录下的 Markdown 技能文件。

每个技能是一个 .md 文件，使用 YAML 风格的 frontmatter：
    ---
    name: flashcards             # 技能唯一标识（英文短横线）
    title: 记忆卡片              # 展示名称
    description: 一句话说明      # 给主 Agent 判断何时使用
    ---
    正文为技能的完整执行指令（注入模型上下文，由 LLM 按指令执行）。

新增技能只需在该目录添加一个 .md 文件，无需改任何代码。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# 技能文件与 manager.py 同目录（backend/app/skills/*.md）
SKILLS_DIR = Path(__file__).resolve().parent

_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,48}$")


@dataclass
class Skill:
    """一个可被主 Agent 使用的技能。"""

    name: str
    title: str
    description: str
    content: str = ""  # frontmatter 之后的完整指令文本
    meta: dict = field(default_factory=dict)  # frontmatter 中的其他字段


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 frontmatter（--- 包裹的 key: value 段），返回 (meta, body)。"""
    meta: dict = {}
    body = text
    stripped = text.lstrip("\ufeff \t\r\n")
    if stripped.startswith("---"):
        end = stripped.find("\n---", 3)
        if end != -1:
            raw = stripped[3:end]
            body = stripped[end + 4 :].lstrip("\n")
            for line in raw.splitlines():
                key, _, value = line.partition(":")
                key = key.strip().lower()
                value = value.strip()
                if key:
                    meta[key] = value
    return meta, body


def _load_skills() -> dict[str, Skill]:
    skills: dict[str, Skill] = {}
    for path in sorted(SKILLS_DIR.glob("*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        meta, body = _parse_frontmatter(text)
        name = str(meta.get("name") or path.stem).strip()
        if not _NAME_RE.match(name):
            continue
        skills[name] = Skill(
            name=name,
            title=str(meta.get("title") or name),
            description=str(meta.get("description") or ""),
            content=body.strip(),
            meta=meta,
        )
    return skills


def list_skills() -> list[Skill]:
    """按文件名排序返回全部技能（不含正文，供目录展示）。"""
    return sorted(_load_skills().values(), key=lambda s: s.name)


def get_skill(name: str) -> Skill | None:
    """按技能名取技能；不存在返回 None。"""
    if not name:
        return None
    return _load_skills().get(name)