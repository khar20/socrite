import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from app.ai import embed_texts
from app.config import settings
from app.db import SessionLocal
from app.models import Material, MaterialChunk, ProcessingJob
from app.services.ingestion import chunk_pages, extract_pages
from app.storage import storage_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("socrite.worker")


async def process_job(job_id: str, material_id: str) -> None:
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is not configured")
    try:
        async with SessionLocal() as db:
            material = await db.get(Material, material_id)
            if material is None or not material.object_key:
                raise ValueError("Material or stored object was not found")
            client = storage_client()
            if client is None:
                raise ValueError("Neon Object Storage is not configured")
            stored = await asyncio.to_thread(
                client.get_object, Bucket=settings.neon_storage_bucket, Key=material.object_key
            )
            content = await asyncio.to_thread(stored["Body"].read)
            chunks = chunk_pages(extract_pages(material.name, content))
            if not chunks:
                raise ValueError("No readable text was found in this file")

            embeddings: list[list[float] | None] = [None] * len(chunks)
            if settings.ai_configured:
                for start in range(0, len(chunks), 32):
                    embeddings[start:start + 32] = await embed_texts(
                        [text for _, text in chunks[start:start + 32]]
                    )

            old = (await db.execute(select(MaterialChunk).where(
                MaterialChunk.material_id == material_id))).scalars().all()
            for row in old:
                await db.delete(row)
            for index, ((page, text), embedding) in enumerate(zip(chunks, embeddings, strict=True)):
                db.add(MaterialChunk(material_id=material_id, chunk_index=index,
                                     page_number=page, content=text, embedding=embedding))
            material.status = "ready"
            material.error = None
            material.chunk_count = len(chunks)
            job = await db.get(ProcessingJob, job_id)
            if job:
                job.status = "completed"
                job.error = None
                job.claimed_at = None
            await db.commit()
            logger.info("Processed material %s (%d chunks)", material_id, len(chunks))
    except Exception as exc:
        logger.exception("Material processing failed for %s", material_id)
        async with SessionLocal() as db:
            material = await db.get(Material, material_id)
            job = await db.get(ProcessingJob, job_id)
            if material:
                material.status = "failed"
                material.error = str(exc)[:1000]
            if job:
                job.status = "failed"
                job.error = str(exc)[:1000]
                job.claimed_at = None
            await db.commit()


async def claim_job() -> tuple[str, str] | None:
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is not configured")
    async with SessionLocal() as db:
        result = await db.execute(
            select(ProcessingJob).where(or_(
                ProcessingJob.status == "queued",
                (ProcessingJob.status == "processing") & (
                    ProcessingJob.claimed_at.is_(None)
                    | (ProcessingJob.claimed_at < datetime.now(UTC) - timedelta(minutes=10))
                ),
            ))
            .order_by(ProcessingJob.created_at).with_for_update(skip_locked=True).limit(1)
        )
        job = result.scalar_one_or_none()
        if job is None:
            return None
        job.status = "processing"
        job.attempts += 1
        job.claimed_at = datetime.now(UTC)
        material = await db.get(Material, job.material_id)
        if material:
            material.status = "processing"
        await db.commit()
        return job.id, job.material_id


async def main() -> None:
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is not configured")
    while True:
        claimed = await claim_job()
        if claimed is None:
            await asyncio.sleep(2)
            continue
        await process_job(*claimed)


if __name__ == "__main__":
    asyncio.run(main())
