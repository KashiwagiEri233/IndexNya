"""SQLAlchemy 引擎与会话。SQLite + 建表即用。"""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


connect_args = {"check_same_thread": False} if settings.database_url.startswith(
    "sqlite"
) else {}

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    """建表。在应用启动时调用一次。"""
    from . import models  # noqa: F401 — 触发模型注册

    Base.metadata.create_all(bind=engine)

    # 轻量迁移：项目没有引入 Alembic，兼容已经存在的 SQLite 数据库。
    columns = {column["name"] for column in inspect(engine).get_columns("conversations")}
    if "parent_conversation_id" not in columns:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE conversations ADD COLUMN parent_conversation_id INTEGER REFERENCES conversations(id)")
            )


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
