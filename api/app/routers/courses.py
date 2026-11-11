from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_teacher
from app.db import get_db
from app.models import Course, CourseMember, CourseSettings, Material, Submission, Unit, User
from app.schemas import CourseCreate, CourseOut, CourseSettingsIn, CourseSettingsOut, CourseUpdate
from app.services.audit import record_event

router = APIRouter(tags=["courses"])


async def owned_course(course_id: str, teacher: User, db: AsyncSession) -> Course:
    result = await db.execute(select(Course).where(Course.id == course_id, Course.owner_id == teacher.id))
    course = result.scalar_one_or_none()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.get("/courses")
async def list_courses(
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(select(Course).where(Course.owner_id == teacher.id).order_by(Course.updated_at.desc()))
    courses = result.scalars().all()
    course_ids = [course.id for course in courses]
    if not course_ids:
        return []
    unit_counts = dict((await db.execute(
        select(Unit.course_id, func.count(Unit.id)).where(Unit.course_id.in_(course_ids))
        .group_by(Unit.course_id)
    )).all())
    material_counts = dict((await db.execute(
        select(Material.course_id, func.count(Material.id)).where(Material.course_id.in_(course_ids))
        .group_by(Material.course_id)
    )).all())
    student_counts = dict((await db.execute(
        select(CourseMember.course_id, func.count(CourseMember.id)).where(
            CourseMember.course_id.in_(course_ids), CourseMember.role == "student",
        ).group_by(CourseMember.course_id)
    )).all())
    items = []
    for course in courses:
        items.append({**CourseOut.model_validate(course).model_dump(), "unit_count": unit_counts.get(course.id, 0),
                      "material_count": material_counts.get(course.id, 0),
                      "student_count": student_counts.get(course.id, 0)})
    return items


@router.post("/courses", response_model=CourseOut, status_code=201)
async def create_course(
    data: CourseCreate, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Course:
    course = Course(owner_id=teacher.id, **data.model_dump())
    db.add(course)
    await db.flush()
    db.add(CourseSettings(course_id=course.id))
    record_event(db, teacher.id, "course.created", "course", course.id, course.id)
    await db.commit()
    await db.refresh(course)
    return course


@router.get("/courses/{course_id}")
async def get_course(
    course_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    course = await owned_course(course_id, teacher, db)
    units = await db.scalar(select(func.count(Unit.id)).where(Unit.course_id == course.id)) or 0
    materials = await db.scalar(select(func.count(Material.id)).where(Material.course_id == course.id)) or 0
    students = await db.scalar(select(func.count(CourseMember.id)).where(
        CourseMember.course_id == course.id, CourseMember.role == "student")) or 0
    pending = await db.scalar(select(func.count(Submission.id)).where(
        Submission.course_id == course.id, Submission.status == "pending")) or 0
    return {**CourseOut.model_validate(course).model_dump(), "unit_count": units,
            "material_count": materials, "student_count": students, "pending_reviews": pending}


@router.patch("/courses/{course_id}", response_model=CourseOut)
async def update_course(
    course_id: str, data: CourseUpdate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> Course:
    course = await owned_course(course_id, teacher, db)
    for key, value in data.model_dump().items():
        setattr(course, key, value)
    record_event(db, teacher.id, "course.updated", "course", course.id, course.id)
    await db.commit()
    await db.refresh(course)
    return course


@router.get("/courses/{course_id}/settings", response_model=CourseSettingsOut)
async def get_settings(
    course_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> CourseSettingsOut:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(CourseSettings).where(CourseSettings.course_id == course_id))
    settings = result.scalar_one_or_none()
    if settings is None:
        return CourseSettingsOut(course_id=course_id)
    return CourseSettingsOut.model_validate(settings)


@router.put("/courses/{course_id}/settings", response_model=CourseSettingsOut)
async def update_settings(
    course_id: str, data: CourseSettingsIn, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> CourseSettings:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(CourseSettings).where(CourseSettings.course_id == course_id))
    row = result.scalar_one_or_none()
    if row is None:
        row = CourseSettings(course_id=course_id)
        db.add(row)
    for key, value in data.model_dump().items():
        setattr(row, key, value)
    record_event(db, teacher.id, "course.settings.updated", "course", course_id, course_id)
    await db.commit()
    await db.refresh(row)
    return row
