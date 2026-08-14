"""讯飞通用 HMAC-SHA256 鉴权 URL 工具。"""
from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import datetime, timezone
from email.utils import format_datetime
from urllib.parse import urlencode


def auth_url(
    path: str,
    method: str = "POST",
    host: str = "",
    *,
    api_key: str = "",
    api_secret: str = "",
) -> str:
    """根据指定服务的凭证生成讯飞鉴权 URL。"""
    if not host or not api_key or not api_secret:
        raise ValueError("xfyun auth requires host, api_key and api_secret")

    now = datetime.now(timezone.utc)
    date = format_datetime(now, usegmt=True)
    path_only = path.split("?")[0]
    signature_origin = f"host: {host}\ndate: {date}\n{method} {path_only} HTTP/1.1"
    signature = base64.b64encode(
        hmac.new(
            api_secret.encode("utf-8"),
            signature_origin.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    ).decode()
    authorization_origin = (
        f'api_key="{api_key}", '
        f'algorithm="hmac-sha256", '
        f'headers="host date request-line", '
        f'signature="{signature}"'
    )
    authorization = base64.b64encode(authorization_origin.encode("utf-8")).decode()
    params = {"host": host, "date": date, "authorization": authorization}
    return f"https://{host}{path_only}?{urlencode(params)}"
