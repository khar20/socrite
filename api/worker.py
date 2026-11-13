import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import delete, or_, select, update

from app.ai import embed_texts
from app.config import settings
from app.db import SessionLocal
from app.models import Material, MaterialChunk, ProcessingJob
from app.services.audit import record_event
from app.services.ingestion import chunk_pages, extract_pages
from app.storage import storage_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("socrite.worker")


async def renew_lease(job_id: str, lease_token: str, stop: asyncio.Event) -> None:
    if SessionLocal is None:
        return
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
            return
        except TimeoutError:
            pass
        try:
            async with SessionLocal() as db:
                result = await db.execute(
                    update(ProcessingJob)
                    .where(ProcessingJob.id == job_id,
                           ProcessingJob.status == "processing",
                           ProcessingJob.lease_token == lease_token)
                    .values(claimed_at=datetime.now(UTC))
                )
                await db.commit()
                if result.rowcount != 1:
                    return
        except Exception:
            logger.exception("Could not renew processing lease for %s", job_id)
            return


async def process_job(job_id: str, material_id: str, lease_token: str) -> None:
    if SessionLocal is None or not settings.database_configured:
        raise RuntimeError("DATABASE_URL is not configured")
    stop_heartbeat = asyncio.Event()
    heartbeat = asyncio.create_task(renew_lease(job_id, lease_token, stop_heartbeat))
    try:
        async with SessionLocal() as db:
            job = await db.scalar(select(ProcessingJob).where(
                ProcessingJob.id == job_id,
                ProcessingJob.status == "processing",
                ProcessingJob.lease_token == lease_token,
            ))
            material = await db.get(Material, material_id)
            if job is None or material is None or not material.object_key:
                raise ValueError("Material or active processing lease was not found")
            object_key = material.object_key
            filename = material.name

        client = storage_client()
        if client is None:
            raise ValueError("Neon Object Storage is not configured")
        stored = await asyncio.to_thread(
            client.get_object, Bucket=settings.neon_storage_bucket, Key=object_key
        )
        content = await asyncio.to_thread(stored["Body"].read)
        chunks = chunk_pages(extract_pages(filename, content))
        if not chunks:
            raise ValueError("No readable text was found in this file")

        embeddings: list[list[float] | None] = [None] * len(chunks)
        if settings.ai_configured:
            for start in range(0, len(chunks), 32):
                batch_embeddings = await embed_texts(
                    [text for _, text in chunks[start:start + 32]]
                )
                embeddings[start:start + 32] = batch_embeddings

        async with SessionLocal() as db:
            job = await db.scalar(select(ProcessingJob).where(
                ProcessingJob.id == job_id,
                ProcessingJob.status == "processing",
                ProcessingJob.lease_token == lease_token,
            ).with_for_update())
            material = await db.scalar(select(Material).where(
                Material.id == material_id,
            ).with_for_update())
            if job is None or material is None:
                logger.info("Discarding stale processing result for %s", material_id)
                return
            await db.execute(delete(MaterialChunk).where(MaterialChunk.material_id == material_id))
            for index, ((page, text), embedding) in enumerate(zip(chunks, embeddings, strict=True)):
                db.add(MaterialChunk(material_id=material_id, chunk_index=index,
                                     page_number=page, content=text, embedding=embedding))
            material.status = "ready"
            material.error = None
            material.chunk_count = len(chunks)
            job.status = "completed"
            job.error = None
            job.claimed_at = None
            job.lease_token = None
            await db.commit()
        logger.info("Processed material %s (%d chunks)", material_id, len(chunks))
    except Exception as exc:
        logger.exception("Material processing failed for %s", material_id)
        async with SessionLocal() as db:
            job = await db.scalar(select(ProcessingJob).where(
                ProcessingJob.id == job_id,
                ProcessingJob.status == "processing",
                ProcessingJob.lease_token == lease_token,
            ).with_for_update())
            if job is not None:
                material = await db.get(Material, material_id)
                if material:
                    material.status = "failed"
                    material.error = str(exc)[:1000]
                job.status = "failed"
                job.error = str(exc)[:1000]
                job.claimed_at = None
                job.lease_token = None
                await db.commit()
    finally:
        stop_heartbeat.set()
        heartbeat.cancel()
        try:
            await heartbeat
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Processing lease task failed for %s", job_id)


async def claim_job() -> tuple[str, str, str] | None:
    if SessionLocal is None or not settings.database_configured:
        raise RuntimeError("DATABASE_URL is not configured")
    async with SessionLocal() as db:
        result = await db.execute(
            select(ProcessingJob).join(Material, Material.id == ProcessingJob.material_id).where(
              Material.status.in_(("queued", "processing")), or_(
                ProcessingJob.status == "queued",
                (ProcessingJob.status == "processing") & (
                    ProcessingJob.claimed_at.is_(None)
                    | (ProcessingJob.claimed_at < datetime.now(UTC) - timedelta(minutes=10))
                ),
            )).order_by(ProcessingJob.created_at).with_for_update(skip_locked=True).limit(1)
        )
        job = result.scalar_one_or_none()
        if job is None:
            return None
        lease_token = str(uuid4())
        job.status = "processing"
        job.attempts += 1
        job.claimed_at = datetime.now(UTC)
        job.lease_token = lease_token
        material = await db.get(Material, job.material_id)
        if material:
            material.status = "processing"
        await db.commit()
        return job.id, job.material_id, lease_token


async def reconcile_materials() -> None:
    if SessionLocal is None or not settings.database_configured:
        return
    now = datetime.now(UTC)
    abandoned_before = now - timedelta(hours=settings.abandoned_upload_hours)
    async with SessionLocal() as db:
        materials = (await db.execute(
            select(Material).where(
                ((Material.status == "deleting") & (
                    Material.deletion_retry_at.is_(None) | (Material.deletion_retry_at <= now)
                ))
                | ((Material.status == "uploading") & (Material.created_at <= abandoned_before))
            ).order_by(Material.created_at).with_for_update(skip_locked=True).limit(25)
        )).scalars().all()
        work = []
        for material in materials:
            if material.status == "uploading":
                material.status = "deleting"
                material.error = "Upload expired before completion; removing the abandoned file."
            material.deletion_retry_at = now + timedelta(seconds=30)
            work.append((material.id, material.course_id, material.uploader_id, material.object_key))
        await db.commit()

    for material_id, course_id, uploader_id, object_key in work:
        try:
            client = storage_client()
            if object_key:
                if client is None:
                    raise RuntimeError("Neon Object Storage is not configured")
                await asyncio.to_thread(
                    client.delete_object, Bucket=settings.neon_storage_bucket, Key=object_key
                )
        except (BotoCoreError, ClientError, OSError, RuntimeError, ValueError) as exc:
            logger.warning("Material cleanup failed for %s: %s", material_id, exc)
            async with SessionLocal() as db:
                material = await db.scalar(select(Material).where(
                    Material.id == material_id, Material.status == "deleting",
                ).with_for_update())
                if material is not None:
                    material.deletion_attempts += 1
                    delay = min(60 * 2 ** min(material.deletion_attempts - 1, 6), 3600)
                    material.deletion_retry_at = datetime.now(UTC) + timedelta(seconds=delay)
                    material.error = str(exc)[:1000]
                    await db.commit()
            continue

        async with SessionLocal() as db:
            material = await db.scalar(select(Material).where(
                Material.id == material_id, Material.status == "deleting",
            ).with_for_update())
            if material is None:
                continue
            record_event(db, uploader_id, "material.deleted", "material", material_id, course_id,
                         {"reason": "abandoned_upload" if material.error and material.error.startswith("Upload expired") else "requested"})
            await db.delete(material)
            await db.commit()


async def main() -> None:
    if SessionLocal is None or not settings.database_configured:
        raise RuntimeError("DATABASE_URL is not configured")
    loop = asyncio.get_running_loop()
    last_reconciliation = 0.0
    while True:
        try:
            now = loop.time()
            if now - last_reconciliation >= 60:
                await reconcile_materials()
                last_reconciliation = now
            claimed = await claim_job()
            if claimed is None:
                await asyncio.sleep(2)
                continue
            await process_job(*claimed)
        except Exception:
            logger.exception("Worker iteration failed")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
