from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.routers import ai, courses, curriculum, materials, me, student, teacher


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield


app = FastAPI(title="Socrite API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

api = "/api/v1"
app.include_router(me.router, prefix=api)
app.include_router(courses.router, prefix=api)
app.include_router(curriculum.router, prefix=api)
app.include_router(materials.router, prefix=api)
app.include_router(teacher.router, prefix=api)
app.include_router(student.router, prefix=api)
app.include_router(ai.router, prefix=api)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database is not ready") from exc
    return {"status": "ready"}
