"""资源路由 — 功能2后端接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..llm.factory import reset_active_model, set_active_model
from ..schemas import ResourceGenerateRequest, ResourceOut
from ..services.resource_service import generate_resource, list_resources

router = APIRouter()


@router.post("/generate", response_model=ResourceOut)
async def generate(
    payload: ResourceGenerateRequest,
    db: Session = Depends(get_db),
) -> ResourceOut:
    from ..services.student_service import get_local_student_id

    token = set_active_model(payload.model.model_dump(exclude_none=True) if payload.model else None)
    try:
        r = await generate_resource(
            db,
            payload.student_id or get_local_student_id(db),
            payload.type,
            payload.topic,
            conversation_id=payload.conversation_id,
            extra=payload.extra,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        reset_active_model(token)
    return ResourceOut.model_validate(r)


@router.get("", response_model=list[ResourceOut])
def list_(student_id: int | None = None, type: str | None = None, db: Session = Depends(get_db)) -> list[ResourceOut]:
    from ..services.student_service import get_local_student_id

    items = list_resources(db, student_id or get_local_student_id(db), resource_type=type)
    return [ResourceOut.model_validate(r) for r in items]


@router.get("/{resource_id}", response_model=ResourceOut)
def get_one(resource_id: int, db: Session = Depends(get_db)) -> ResourceOut:
    from ..models import Resource
    r = db.get(Resource, resource_id)
    if not r:
        raise HTTPException(404, "resource not found")
    return ResourceOut.model_validate(r)


@router.delete("/{resource_id}")
def delete_resource(resource_id: int, db: Session = Depends(get_db)) -> dict:
    """删除资源记录，并清理遗留的本地生成文件（图片/PPT 等历史资源）。"""
    from pathlib import Path

    from ..models import Resource

    resource = db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(404, "resource not found")

    content = resource.content or {}
    for key in ("image_path", "ppt_path"):
        file_path = content.get(key)
        if file_path:
            path = Path(file_path)
            if path.exists() and path.is_file():
                path.unlink()
    db.delete(resource)
    db.commit()
    return {"deleted_id": resource_id}
