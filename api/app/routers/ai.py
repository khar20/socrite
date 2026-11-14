from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import AIProviderError, generate_question, generate_unit_content
from app.auth import require_teacher
from app.config import settings
from app.db import get_db
from app.models import Material, MaterialChunk, Question, Skill, Topic, Unit, User
from app.routers.courses import owned_course
from app.schemas import (
    CourseActivitiesGenerationIn,
    GeneratedUnitContent,
    PracticeGenerationIn,
    UnitContentGenerationIn,
)
from app.services.audit import record_event
from app.services.generation import create_practice_assessment

router = APIRouter(tags=["ai"])


@router.post("/courses/{course_id}/assessments/generate-course", status_code=201)
async def generate_course_activities(
    course_id: str, data: CourseActivitiesGenerationIn,
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    course = await owned_course(course_id, teacher, db)
    if course.status == "archived":
        raise HTTPException(status_code=409, detail="No se pueden agregar actividades a un curso archivado.")
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="Configura OpenRouter para generar actividades del curso.")
    counts = [data.evaluation_count, data.practice_count, data.spaced_repetition_count, data.transfer_count]
    if sum(counts) == 0:
        raise HTTPException(status_code=422, detail="Elige al menos una actividad para generar.")
    materials = (await db.execute(select(Material).where(
        Material.course_id == course_id, Material.status == "ready", Material.chunk_count > 0,
    ).order_by(Material.created_at))).scalars().all()
    if not materials:
        raise HTTPException(status_code=409, detail="Procesa materiales del curso antes de generar actividades.")
    activities = []
    curriculum_links = (await db.execute(
        select(Skill, Topic, Unit)
        .join(Unit, Unit.id == Skill.unit_id)
        .join(Topic, Topic.unit_id == Unit.id)
        .where(Unit.course_id == course_id, Skill.status == "published", Topic.status == "published")
        .order_by(Unit.position, Skill.position, Topic.position)
    )).all()
    if not curriculum_links:
        raise HTTPException(status_code=409, detail="Publica al menos una habilidad y un tema antes de generar actividades.")
    curriculum_unit_ids = {unit.id for _, _, unit in curriculum_links}
    materials = [material for material in materials if material.unit_id is None or material.unit_id in curriculum_unit_ids]
    if not materials:
        raise HTTPException(status_code=409, detail="Vincula un material procesado con una unidad que tenga temas y habilidades publicados.")
    activity_kinds = (
        [("quiz", "assessment")] * data.evaluation_count
        + [("practice", "practice")] * data.practice_count
        + [("practice", "spaced_repetition")] * data.spaced_repetition_count
        + [("transfer", "transfer")] * data.transfer_count
    )
    try:
        for index, (kind, technique) in enumerate(activity_kinds):
            material = materials[index % len(materials)]
            chunks = (await db.execute(select(MaterialChunk).where(
                MaterialChunk.material_id == material.id,
            ).order_by(MaterialChunk.chunk_index))).scalars().all()
            matching_links = [row for row in curriculum_links if row[2].id == material.unit_id] if material.unit_id else curriculum_links
            skill, topic, unit = matching_links[index % len(matching_links)]
            assessment, questions = await create_practice_assessment(
                db, course=course, material=material, chunks=list(chunks), unit=unit,
                skill=skill, topic=topic,
                actor_id=teacher.id, question_count=data.question_count,
                question_types=data.question_types, focus="",
                kind=kind,
                technique=technique,
                commit=False,
            )
            activities.append({"id": assessment.id, "kind": assessment.kind,
                               "question_count": len(questions)})
    except AIProviderError as exc:
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"No se pudieron generar las actividades: {exc}") from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    await db.commit()
    return {"activities": activities}


@router.post("/courses/{course_id}/units/{unit_id}/generate-content", status_code=201)
async def generate_unit_curriculum(
    course_id: str, unit_id: str, data: UnitContentGenerationIn,
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    course = await owned_course(course_id, teacher, db)
    if course.status == "archived":
        raise HTTPException(status_code=409, detail="No se puede agregar contenido a un curso archivado.")
    unit = await db.scalar(select(Unit).where(Unit.id == unit_id, Unit.course_id == course_id))
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="Configura el proveedor de IA para generar contenido del curso.")
    rows = (await db.execute(
        select(Material, MaterialChunk)
        .join(MaterialChunk, MaterialChunk.material_id == Material.id)
        .where(Material.course_id == course_id, Material.status == "ready")
        .order_by(Material.created_at, MaterialChunk.chunk_index)
    )).all()
    if not rows:
        raise HTTPException(status_code=409, detail="Procesa materiales del curso antes de generar contenido.")

    sources = []
    source_map = {}
    total_chars = 0
    for material, chunk in rows:
        source_id = f"S{len(source_map) + 1}"
        block = (
            f"[{source_id}] MATERIAL: {material.name} | PÁGINA: "
            f"{chunk.page_number if chunk.page_number is not None else '—'}\n{chunk.content.strip()}"
        )
        if sources and total_chars + len(block) > 32000:
            break
        source_map[source_id] = (material, chunk)
        sources.append(block)
        total_chars += len(block) + 2
    try:
        payload = await generate_unit_content(
            course.description, "\n\n".join(sources), data.topic_count, data.skill_count,
        )
        generated = GeneratedUnitContent.model_validate(payload)
        if len(generated.topics) < data.topic_count or len(generated.skills) < data.skill_count:
            raise ValueError("The AI returned fewer curriculum items than requested")
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo generar el contenido de la unidad: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="La IA devolvió contenido incompleto o no válido para la unidad.") from exc

    items = []
    topic_offset = await db.scalar(select(func.count(Topic.id)).where(Topic.unit_id == unit.id)) or 0
    for entry in generated.topics[:data.topic_count]:
        refs = []
        for source_id in dict.fromkeys(entry.source_ids):
            source = source_map.get(source_id)
            if source is None:
                raise HTTPException(status_code=502, detail="La IA citó una fuente que no pertenece a estos materiales.")
            material, chunk = source
            refs.append({"material_id": material.id, "material_name": material.name,
                         "page_number": chunk.page_number, "chunk_index": chunk.chunk_index,
                         "excerpt": chunk.content.strip()[:320]})
        topic = Topic(unit_id=unit.id, title=entry.title.upper(), position=topic_offset + len(items),
            status="draft", source_refs=refs)
        db.add(topic)
        items.append({"type": "topic", "title": topic.title, "status": topic.status})
    skill_offset = await db.scalar(select(func.count(Skill.id)).where(Skill.unit_id == unit.id)) or 0
    for index, entry in enumerate(generated.skills[:data.skill_count]):
        refs = []
        for source_id in dict.fromkeys(entry.source_ids):
            source = source_map.get(source_id)
            if source is None:
                raise HTTPException(status_code=502, detail="La IA citó una fuente que no pertenece a estos materiales.")
            material, chunk = source
            refs.append({"material_id": material.id, "material_name": material.name,
                         "page_number": chunk.page_number, "chunk_index": chunk.chunk_index,
                         "excerpt": chunk.content.strip()[:320]})
        skill = Skill(unit_id=unit.id, title=entry.title.upper(), description=entry.description,
                      position=skill_offset + index, status="draft", source_refs=refs)
        db.add(skill)
        items.append({"type": "skill", "title": skill.title, "status": skill.status})
    if not items:
        raise HTTPException(status_code=502, detail="La IA no devolvió contenido para la unidad.")
    await db.flush()
    record_event(db, teacher.id, "unit.content.generated", "unit", unit.id, course_id,
                 {"topics": len(generated.topics[:data.topic_count]),
                  "skills": len(generated.skills[:data.skill_count])})
    await db.commit()
    return {"items": items}


@router.post("/courses/{course_id}/materials/{material_id}/generate-question", status_code=201)
async def generate_question_draft(
    course_id: str, material_id: str, teacher: User = Depends(require_teacher),
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


@router.post("/courses/{course_id}/assessments/generate-practice", status_code=201)
async def generate_practice_assessment_draft(
    course_id: str, data: PracticeGenerationIn,
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    course = await owned_course(course_id, teacher, db)
    if course.status == "archived":
        raise HTTPException(status_code=409, detail="Archived courses cannot receive assessments")
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="Configure an OpenAI-compatible provider to generate assessments")
    material = await db.scalar(select(Material).where(
        Material.id == data.material_id,
        Material.course_id == course_id,
        Material.status == "ready",
    ))
    if material is None:
        raise HTTPException(status_code=404, detail="Ready course material not found")
    chunks = (await db.execute(
        select(MaterialChunk).where(MaterialChunk.material_id == material.id)
        .order_by(MaterialChunk.chunk_index)
    )).scalars().all()
    if not chunks:
        raise HTTPException(status_code=409, detail="This material does not contain extracted text")

    unit = None
    unit_id = data.unit_id or material.unit_id
    if unit_id:
        unit = await db.get(Unit, unit_id)
        if unit is None or unit.course_id != course_id:
            raise HTTPException(status_code=422, detail="Unit does not belong to this course")
    else:
        units = (await db.execute(
            select(Unit).where(Unit.course_id == course_id).order_by(Unit.position)
        )).scalars().all()
        if len(units) == 1:
            unit = units[0]

    skill = await db.get(Skill, data.skill_id)
    topic = await db.get(Topic, data.topic_id)
    linked_unit = await db.get(Unit, skill.unit_id) if skill else None
    topic_unit = await db.get(Unit, topic.unit_id) if topic else None
    if (skill is None or topic is None or linked_unit is None or topic_unit is None
            or linked_unit.course_id != course_id or topic_unit.course_id != course_id
            or skill.unit_id != topic.unit_id
            or (unit is not None and skill.unit_id != unit.id)):
        raise HTTPException(status_code=422, detail="Elige un tema y una habilidad publicados de la misma unidad del curso.")
    if skill.status != "published" or topic.status != "published":
        raise HTTPException(status_code=409, detail="Publica el tema y la habilidad antes de generar la evaluación.")
    unit = linked_unit

    try:
        assessment, questions = await create_practice_assessment(
            db,
            course=course,
            material=material,
            chunks=list(chunks),
            unit=unit,
            skill=skill,
            topic=topic,
            actor_id=teacher.id,
            question_count=data.question_count,
            question_types=data.question_types,
            focus=data.focus,
            kind=data.kind,
        )
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "id": assessment.id,
        "title": assessment.title,
        "description": assessment.description,
        "kind": assessment.kind,
        "status": assessment.status,
        "settings": assessment.settings,
        "question_ids": [question.id for question in questions],
        "questions": [{
            "id": question.id,
            "prompt": question.prompt,
            "question_type": question.question_type,
            "options": question.options,
            "answer_key": question.answer_key,
            "rubric": question.rubric,
            "unit_id": question.unit_id,
            "skill_id": question.skill_id,
            "topic_id": question.topic_id,
            "bank_visible": question.bank_visible,
            "status": question.status,
            "source_refs": question.source_refs,
        } for question in questions],
    }


@router.patch("/questions/{question_id}/publish")
async def publish_question(
    question_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    await owned_course(question.course_id, teacher, db)
    if question.status == "published":
        return {"id": question.id, "status": question.status}
    if not question.bank_visible:
        raise HTTPException(status_code=409, detail="Esta pregunta se publica junto con su evaluación.")
    skill = await db.get(Skill, question.skill_id) if question.skill_id else None
    topic = await db.get(Topic, question.topic_id) if question.topic_id else None
    linked_unit = await db.get(Unit, skill.unit_id) if skill else None
    if (skill is None or topic is None or linked_unit is None or linked_unit.course_id != question.course_id
            or skill.unit_id != topic.unit_id
            or skill.status != "published" or topic.status != "published"):
        raise HTTPException(status_code=409, detail="Vincula la pregunta con una habilidad y un tema publicados antes de aprobarla.")
    if question.question_type == "open" and not question.rubric:
        raise HTTPException(status_code=422, detail="Add at least one review criterion before publishing")
    question.status = "published"
    record_event(db, teacher.id, "question.published", "question", question.id, question.course_id)
    await db.commit()
    return {"id": question.id, "status": question.status}
