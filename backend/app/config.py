"""应用配置 — 通过 .env 注入（可选；模型配置统一在前端「设置」中完成，无需 .env）。"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env 位于项目根目录（backend/ 的上一级）；缺失时全部使用默认值
_ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
