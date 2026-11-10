import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete, or_, select, update

from app.ai import embed_texts
from app.config import settings
from app.db import SessionLocal
from app.models import Material, MaterialChunk, ProcessingJob
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
                embeddings[start:start + 32] = await embed_texts(
                    [text for _, text in chunks[start:start + 32]]
                )

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
            select(ProcessingJob).where(or_(
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


async def main() -> None:
    if SessionLocal is None or not settings.database_configured:
        raise RuntimeError("DATABASE_URL is not configured")
    while True:
        claimed = await claim_job()
        if claimed is None:
            await asyncio.sleep(2)
            continue
        await process_job(*claimed)


if __name__ == "__main__":
    asyncio.run(main())
