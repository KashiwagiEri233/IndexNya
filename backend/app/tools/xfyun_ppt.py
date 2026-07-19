"""讯飞智能 PPT v2 API 调用工具。

参考：https://www.xfyun.cn/doc/spark/PPTv2.html

流程：HMAC-SHA1 鉴权 → POST /api/ppt/v2/create 拿 sid →
     GET /api/ppt/v2/progress?sid= 轮询（限流 3s/次）→ done 后取 data.pptUrl。

鉴权算法：
    ts     = 当前秒级时间戳
    auth   = md5(appId + ts)                    # 32 位 hex
    sign   = base64(hmac_sha1(secret, auth))   # secret 为 API Secret
    header 三件套：appId / timestamp / signature
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import base64
import time
from typing import Any

import httpx

from ..config import settings


def _auth_headers() -> dict[str, str]:
    """生成讯飞 PPT API 鉴权 header。"""
    app_id = settings.ppt_app_id
    secret = settings.ppt_api_secret
    ts = str(int(time.time()))
    auth = hashlib.md5(f"{app_id}{ts}".encode("utf-8")).hexdigest()
    sig = base64.b64encode(
        hmac.new(secret.encode("utf-8"), auth.encode("utf-8"), hashlib.sha1).digest()
    ).decode("utf-8")
    return {"appId": app_id, "timestamp": ts, "signature": sig}


async def create_ppt_task(
    query: str,
    *,
    author: str = "Index-学习智能助手",
    is_card_note: bool = True,
    is_figure: bool = True,
    ai_image: str = "normal",
    search: bool = False,
    language: str = "cn",
) -> str:
    """创建 PPT 生成任务，返回 sid。

    讯飞要求 multipart/form-data。httpx 同时传 data + files 时会自动用 multipart。
    """
    url = f"https://{settings.ppt_host}/api/ppt/v2/create"
    headers = _auth_headers()
    data = {
        "query": query,
        "author": author,
        "isCardNote": str(is_card_note).lower(),
        "isFigure": str(is_figure).lower(),
        "aiImage": ai_image,
        "search": str(search).lower(),
        "language": language,
    }
    # files 占位：让 httpx 走 multipart/form-data 而非 application/x-www-form-urlencoded
    files = {"placeholder": ("", b"", "application/octet-stream")}
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, data=data, files=files)
        resp.raise_for_status()
        body = resp.json()
        code = body.get("code")
        sid = body.get("sid") or (body.get("data") or {}).get("sid")
        if not sid or code not in (0, 200, "0", "200"):
            raise RuntimeError(f"xfyun ppt create failed: {body}")
        return str(sid)


async def query_ppt_progress(sid: str) -> dict[str, Any]:
    """查询 PPT 任务进度。

    返回示例：
        { "code": 0, "data": { "progress": 60, "status": "processing", "pptUrl": null } }
        完成时 status 为 done，pptUrl 为下载链接。
    """
    url = f"https://{settings.ppt_host}/api/ppt/v2/progress"
    headers = _auth_headers()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url, headers=headers, params={"sid": sid})
        resp.raise_for_status()
        return resp.json()


async def wait_for_ppt(
    sid: str,
    *,
    interval: float = 3.0,
    timeout: float = 600.0,
) -> dict[str, Any]:
    """轮询直到任务完成或超时。返回包含 pptUrl 的 payload。"""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        data = await query_ppt_progress(sid)
        status = (data.get("data") or {}).get("status") or data.get("status")
        # 讯飞完成标识：status == "done" 或 progress == 100
        if status in ("done", "success", "完成") or (data.get("data") or {}).get("pptUrl"):
            return data.get("data") or data
        await asyncio.sleep(interval)
    raise TimeoutError(f"ppt task {sid} timed out")


async def generate_ppt(
    query: str,
    *,
    author: str = "Index-学习智能助手",
    is_card_note: bool = True,
    is_figure: bool = True,
    ai_image: str = "normal",
) -> dict[str, Any]:
    """端到端：提交 query → 轮询 → 返回 pptUrl 等元信息。"""
    sid = await create_ppt_task(
        query,
        author=author,
        is_card_note=is_card_note,
        is_figure=is_figure,
        ai_image=ai_image,
    )
    result = await wait_for_ppt(sid)
    return {
        "sid": sid,
        "ppt_url": result.get("pptUrl"),
        "status": result.get("status", "done"),
        "raw": result,
    }
