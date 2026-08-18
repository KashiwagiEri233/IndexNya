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
    # 图片理解（上传图片提问）直接复用该文本模型的多模态能力，无需单独配置。
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""

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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
