"""资源路由 — 功能2后端接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..schemas import ResourceGenerateRequest, ResourceOut
from ..services.resource_service import generate_resource, list_resources

router = APIRouter()


@router.post("/generate", response_model=ResourceOut)
async def generate(
    payload: ResourceGenerateRequest,
    db: Session = Depends(get_db),
) -> ResourceOut:
    try:
        r = await generate_resource(
            db,
            payload.student_id,
            payload.type,
            payload.topic,
            conversation_id=payload.conversation_id,
            extra=payload.extra,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
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


@router.get("/{resource_id}/file")
def get_file(resource_id: int, db: Session = Depends(get_db)):
    """获取 illustration 资源生成的图片文件。"""
    from pathlib import Path

    from fastapi.responses import FileResponse

    from ..models import Resource
    r = db.get(Resource, resource_id)
    if not r:
        raise HTTPException(404, "resource not found")
    if r.type != "illustration":
        raise HTTPException(400, "resource has no file")
    content = r.content or {}
    file_path = content.get("image_path")
    if not file_path or not Path(file_path).exists():
        raise HTTPException(404, "image file not found on disk")
    filename = (r.meta or {}).get("filename") or "image.png"
    return FileResponse(
        path=file_path,
        media_type="image/png",
        filename=filename,
    )


@router.get("/{resource_id}/video-status")
async def video_status(resource_id: int, db: Session = Depends(get_db)):
    """轮询视频生成任务状态。讯飞数字人视频异步生成，前端定时查询。"""
    from ..models import Resource
    from ..tools.xfyun_video import query_video_task

    r = db.get(Resource, resource_id)
    if not r:
        raise HTTPException(404, "resource not found")
    if r.type != "video":
        raise HTTPException(400, "resource is not a video")

    # 已完成直接返回
    if r.status == "completed" and r.file_url:
        return {"status": "completed", "video_url": r.file_url}

    task_id = (r.meta or {}).get("task_id")
    if not task_id:
        return {"status": r.status, "message": "no task_id"}

    try:
        data = await query_video_task(task_id)
        payload = data.get("payload") or data
        video_url = payload.get("video")
        if video_url:
            r.file_url = video_url
            r.status = "completed"
            content = dict(r.content or {})
            content["video_url"] = video_url
            content["cover_url"] = payload.get("image")
            content["audio_url"] = payload.get("audio")
            content["status"] = "completed"
            r.content = content
            db.commit()
            return {"status": "completed", "video_url": video_url}
        # 仍在生成
        return {"status": "processing", "task_id": task_id, "raw": payload}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
