from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import generate_practice_assessment
from app.config import settings
from app.models import (
    Assessment,
    AssessmentQuestion,
    Course,
    CourseSettings,
    Material,
    MaterialChunk,
    Question,
    Unit,
)
from app.schemas import GeneratedPracticeAssessment, QuestionCreate
from app.services.audit import record_event

MAX_CONTEXT_CHARS = 32000
EXCERPT_CHARS = 320


def practice_theme(material: Material) -> str:
    return Path(material.name).stem


def build_course_context(course: Course, unit: Unit | None) -> str:
    lines = [
        f"Título: {course.title}",
        f"Código: {course.code or '—'}",
        f"Periodo académico: {course.academic_period or '—'}",
        f"Créditos: {course.credits}",
        f"Descripción: {course.description or '—'}",
    ]
    if unit is not None:
        lines.append(f"Unidad: {unit.title}")
        if unit.outcome:
            lines.append(f"Resultado de aprendizaje: {unit.outcome}")
    return "\n".join(lines)


def build_sources(
    material: Material, chunks: list[MaterialChunk],
) -> tuple[dict[str, MaterialChunk], str]:
    source_map: dict[str, MaterialChunk] = {}
    blocks: list[str] = []
    used = 0
    for index, chunk in enumerate(chunks, start=1):
        source_id = f"S{index}"
        header = (
            f"[{source_id}] MATERIAL: {material.name} | "
            f"PÁGINA: {chunk.page_number if chunk.page_number is not None else '—'} | "
            f"FRAGMENTO: {chunk.chunk_index}"
        )
        block = f"{header}\n{chunk.content.strip()}"
        if blocks and used + len(block) > MAX_CONTEXT_CHARS:
            break
        source_map[source_id] = chunk
        blocks.append(block)
        used += len(block) + 2
    return source_map, "\n\n".join(blocks)


def build_source_refs(material: Material, chunks: list[MaterialChunk]) -> list[dict]:
    return [{
        "material_id": material.id,
        "material_name": material.name,
        "page_number": chunk.page_number,
        "chunk_index": chunk.chunk_index,
        "excerpt": chunk.content.strip()[:EXCERPT_CHARS],
    } for chunk in chunks]


async def create_practice_assessment(
    db: AsyncSession,
    *,
    course: Course,
    material: Material,
    chunks: list[MaterialChunk],
    unit: Unit | None,
    actor_id: str,
    question_count: int,
    question_types: list[str],
    focus: str,
) -> tuple[Assessment, list[Question]]:
    theme = practice_theme(material)
    source_map, sources = build_sources(material, chunks)
    if not source_map:
        raise ValueError("El material no contiene fragmentos de texto utilizables.")

    payload = await generate_practice_assessment(
        build_course_context(course, unit),
        theme,
        sources,
        question_count,
        question_types,
        focus,
    )
    try:
        generated = GeneratedPracticeAssessment.model_validate(payload)
    except ValidationError as exc:
        raise ValueError("La IA devolvió una evaluación incompleta o con formato inválido.") from exc

    prepared: list[tuple[QuestionCreate, list[dict]]] = []
    for item in generated.questions[:question_count]:
        if item.question_type not in question_types:
            raise ValueError("La IA generó un tipo de pregunta no solicitado.")
        cited = list(dict.fromkeys(item.source_ids))
        if not cited:
            raise ValueError("La IA generó una pregunta sin fuentes.")
        refs = []
        for source_id in cited:
            chunk = source_map.get(source_id)
            if chunk is None:
                raise ValueError(f"La IA citó una fuente desconocida ({source_id}).")
            refs.append(build_source_refs(material, [chunk])[0])
        try:
            data = QuestionCreate(
                prompt=item.prompt,
                unit_id=unit.id if unit is not None else None,
                skill_id=None,
                question_type=item.question_type,
                options=item.options,
                answer_key=item.answer_key,
                rubric=[{"criterion": criterion} for criterion in item.rubric],
            )
        except ValidationError as exc:
            raise ValueError("La IA devolvió una pregunta inválida.") from exc
        prepared.append((data, refs))

    if not prepared:
        raise ValueError("La IA no devolvió preguntas fundamentadas.")

    title = f"PRÁCTICA: {theme.upper()}"[:200]
    description = generated.description.strip() or f"Práctica de refuerzo sobre {theme}."
    instructions = generated.instructions.strip() or (
        "Responde cada pregunta con tus propias palabras. "
        "Las respuestas abiertas serán revisadas por el docente."
    )

    course_settings = await db.scalar(select(CourseSettings).where(
        CourseSettings.course_id == course.id,
    ))
    assessment_settings = {
        "practice": True,
        "theme": theme,
        "instructions": instructions,
        "question_count": len(prepared),
        "question_types": question_types,
        "grounded_only": True,
        "review_required": course_settings.human_review_required if course_settings else True,
        "attempts_before_solution": course_settings.attempts_before_solution if course_settings else 3,
        "generated": True,
        "generation": {
            "model": settings.ai_chat_model,
            "material_ids": [material.id],
            "material_name": material.name,
            "chunk_count": len(source_map),
            "focus": focus.strip(),
            "generated_at": datetime.now(UTC).isoformat(),
        },
    }

    assessment = Assessment(
        course_id=course.id,
        title=title,
        description=description,
        kind="practice",
        status="draft",
        settings=assessment_settings,
        created_by=actor_id,
    )
    db.add(assessment)
    await db.flush()

    questions: list[Question] = []
    for position, (data, refs) in enumerate(prepared):
        question = Question(
            course_id=course.id,
            unit_id=data.unit_id,
            prompt=data.prompt,
            question_type=data.question_type,
            options=data.options,
            answer_key=data.answer_key,
            skill_id=None,
            rubric=[criterion.model_dump() for criterion in data.rubric],
            status="draft",
            source_material_id=material.id,
            source_refs=refs,
        )
        db.add(question)
        await db.flush()
        db.add(AssessmentQuestion(
            assessment_id=assessment.id,
            question_id=question.id,
            position=position,
            points=1,
        ))
        questions.append(question)

    record_event(
        db,
        actor_id,
        "assessment.generated",
        "assessment",
        assessment.id,
        course.id,
        {
            "material_id": material.id,
            "question_count": len(questions),
            "model": settings.ai_chat_model,
            "chunk_count": len(source_map),
        },
    )
    await db.commit()
    return assessment, questions
