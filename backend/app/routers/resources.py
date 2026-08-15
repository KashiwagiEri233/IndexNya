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
    token = set_active_model(payload.model.model_dump(exclude_none=True) if payload.model else None)
    try:
        r = await generate_resource(
            db,
            payload.student_id,
            payload.type,
            payload.topic,
            conversation_id=payload.conversation_id,
            extra=payload.extra,
            image_model_config=payload.image_model.model_dump(exclude_none=True) if payload.image_model else None,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        reset_active_model(token)
    return ResourceOut.model_validate(r)


@router.get("", response_model=list[ResourceOut])
def list_(student_id: int, type: str | None = None, db: Session = Depends(get_db)) -> list[ResourceOut]:
    items = list_resources(db, student_id, resource_type=type)
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
    """删除资源记录，并清理本地生成的图片/PPT文件。"""
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


@router.get("/{resource_id}/file")
def get_file(resource_id: int, db: Session = Depends(get_db)):
    """获取 illustration 资源生成的图片文件。"""
    from pathlib import Path

    from fastapi.responses import FileResponse

    from ..models import Resource
    r = db.get(Resource, resource_id)
    if not r:
        raise HTTPException(404, "resource not found")
    content = r.content or {}
    if r.type == "illustration":
        file_path = content.get("image_path")
        media_type = "image/png"
        default_filename = "image.png"
        not_found_message = "image file not found on disk"
    elif r.type == "ppt":
        file_path = content.get("ppt_path")
        media_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        default_filename = "learning.pptx"
        not_found_message = "ppt file not found on disk"
    else:
        raise HTTPException(400, "resource has no downloadable file")
    if not file_path or not Path(file_path).exists():
        raise HTTPException(404, not_found_message)
    filename = (r.meta or {}).get("filename") or default_filename
    return FileResponse(path=file_path, media_type=media_type, filename=filename)
