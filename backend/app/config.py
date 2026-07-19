"""应用配置 — 通过 .env 注入，所有密钥集中管理。"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env 位于项目根目录（backend/ 的上一级）
_ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ===== 1. LLM (讯飞星火 X2, OpenAI 兼容协议) =====
    # X2 专属路径 /x2/chat/completions；model 字段仍填 "spark-x"
    # 鉴权：APIPassword (Bearer)，无需 secret
    llm_api_key: str = ""
    llm_base_url: str = "https://spark-api-open.xf-yun.com/x2/"
    llm_model: str = "spark-x"

    # ===== 2. 讯飞数字人视频生成 API =====
    # https://www.xfyun.cn/doc/spark/videoGenerate.html
    # 鉴权：HMAC-SHA256 通用签名（app_id + api_key + api_secret）
    video_app_id: str = ""
    video_api_key: str = ""
    video_api_secret: str = ""
    video_host: str = "vms.cn-huadong-1.xf-yun.com"

    # ===== 3. 讯飞智能 PPT v2 API =====
    # https://www.xfyun.cn/doc/spark/PPTv2.html
    # 鉴权：MD5(appId+ts) → HMAC-SHA1 → base64（只需 appId + apiSecret，无 apiKey）
    ppt_app_id: str = ""
    ppt_api_secret: str = ""
    ppt_host: str = "zwapi.xfyun.cn"

    # ===== 4. 讯飞文生图 tti API =====
    # https://www.xfyun.cn/doc/spark/ImageGeneration.html
    # 鉴权：HMAC-SHA256 通用签名（app_id + api_key + api_secret）
    image_app_id: str = ""
    image_api_key: str = ""
    image_api_secret: str = ""
    image_host: str = "spark-api.cn-huabei-1.xf-yun.com"
    image_path: str = "/v2.1/tti"
    image_width: int = 1024
    image_height: int = 1024

    # ===== 5. 讯飞图片理解 API（WebSocket）=====
    # https://www.xfyun.cn/doc/spark/ImageUnderstanding.html
    # 与文生图 tti 同组凭证（控制台同一服务）
    # 鉴权：HMAC-SHA256 通用签名；协议：wss
    image_understanding_path: str = "/v2.1/image"
    image_understanding_domain: str = "imagev3"

    # ===== 应用配置 =====
    app_name: str = "Index-学习智能助手"
    database_url: str = "sqlite:///./learning_agent.db"
    cors_origins: str = "http://localhost:5173,http://localhost:4173"
    log_level: str = "INFO"

    @field_validator("cors_origins")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @property
    def cors_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_ready(self) -> bool:
        return bool(self.llm_api_key and self.llm_api_key != "your-spark-api-password-here")

    @property
    def video_ready(self) -> bool:
        return bool(self.video_app_id and self.video_api_key and self.video_api_secret
                    and not self.video_app_id.startswith("your-"))

    @property
    def ppt_ready(self) -> bool:
        return bool(self.ppt_app_id and self.ppt_api_secret
                    and not self.ppt_app_id.startswith("your-"))

    @property
    def image_ready(self) -> bool:
        return bool(self.image_app_id and self.image_api_key and self.image_api_secret
                    and not self.image_app_id.startswith("your-"))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
