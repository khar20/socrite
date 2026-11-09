from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import ai, courses, curriculum, materials, me, teacher


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
app.include_router(ai.router, prefix=api)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
