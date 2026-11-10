from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import AIProviderError, generate_question
from app.auth import require_teacher
from app.config import settings
from app.db import get_db
from app.models import Material, MaterialChunk, Profile, Question
from app.routers.courses import owned_course
from app.services.audit import record_event

router = APIRouter(tags=["ai"])


@router.post("/courses/{course_id}/materials/{material_id}/generate-question", status_code=201)
async def generate_question_draft(
    course_id: str, material_id: str, teacher: Profile = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="Configure an OpenAI-compatible provider to generate questions")
    material = await db.scalar(select(Material).where(
        Material.id == material_id, Material.course_id == course_id, Material.status == "ready"))
    if material is None:
        raise HTTPException(status_code=404, detail="Ready course material not found")
    chunks = (await db.execute(select(MaterialChunk).where(MaterialChunk.material_id == material.id)
                               .order_by(MaterialChunk.chunk_index).limit(8))).scalars().all()
    if not chunks:
        raise HTTPException(status_code=409, detail="This material does not contain extracted text")
    try:
        prompt = await generate_question("\n\n".join(chunk.content for chunk in chunks))
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    question = Question(course_id=course_id, unit_id=material.unit_id, prompt=prompt,
                        question_type="open", source_material_id=material.id, status="draft")
    db.add(question)
    await db.flush()
    record_event(db, teacher.id, "question.generated", "question", question.id, course_id,
                 {"material_id": material.id})
    await db.commit()
    return {"id": question.id, "prompt": prompt, "unit_id": question.unit_id,
            "question_type": question.question_type, "rubric": [], "status": question.status}


@router.patch("/questions/{question_id}/publish")
async def publish_question(
    question_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    await owned_course(question.course_id, teacher, db)
    if question.status == "published":
        return {"id": question.id, "status": question.status}
    if question.question_type == "open" and not question.rubric:
        raise HTTPException(status_code=422, detail="Add at least one review criterion before publishing")
    question.status = "published"
    record_event(db, teacher.id, "question.published", "question", question.id, question.course_id)
    await db.commit()
    return {"id": question.id, "status": question.status}
