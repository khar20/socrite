from collections.abc import AsyncGenerator

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True) if settings.database_url else None
SessionLocal = async_sessionmaker(engine, expire_on_commit=False) if engine else None


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    if SessionLocal is None or not settings.database_configured:
        raise HTTPException(status_code=503, detail="DATABASE_URL is not configured")
    async with SessionLocal() as session:
        yield session
