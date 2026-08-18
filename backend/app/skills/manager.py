"""技能管理器 — 遵循 Anthropic Skills 规范。

每个技能是一个目录：

    backend/app/skills/{name}/SKILL.md

- 目录名即技能标识（英文/数字/点/下划线/短横线，安装后不可更改）；
- SKILL.md 使用 YAML frontmatter 声明 name / description（可选 title 作为展示名）；
- 技能可附带 scripts/、references/ 等辅助文件，随目录一起安装与删除。

管理与配置均为文件：
- 技能目录：backend/app/skills/{name}/（安装 = 解压 zip 写入，卸载 = 删除目录，实时生效）；
- 全局开关：backend/app/skills/skills.json → {"skills": {name: {"active": bool}}}，
  缺失条目视为开启（本地单用户，不做按学生区分）。

安装方式：上传 .zip 技能包。压缩包内可以直接放一个 SKILL.md
（此时技能名取压缩包文件名），也可以放一个或多个技能文件夹（文件夹名即技能标识，
文件夹内必须包含大小写完全一致的 SKILL.md）。
"""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

import yaml

# 技能目录与 manager.py 同目录（backend/app/skills/）
SKILLS_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SKILLS_DIR / "skills.json"
SKILL_MD_MAX_CHARS = 64 * 1024  # 描述只读 frontmatter 部分，避免整文件读入

# 目录名规则（英文、数字、点、下划线、短横线）
_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
# 与模块/配置文件冲突的保留名（安装 zip 时拒绝）
_RESERVED_NAMES = {"manager", "__init__", "settings", "skills"}


@dataclass
class Skill:
    """一个可被主 Agent 使用的技能。"""

    name: str
    title: str
    description: str
    content: str = ""  # SKILL.md 全文（详情接口按需读取）
    enabled: bool = True
    meta: dict = field(default_factory=dict)  # frontmatter 中的其他字段


# ============================================================
# 全局开关（skills.json：{"skills": {name: {"active": bool}}}）
# ============================================================

def _load_config() -> dict:
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("skills"), dict):
            return data
    except (OSError, ValueError):
        pass
    return {"skills": {}}


def _save_config(config: dict) -> None:
    CONFIG_PATH.write_text(
        json.dumps(config, ensure_ascii=False, indent=4),
        encoding="utf-8",
    )


def _is_active(name: str) -> bool:
    config = _load_config()
    entry = config["skills"].get(name)
    if not isinstance(entry, dict):
        return True
    return bool(entry.get("active", True))


# ============================================================
# frontmatter 解析（YAML，Anthropic Skills 规范）
# ============================================================

def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 SKILL.md 的 YAML frontmatter，返回 (meta, body)。

    无 frontmatter 或解析失败时返回空 meta 与原文。
    """
    stripped = text.lstrip("\ufeff \t\r\n")
    if not stripped.startswith("---"):
        return {}, stripped
    lines = stripped.splitlines()
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}, stripped
    raw = "\n".join(lines[1:end])
    body = "\n".join(lines[end + 1 :]).lstrip("\n")
    try:
        meta = yaml.safe_load(raw) or {}
    except yaml.YAMLError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return meta, body


def _skill_dir(name: str) -> Path:
    return SKILLS_DIR / name


def _validate_name(name: str) -> bool:
    return bool(_NAME_RE.match(name)) and name not in _RESERVED_NAMES


def _normalize_name(name: str) -> str:
    """清洗候选技能名：空白折叠为下划线。"""
    return re.sub(r"\s+", "_", str(name or "").strip())


def _canonical_skill_md(skill_dir: Path) -> Path | None:
    """返回技能目录下的规范 SKILL.md；仅存在小写 skill.md 时原地改名。"""
    canonical = skill_dir / "SKILL.md"
    if canonical.exists():
        return canonical
    legacy = skill_dir / "skill.md"
    if not legacy.exists():
        return None
    try:
        tmp = skill_dir / f".{uuid.uuid4().hex}.tmp"
        legacy.rename(tmp)
        tmp.rename(canonical)
    except OSError:
        return legacy
    return canonical


def _read_skill(skill_dir: Path) -> Skill | None:
    """读取一个技能目录；目录不合法时返回 None。"""
    name = skill_dir.name
    if not _validate_name(name):
        return None
    skill_md = _canonical_skill_md(skill_dir)
    if skill_md is None:
        return None
    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError:
        return None
    meta, body = _parse_frontmatter(text)
    front_name = str(meta.get("name") or "").strip()
    if front_name and front_name != name:
        # frontmatter 声明了不同的 name 时以目录名为准
        meta["name"] = name
    return Skill(
        name=name,
        title=str(meta.get("title") or name),
        description=str(meta.get("description") or "").strip(),
        content="",
        enabled=_is_active(name),
        meta=meta,
    )


# ============================================================
# 查询
# ============================================================

def list_skills() -> list[Skill]:
    """按目录名排序返回全部技能（含全局开启状态，不含正文指令）。"""
    skills: list[Skill] = []
    for entry in sorted(SKILLS_DIR.iterdir(), key=lambda p: p.name):
        if not entry.is_dir():
            continue
        skill = _read_skill(entry)
        if skill is not None:
            skills.append(skill)
    return skills


def get_skill(name: str) -> Skill | None:
    """按技能名取技能（含 SKILL.md 全文指令）；不存在返回 None。"""
    if not name:
        return None
    skill = _read_skill(_skill_dir(name))
    if skill is None:
        return None
    skill_md = _canonical_skill_md(_skill_dir(name))
    try:
        skill.content = skill_md.read_text(encoding="utf-8")
    except OSError:
        skill.content = ""
    return skill


# ============================================================
# 开关 / 卸载
# ============================================================

def set_enabled(name: str, enabled: bool) -> bool:
    """全局开关技能；技能不存在返回 False。"""
    if _canonical_skill_md(_skill_dir(name)) is None:
        return False
    config = _load_config()
    config["skills"][name] = {"active": bool(enabled)}
    _save_config(config)
    return True


def delete_skill(name: str) -> bool:
    """卸载技能（删除技能目录并清理开关配置）；不存在返回 False。"""
    skill_dir = _skill_dir(name)
    if _canonical_skill_md(skill_dir) is None:
        return False
    shutil.rmtree(skill_dir)
    config = _load_config()
    if name in config["skills"]:
        config["skills"].pop(name, None)
        _save_config(config)
    return True


# ============================================================
# zip 安装
# ============================================================

def _is_ignored_zip_entry(name: str) -> bool:
    parts = PurePosixPath(name).parts
    return not parts or parts[0] == "__MACOSX"


def install_skill_from_zip(zip_path: str, *, skill_name_hint: str | None = None) -> str:
    """从 .zip 技能包安装技能，返回逗号分隔的已安装技能名。

    压缩包支持两种结构：
    1. 根目录直接放 SKILL.md —— 技能名取 skill_name_hint（如 zip 文件名），
       压缩包内所有文件成为该技能目录内容；
    2. 根目录放一个/多个技能文件夹 —— 文件夹名即技能标识（多个时忽略 hint）。

    同名技能默认覆盖安装并自动开启。校验失败抛 ValueError。
    """
    zip_path_obj = Path(zip_path)
    if not zip_path_obj.exists():
        raise FileNotFoundError(f"Zip file not found: {zip_path}")
    if not zipfile.is_zipfile(zip_path):
        raise ValueError("上传文件不是有效的 zip 压缩包。")

    installed: list[str] = []

    with zipfile.ZipFile(zip_path) as zf:
        names = [
            name
            for name in (entry.replace("\\", "/") for entry in zf.namelist())
            if name and not _is_ignored_zip_entry(name)
        ]
        file_names = [name for name in names if name and not name.endswith("/")]
        if not file_names:
            raise ValueError("zip 压缩包为空。")

        # 路径安全校验：拒绝绝对路径与 ..
        for name in names:
            if name.startswith("/") or re.match(r"^[A-Za-z]:", name):
                raise ValueError("zip 压缩包包含绝对路径，已拒绝安装。")
            if ".." in PurePosixPath(name).parts:
                raise ValueError("zip 压缩包包含非法相对路径，已拒绝安装。")

        root_mode = any(
            len(PurePosixPath(name).parts) == 1
            and PurePosixPath(name).name in {"SKILL.md", "skill.md"}
            for name in file_names
        )

        tmp_dir = tempfile.mkdtemp(prefix="indexnya-skills-")
        try:
            for member in zf.infolist():
                member_name = member.filename.replace("\\", "/")
                if not member_name or _is_ignored_zip_entry(member_name):
                    continue
                zf.extract(member, tmp_dir)

            tmp_root = Path(tmp_dir)
            if root_mode:
                hint = _normalize_name(skill_name_hint or zip_path_obj.stem)
                if not _validate_name(hint):
                    raise ValueError("无法从压缩包确定技能名，请将压缩包命名为技能名（英文/数字/点/下划线/短横线）。")
                src_dir = tmp_root
                if _canonical_skill_md(src_dir) is None:
                    raise ValueError("压缩包根目录缺少 SKILL.md（注意文件名大小写）。")
                dest_dir = _skill_dir(hint)
                if dest_dir.exists():
                    shutil.rmtree(dest_dir)
                shutil.move(str(src_dir), str(dest_dir))
                _canonical_skill_md(dest_dir)  # 兼容小写 skill.md → SKILL.md
                set_enabled(hint, True)
                installed.append(hint)
            else:
                top_dirs = {PurePosixPath(n).parts[0] for n in file_names if n.strip()}
                for top_name in top_dirs:
                    if top_name in {".", "..", ""}:
                        continue
                    src_dir = tmp_root / top_name
                    if _canonical_skill_md(src_dir) is None:
                        continue  # 顶层文件夹没有 SKILL.md，跳过
                    if skill_name_hint and len(top_dirs) == 1:
                        skill_name = _normalize_name(skill_name_hint)
                    else:
                        skill_name = _normalize_name(top_name)
                    if not _validate_name(skill_name):
                        continue
                    dest_dir = _skill_dir(skill_name)
                    if dest_dir.exists():
                        shutil.rmtree(dest_dir)
                    shutil.move(str(src_dir), str(dest_dir))
                    _canonical_skill_md(dest_dir)
                    set_enabled(skill_name, True)
                    installed.append(skill_name)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    if not installed:
        raise ValueError("压缩包中未找到任何合法的技能（需包含 SKILL.md 的技能文件夹）。")
    return ", ".join(installed)
