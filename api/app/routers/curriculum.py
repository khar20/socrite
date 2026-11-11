from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_teacher
from app.db import get_db
from app.models import Course, Skill, Topic, Unit, User
from app.routers.courses import owned_course
from app.schemas import SkillIn, SkillUpdate, TopicIn, TopicUpdate, UnitIn
from app.services.audit import record_event

router = APIRouter(tags=["curriculum"])


async def owned_unit(unit_id: str, teacher: User, db: AsyncSession) -> Unit:
    result = await db.execute(
        select(Unit).join(Course).where(Unit.id == unit_id, Course.owner_id == teacher.id)
    )
    unit = result.scalar_one_or_none()
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


async def owned_entry(model, entry_id: str, teacher: User, db: AsyncSession):
    result = await db.execute(
        select(model).join(Unit).join(Course).where(model.id == entry_id, Course.owner_id == teacher.id)
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Curriculum item not found")
    return entry


@router.get("/courses/{course_id}/curriculum")
async def get_curriculum(
    course_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(Unit).where(Unit.course_id == course_id).order_by(Unit.position, Unit.id))
    units = result.scalars().all()
    items = []
    for unit in units:
        topics = (await db.execute(select(Topic).where(Topic.unit_id == unit.id).order_by(Topic.position))).scalars().all()
        skills = (await db.execute(select(Skill).where(Skill.unit_id == unit.id).order_by(Skill.position))).scalars().all()
        items.append({"id": unit.id, "course_id": course_id, "title": unit.title,
                      "outcome": unit.outcome, "position": unit.position, "weeks": unit.weeks,
                      "hours": unit.hours,
                      "topics": [{"id": x.id, "title": x.title, "position": x.position} for x in topics],
                      "skills": [{"id": x.id, "title": x.title, "description": x.description,
                                  "position": x.position} for x in skills]})
    return items


@router.post("/courses/{course_id}/units", status_code=201)
async def create_unit(
    course_id: str, data: UnitIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    unit = Unit(course_id=course_id, **data.model_dump())
    db.add(unit)
    await db.flush()
    record_event(db, teacher.id, "unit.created", "unit", unit.id, course_id)
    await db.commit()
    await db.refresh(unit)
    return {"id": unit.id, "course_id": course_id, **data.model_dump(), "topics": [], "skills": []}


@router.patch("/units/{unit_id}")
async def update_unit(
    unit_id: str, data: UnitIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    unit = await owned_unit(unit_id, teacher, db)
    for key, value in data.model_dump().items():
        setattr(unit, key, value)
    record_event(db, teacher.id, "unit.updated", "unit", unit.id, unit.course_id)
    await db.commit()
    await db.refresh(unit)
    return {"id": unit.id, **data.model_dump()}


@router.delete("/units/{unit_id}", status_code=204)
async def delete_unit(
    unit_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Response:
    unit = await owned_unit(unit_id, teacher, db)
    record_event(db, teacher.id, "unit.deleted", "unit", unit.id, unit.course_id)
    await db.delete(unit)
    await db.commit()
    return Response(status_code=204)


@router.post("/units/{unit_id}/topics", status_code=201)
async def create_topic(
    unit_id: str, data: TopicIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    unit = await owned_unit(unit_id, teacher, db)
    topic = Topic(unit_id=unit_id, **data.model_dump())
    db.add(topic)
    await db.flush()
    record_event(db, teacher.id, "topic.created", "topic", topic.id, unit.course_id)
    await db.commit()
    return {"id": topic.id, "unit_id": unit_id, **data.model_dump()}


@router.post("/units/{unit_id}/skills", status_code=201)
async def create_skill(
    unit_id: str, data: SkillIn, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    unit = await owned_unit(unit_id, teacher, db)
    skill = Skill(unit_id=unit_id, **data.model_dump())
    db.add(skill)
    await db.flush()
    record_event(db, teacher.id, "skill.created", "skill", skill.id, unit.course_id)
    await db.commit()
    return {"id": skill.id, "unit_id": unit_id, **data.model_dump()}


@router.patch("/topics/{topic_id}")
async def update_topic(
    topic_id: str, data: TopicUpdate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    topic = await owned_entry(Topic, topic_id, teacher, db)
    for key, value in data.model_dump().items():
        setattr(topic, key, value)
    unit = await db.get(Unit, topic.unit_id)
    record_event(db, teacher.id, "topic.updated", "topic", topic.id, unit.course_id)
    await db.commit()
    return {"id": topic.id, "unit_id": topic.unit_id, **data.model_dump()}


@router.delete("/topics/{topic_id}", status_code=204)
async def delete_topic(
    topic_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Response:
    topic = await owned_entry(Topic, topic_id, teacher, db)
    unit = await db.get(Unit, topic.unit_id)
    record_event(db, teacher.id, "topic.deleted", "topic", topic.id, unit.course_id)
    await db.delete(topic)
    await db.commit()
    return Response(status_code=204)


@router.patch("/skills/{skill_id}")
async def update_skill(
    skill_id: str, data: SkillUpdate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    skill = await owned_entry(Skill, skill_id, teacher, db)
    for key, value in data.model_dump().items():
        setattr(skill, key, value)
    unit = await db.get(Unit, skill.unit_id)
    record_event(db, teacher.id, "skill.updated", "skill", skill.id, unit.course_id)
    await db.commit()
    return {"id": skill.id, "unit_id": skill.unit_id, **data.model_dump()}


@router.delete("/skills/{skill_id}", status_code=204)
async def delete_skill(
    skill_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Response:
    skill = await owned_entry(Skill, skill_id, teacher, db)
    unit = await db.get(Unit, skill.unit_id)
    record_event(db, teacher.id, "skill.deleted", "skill", skill.id, unit.course_id)
    await db.delete(skill)
    await db.commit()
    return Response(status_code=204)
