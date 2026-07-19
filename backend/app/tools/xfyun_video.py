"""讯飞数字人视频生成工具 — 调用 vms.cn-huadong-1.xf-yun.com。

流程：HMAC-SHA256 签名 → POST /v1/private/video/generate 拿 task_id →
     轮询 POST /v1/private/video/query → 完成后返回 video/audio/image URL。

参考：https://www.xfyun.cn/doc/spark/videoGenerate.html
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Any, Optional
from urllib.parse import urlencode, quote

import httpx

from ..config import settings


def _auth_url(path: str, method: str = "POST", host: str = "", *,
               api_key: str = "", api_secret: str = "") -> str:
    """生成讯飞鉴权 URL（query 参数携带签名）。

    讯飞通用签名算法（hmac-sha256）：
        signature_origin = "host: {host}\ndate: {date}\n{method} {path} HTTP/1.1"
        signature = base64(hmac_sha256(api_secret, signature_origin))
        authorization = base64('api_key="...", algorithm="hmac-sha256", ...')

    host/api_key/api_secret 必填，由各功能模块传入对应的独立凭证。
    """
    if not host:
        host = settings.video_host
    if not api_key:
        api_key = settings.video_api_key
    if not api_secret:
        api_secret = settings.video_api_secret

    now = datetime.now(timezone.utc)
    date = format_datetime(now, usegmt=True)

    path_only = path.split("?")[0]
    signature_origin = f"host: {host}\ndate: {date}\n{method} {path_only} HTTP/1.1"
    signature_sha = hmac.new(
        api_secret.encode("utf-8"),
        signature_origin.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    signature = base64.b64encode(signature_sha).decode()

    authorization_origin = (
        f'api_key="{api_key}", '
        f'algorithm="hmac-sha256", '
        f'headers="host date request-line", '
        f'signature="{signature}"'
    )
    authorization = base64.b64encode(authorization_origin.encode("utf-8")).decode()

    params = {
        "host": host,
        "date": date,
        "authorization": authorization,
    }
    return f"https://{host}{path_only}?{urlencode(params)}"


async def create_video_task(prompt: str, word_count: int = 120) -> str:
    """创建数字人视频生成任务，返回 task_id。"""
    url = _auth_url("/v1/private/video/generate")
    body = {
        "header": {"app_id": settings.video_app_id},
        "parameter": {
            "avatar": {
                "prompt": prompt,
                "word_count": word_count,
            }
        },
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=body)
        # 不用 raise_for_status，直接解析返回体（讯飞 4xx 时也返回 JSON 错误详情）
        try:
            data = resp.json()
        except Exception:
            raise RuntimeError(f"xfyun video non-json (HTTP {resp.status_code}): {resp.text[:300]}")
        if resp.status_code != 200 or data.get("header", {}).get("code", -1) != 0:
            raise RuntimeError(f"xfyun video generate failed (HTTP {resp.status_code}): {data}")
        task_id = data.get("header", {}).get("task_id") or data.get("payload", {}).get("task_id")
        if not task_id:
            raise RuntimeError(f"no task_id in response: {data}")
        return task_id


async def query_video_task(task_id: str) -> dict[str, Any]:
    """查询任务状态。返回 payload 字典。

    完成（task_status 为 3 或 4）时含 text/image/audio/bgm/video URL。
    """
    url = _auth_url("/v1/private/video/query")
    body = {
        "header": {"app_id": settings.video_app_id, "task_id": task_id},
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=body)
        resp.raise_for_status()
        data = resp.json()
        return data


async def wait_for_video(
    task_id: str,
    *,
    interval: float = 10.0,
    timeout: float = 600.0,
) -> dict[str, Any]:
    """轮询直到任务完成或超时。返回 payload。"""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        data = await query_video_task(task_id)
        header = data.get("header", {})
        status = header.get("task_status")
        # 3 / 4 表示完成
        if status in (3, 4, "3", "4"):
            return data.get("payload", data)
        await asyncio.sleep(interval)
    raise TimeoutError(f"video task {task_id} timed out")


async def generate_video(prompt: str, word_count: int = 120) -> dict[str, Any]:
    """端到端：提交 prompt → 轮询 → 返回视频元信息。

    返回字段：text / image / audio / bgm / video
    """
    task_id = await create_video_task(prompt, word_count=word_count)
    result = await wait_for_video(task_id)
    return {
        "task_id": task_id,
        "text": result.get("text"),
        "image": result.get("image"),
        "audio": result.get("audio"),
        "bgm": result.get("bgm"),
        "video": result.get("video"),
        "raw": result,
    }
