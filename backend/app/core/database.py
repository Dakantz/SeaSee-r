from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base

from app.core.config import settings

from sqlalchemy.pool import NullPool

# Create async engine for PostgreSQL connection
engine = create_async_engine(settings.database_url, echo=True, poolclass=NullPool)

# Session factory for async database sessions
async_session = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# Declarative base for SQLAlchemy models
Base = declarative_base()

async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Dependency injection helper to yield active async database sessions."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
