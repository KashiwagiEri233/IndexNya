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

    # ===== 1. LLM (OpenAI 兼容协议) =====
    # 不内置默认模型；可以由前端在每次请求中选择，也可以通过 .env 显式配置服务端模型。
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""

    # ===== 2. 讯飞文生图 tti API =====

    # https://www.xfyun.cn/doc/spark/ImageGeneration.html
    # 鉴权：HMAC-SHA256 通用签名（app_id + api_key + api_secret）
    image_app_id: str = ""
    image_api_key: str = ""
    image_api_secret: str = ""
    image_host: str = "spark-api.cn-huabei-1.xf-yun.com"
    image_path: str = "/v2.1/tti"
    image_width: int = 1024
    image_height: int = 1024

    # ===== 4. 讯飞图片理解 API（WebSocket）=====
    # https://www.xfyun.cn/doc/spark/ImageUnderstanding.html
    # 与文生图 tti 同组凭证（控制台同一服务）
    # 鉴权：HMAC-SHA256 通用签名；协议：wss
    image_understanding_path: str = "/v2.1/image"
    image_understanding_domain: str = "imagev3"

    # ===== 应用配置 =====
    app_name: str = "Index 学习岛"
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
        return bool(self.llm_api_key and self.llm_base_url and self.llm_model)

    @property
    def image_ready(self) -> bool:
        return bool(self.image_app_id and self.image_api_key and self.image_api_secret
                    and not self.image_app_id.startswith("your-"))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
