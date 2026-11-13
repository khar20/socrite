import re
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_teacher
from app.config import settings
from app.db import get_db
from app.models import Course, Material, MaterialChunk, MaterialFolder, ProcessingJob, Unit, User
from app.routers.courses import owned_course
from app.schemas import (
    FolderCreate,
    FolderUpdate,
    LinkCreate,
    MaterialOut,
    MaterialUpdate,
    UploadCompleteOut,
    UploadRequest,
)
from app.services.audit import record_event
from app.storage import storage_client

router = APIRouter(tags=["materials"])
ALLOWED_TYPES = {
    ".pdf": {"application/pdf"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".pptx": {"application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    ".txt": {"text/plain"},
}


async def owned_material(
    material_id: str, teacher: User, db: AsyncSession, lock: bool = False,
) -> Material:
    query = select(Material).join(Course).where(Material.id == material_id, Course.owner_id == teacher.id)
    if lock:
        query = query.with_for_update(of=Material)
    result = await db.execute(query)
    material = result.scalar_one_or_none()
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")
    return material


async def validate_folder(folder_id: str | None, course_id: str, db: AsyncSession) -> None:
    if folder_id:
        folder = await db.get(MaterialFolder, folder_id)
        if folder is None or folder.course_id != course_id:
            raise HTTPException(status_code=422, detail="Folder does not belong to this course")


async def validate_unit(unit_id: str | None, course_id: str, db: AsyncSession) -> None:
    if unit_id:
        unit = await db.get(Unit, unit_id)
        if unit is None or unit.course_id != course_id:
            raise HTTPException(status_code=422, detail="Unit does not belong to this course")


@router.get("/courses/{course_id}/folders")
async def list_folders(
    course_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(MaterialFolder).where(MaterialFolder.course_id == course_id).order_by(MaterialFolder.position, MaterialFolder.name))
    folders = result.scalars().all()
    counts = dict((await db.execute(
        select(Material.folder_id, func.count(Material.id))
        .where(Material.course_id == course_id, Material.folder_id.is_not(None))
        .group_by(Material.folder_id)
    )).all())
    return [{"id": folder.id, "name": folder.name, "count": counts.get(folder.id, 0)}
            for folder in folders]


@router.post("/courses/{course_id}/folders", status_code=201)
async def create_folder(
    course_id: str, data: FolderCreate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    folder = MaterialFolder(course_id=course_id, name=data.name)
    db.add(folder)
    await db.flush()
    record_event(db, teacher.id, "material_folder.created", "folder", folder.id, course_id)
    await db.commit()
    return {"id": folder.id, "name": folder.name, "count": 0}


@router.patch("/folders/{folder_id}")
async def update_folder(
    folder_id: str, data: FolderUpdate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(select(MaterialFolder).join(Course).where(
        MaterialFolder.id == folder_id, Course.owner_id == teacher.id
    ))
    folder = result.scalar_one_or_none()
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    folder.name = data.name
    count = await db.scalar(select(func.count(Material.id)).where(Material.folder_id == folder.id)) or 0
    record_event(db, teacher.id, "material_folder.updated", "folder", folder.id, folder.course_id)
    await db.commit()
    return {"id": folder.id, "name": folder.name, "count": count}


@router.delete("/folders/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(select(MaterialFolder).join(Course).where(
        MaterialFolder.id == folder_id, Course.owner_id == teacher.id
    ))
    folder = result.scalar_one_or_none()
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    await db.execute(update(Material).where(Material.folder_id == folder.id).values(folder_id=None))
    record_event(db, teacher.id, "material_folder.deleted", "folder", folder.id, folder.course_id,
                 {"folder_name": folder.name})
    await db.delete(folder)
    await db.commit()
    return Response(status_code=204)


@router.get("/courses/{course_id}/materials")
async def list_materials(
    course_id: str, folder_id: str | None = None, search: str = Query(default="", max_length=160),
    limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0),
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    conditions = [Material.course_id == course_id]
    if folder_id:
        conditions.append(Material.folder_id == folder_id)
    if search.strip():
        conditions.append(Material.name.ilike(f"%{search.strip()}%"))
    query = select(Material).where(*conditions)
    total = await db.scalar(select(func.count(Material.id)).where(*conditions)) or 0
    result = await db.execute(query.order_by(Material.created_at.desc()).limit(limit).offset(offset))
    items = [MaterialOut.model_validate(material).model_dump() for material in result.scalars().all()]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/courses/{course_id}/materials/uploads", status_code=201)
async def begin_upload(
    course_id: str, data: UploadRequest, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    if not settings.storage_configured or storage_client() is None:
        raise HTTPException(status_code=503, detail="Neon Object Storage is not configured")
    extension = Path(data.name).suffix.casefold()
    if extension not in ALLOWED_TYPES or data.content_type not in ALLOWED_TYPES[extension]:
        raise HTTPException(status_code=415, detail="Upload a PDF, DOCX, PPTX, or TXT file")
    if data.size_bytes > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds the {settings.max_upload_mb} MB limit")
    await validate_folder(data.folder_id, course_id, db)
    await validate_unit(data.unit_id, course_id, db)
    material = Material(course_id=course_id, folder_id=data.folder_id, unit_id=data.unit_id,
                        uploader_id=teacher.id, name=Path(data.name).name,
                        content_type=data.content_type, size_bytes=data.size_bytes)
    db.add(material)
    await db.flush()
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", material.name).strip("._") or "material"
    material.object_key = f"courses/{course_id}/materials/{material.id}/{safe_name}"
    try:
        client = storage_client()
        url = client.generate_presigned_url(
            "put_object",
            Params={"Bucket": settings.neon_storage_bucket, "Key": material.object_key,
                    "ContentType": material.content_type},
            ExpiresIn=300,
        )
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=502, detail="Could not prepare a secure upload URL") from exc
    record_event(db, teacher.id, "material.upload.started", "material", material.id, course_id)
    await db.commit()
    return {"material_id": material.id, "upload_url": url,
            "headers": {"Content-Type": material.content_type}, "expires_in": 300}


@router.post("/materials/{material_id}/complete", response_model=UploadCompleteOut)
async def complete_upload(
    material_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> UploadCompleteOut:
    material = await owned_material(material_id, teacher, db, lock=True)
    if material.status not in {"uploading", "queued", "processing", "ready"} or not material.object_key:
        raise HTTPException(status_code=409, detail="Material is not awaiting upload confirmation")
    client = storage_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Neon Object Storage is not configured")
    try:
        object_info = client.head_object(Bucket=settings.neon_storage_bucket, Key=material.object_key)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="Uploaded file was not found in storage") from exc
    if object_info.get("ContentLength") != material.size_bytes:
        raise HTTPException(status_code=409, detail="Uploaded file size does not match the declared size")
    if object_info.get("ContentType") and object_info["ContentType"] != material.content_type:
        raise HTTPException(status_code=409, detail="Uploaded file type does not match the declared type")
    if material.status == "uploading":
        material.status = "queued"
        db.add(ProcessingJob(material_id=material.id))
        record_event(db, teacher.id, "material.upload.completed", "material", material.id, material.course_id)
        await db.commit()
        await db.refresh(material)
    return UploadCompleteOut.model_validate({
        **MaterialOut.model_validate(material).model_dump(),
        "storage_confirmed": True,
    })


@router.post("/courses/{course_id}/materials/links", status_code=201, response_model=MaterialOut)
async def create_link(
    course_id: str, data: LinkCreate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> Material:
    await owned_course(course_id, teacher, db)
    await validate_folder(data.folder_id, course_id, db)
    await validate_unit(data.unit_id, course_id, db)
    material = Material(course_id=course_id, folder_id=data.folder_id, unit_id=data.unit_id,
                        uploader_id=teacher.id, name=data.name, kind="link", url=str(data.url),
                        content_type="text/uri-list", status="ready")
    db.add(material)
    await db.flush()
    record_event(db, teacher.id, "material.link.created", "material", material.id, course_id)
    await db.commit()
    await db.refresh(material)
    return material


@router.get("/materials/{material_id}/download-url")
async def material_download_url(
    material_id: str, inline: bool = False, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    material = await owned_material(material_id, teacher, db)
    if not material.object_key:
        if material.url:
            return {"url": material.url}
        raise HTTPException(status_code=404, detail="File is not available")
    client = storage_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Neon Object Storage is not configured")
    filename = re.sub(r'[\r\n"\\]', "_", material.name)
    disposition = "inline" if inline else "attachment"
    url = client.generate_presigned_url(
        "get_object", Params={
            "Bucket": settings.neon_storage_bucket,
            "Key": material.object_key,
            "ResponseContentDisposition": f'{disposition}; filename="{filename}"',
        },
        ExpiresIn=300,
    )
    return {"url": url}


@router.patch("/materials/{material_id}", response_model=MaterialOut)
async def update_material(
    material_id: str, data: MaterialUpdate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> Material:
    material = await owned_material(material_id, teacher, db)
    await validate_folder(data.folder_id, material.course_id, db)
    await validate_unit(data.unit_id, material.course_id, db)
    material.name = Path(data.name).name
    material.folder_id = data.folder_id
    material.unit_id = data.unit_id
    record_event(db, teacher.id, "material.updated", "material", material.id, material.course_id)
    await db.commit()
    await db.refresh(material)
    return material


@router.get("/materials/{material_id}/text")
async def material_text(
    material_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    material = await owned_material(material_id, teacher, db)
    result = await db.execute(select(MaterialChunk).where(MaterialChunk.material_id == material.id)
                              .order_by(MaterialChunk.chunk_index).limit(30))
    return {"chunks": [chunk.content for chunk in result.scalars().all()]}


@router.post("/materials/{material_id}/retry", response_model=MaterialOut)
async def retry_material(
    material_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Material:
    material = await owned_material(material_id, teacher, db, lock=True)
    if material.status in {"queued", "processing"}:
        return material
    if material.status not in {"failed", "ready"}:
        raise HTTPException(status_code=409, detail="Material cannot be retried in its current state")
    material.status = "queued"
    material.error = None
    db.add(ProcessingJob(material_id=material.id))
    await db.commit()
    await db.refresh(material)
    return material


@router.delete("/materials/{material_id}", status_code=202, response_model=None)
async def delete_material(
    material_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict | Response:
    material = await owned_material(material_id, teacher, db, lock=True)
    if material.status == "processing":
        raise HTTPException(status_code=409, detail="Wait for material processing to finish before deleting it")
    if material.object_key:
        if storage_client() is None:
            raise HTTPException(status_code=503, detail="Neon Object Storage is not configured")
        if material.status == "deleting":
            material.deletion_retry_at = datetime.now(UTC)
            material.error = None
            await db.commit()
            return {"status": "deleting"}
        await db.execute(delete(ProcessingJob).where(
            ProcessingJob.material_id == material.id,
            ProcessingJob.status != "processing",
        ))
        material.status = "deleting"
        material.error = None
        material.deletion_retry_at = datetime.now(UTC)
        record_event(db, teacher.id, "material.delete.queued", "material", material.id, material.course_id)
        await db.commit()
        return {"status": "deleting"}
    record_event(db, teacher.id, "material.deleted", "material", material.id, material.course_id)
    await db.delete(material)
    await db.commit()
    return Response(status_code=204)
