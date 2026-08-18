"""技能路由 — 目录查询、zip 安装、卸载、全局开关。"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..skills.manager import (
    delete_skill,
    get_skill,
    install_skill_from_zip,
    list_skills,
    set_enabled,
)

router = APIRouter()


class SkillEnableRequest(BaseModel):
    enabled: bool


@router.get("")
def get_skills() -> list[dict]:
    """技能目录（含全局开启状态，不含正文指令）。"""
    return [
        {"name": s.name, "title": s.title, "description": s.description, "enabled": s.enabled}
        for s in list_skills()
    ]


@router.get("/{name}")
def get_skill_detail(name: str) -> dict:
    """单个技能详情（含 SKILL.md 全文指令与开启状态）。"""
    skill = get_skill(name)
    if not skill:
        raise HTTPException(404, f"skill not found: {name}")
    return {
        "name": skill.name,
        "title": skill.title,
        "description": skill.description,
        "content": skill.content,
        "enabled": skill.enabled,
    }


@router.post("")
async def upload_skill(file: UploadFile = File(...)) -> dict:
    """上传 .zip 技能包安装，实时生效。

    压缩包内可直接放 SKILL.md（技能名取压缩包文件名），
    或放一个/多个技能文件夹（文件夹名即技能标识，内含 SKILL.md）。
    """
    filename = os.path.basename(file.filename or "skill.zip")
    if not filename.lower().endswith(".zip"):
        raise HTTPException(400, "仅支持 .zip 技能包。")

    fd, temp_path = tempfile.mkstemp(prefix="indexnya-skill-", suffix=".zip")
    os.close(fd)
    try:
        with open(temp_path, "wb") as out:
            out.write(await file.read())
        names = install_skill_from_zip(temp_path, skill_name_hint=Path(filename).stem)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(400, str(exc))
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass

    installed = [n.strip() for n in names.split(",")]
    return {"names": installed, "message": f"已安装技能：{names}"}


@router.put("/{name}/enabled")
def update_skill_enabled(name: str, payload: SkillEnableRequest) -> dict:
    """全局开关技能。"""
    if not set_enabled(name, payload.enabled):
        raise HTTPException(404, f"skill not found: {name}")
    return {"name": name, "enabled": payload.enabled}


@router.delete("/{name}")
def remove_skill(name: str) -> dict:
    """卸载技能（删除技能目录并清理开关配置）。"""
    if not delete_skill(name):
        raise HTTPException(404, f"skill not found: {name}")
    return {"name": name, "status": "deleted"}
