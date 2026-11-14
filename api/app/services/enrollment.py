from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Course, CourseMember, StudentAllowlist, User
from app.services.audit import record_event


async def mvp_course(db: AsyncSession, *, required: bool = True) -> Course | None:
    courses = (await db.execute(
        select(Course).where(Course.status != "archived")
        .order_by(Course.created_at, Course.id).with_for_update()
    )).scalars().all()
    if len(courses) > 1:
        raise HTTPException(status_code=409, detail="La inscripción automática requiere un único curso disponible.")
    if not courses and required:
        raise HTTPException(status_code=409, detail="El curso aún no está disponible para la inscripción.")
    return courses[0] if courses else None


async def enroll_student(
    db: AsyncSession, course: Course, student: User, *, actor_id: str | None = None,
) -> bool:
    membership = await db.scalar(select(CourseMember.id).where(
        CourseMember.course_id == course.id,
        CourseMember.profile_id == student.id,
        CourseMember.role == "student",
    ))
    if membership:
        return False
    db.add(CourseMember(course_id=course.id, profile_id=student.id, role="student"))
    record_event(db, actor_id or student.id, "student.enrolled", "course", course.id, course.id,
                 {"student_id": student.id})
    return True


async def enroll_authorized_students(
    db: AsyncSession, course: Course, *, actor_id: str,
) -> int:
    available_courses = (await db.execute(
        select(Course.id).where(Course.status != "archived")
    )).scalars().all()
    if len(available_courses) != 1 or available_courses[0] != course.id:
        return 0

    students = (await db.execute(
        select(User).join(StudentAllowlist, StudentAllowlist.email == User.email)
        .where(User.role == "student", User.is_active.is_(True))
        .order_by(User.created_at, User.id)
    )).scalars().all()
    enrolled = 0
    for student in students:
        enrolled += await enroll_student(db, course, student, actor_id=actor_id)
    return enrolled
