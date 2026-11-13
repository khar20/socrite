import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.routers import admin, ai, auth, courses, curriculum, materials, student, teacher
from app.worker import main as worker_main


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = None
    if settings.worker_in_api and settings.database_configured:
        task = asyncio.create_task(worker_main(), name="socrite-worker")
    yield
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="Socrite API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Request-ID"],
)


@app.middleware("http")
async def validate_mutation_origin(request: Request, call_next):
    origin = request.headers.get("origin")
    if (request.method in {"POST", "PUT", "PATCH", "DELETE"}
            and (not origin or origin not in settings.cors_origin_list)):
        return JSONResponse(status_code=403, content={"detail": "Untrusted request origin"})
    return await call_next(request)

api = "/api/v1"
app.include_router(auth.router, prefix=api)
app.include_router(admin.router, prefix=api)
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
