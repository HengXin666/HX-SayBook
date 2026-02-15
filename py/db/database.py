from typing import Any, Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.pool import StaticPool
from py.core.config import *

config_path = getConfigPath()
# SQLite 数据库文件，存储在项目目录下的 py/user_data/
SQLALCHEMY_DATABASE_URL = f"sqlite:///{os.path.join(config_path, 'app_test.db')}"


# SQLite 使用 StaticPool：所有请求复用同一个连接，彻底避免连接数爆炸
# check_same_thread=False 允许跨线程使用（FastAPI 异步环境需要）
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    echo=False,
)

# SessionLocal 用于依赖注入
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base 类，所有 ORM 模型继承它
Base = declarative_base()


# 依赖函数
def get_db() -> Generator[Session, Any, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
