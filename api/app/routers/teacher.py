from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_teacher
from app.config import settings
from app.db import get_db
from app.models import AuditEvent, Course, CourseMember, Material, Profile, Question, Submission
from app.routers.courses import owned_course
from app.schemas import QuestionCreate, SubmissionReview
from app.services.audit import record_event

router = APIRouter(tags=["teacher"])


@router.get("/teacher/dashboard")
async def dashboard(
    teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    courses = (await db.execute(select(Course).where(Course.owner_id == teacher.id)
                                .order_by(Course.updated_at.desc()))).scalars().all()
    course_ids = [course.id for course in courses]
    if course_ids:
        material_count = await db.scalar(select(func.count(Material.id)).where(Material.course_id.in_(course_ids))) or 0
        ready_count = await db.scalar(select(func.count(Material.id)).where(
            Material.course_id.in_(course_ids), Material.status == "ready")) or 0
        student_count = await db.scalar(select(func.count(CourseMember.id)).where(
            CourseMember.course_id.in_(course_ids), CourseMember.role == "student")) or 0
        pending_reviews = await db.scalar(select(func.count(Submission.id)).where(
            Submission.course_id.in_(course_ids), Submission.status == "pending")) or 0
        events = (await db.execute(select(AuditEvent).where(AuditEvent.actor_id == teacher.id)
                                   .order_by(AuditEvent.created_at.desc()).limit(8))).scalars().all()
    else:
        material_count = ready_count = student_count = pending_reviews = 0
        events = []
    return {
        "course_count": len(courses), "material_count": material_count, "ready_material_count": ready_count,
        "student_count": student_count, "pending_reviews": pending_reviews,
        "courses": [{"id": c.id, "title": c.title, "code": c.code, "status": c.status} for c in courses[:5]],
        "recent_activity": [{"id": e.id, "action": e.action, "entity_type": e.entity_type,
                             "created_at": e.created_at} for e in events],
    }


@router.get("/courses/{course_id}/students")
async def students(
    course_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    result = await db.execute(
        select(CourseMember, Profile).join(Profile, Profile.id == CourseMember.profile_id)
        .where(CourseMember.course_id == course_id, CourseMember.role == "student")
        .order_by(Profile.name)
    )
    members = result.all()
    return {"students": [{"id": member.id, "name": profile.name, "email": profile.email}
                          for member, profile in members]}


@router.get("/courses/{course_id}/reviews")
async def reviews(
    course_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(Submission, Profile).join(Profile, Profile.id == Submission.student_id)
                              .where(Submission.course_id == course_id)
                              .order_by(Submission.created_at.desc()))
    return [{"id": submission.id, "student_name": profile.name, "student_email": profile.email,
             "response": submission.response, "suggested_score": submission.suggested_score,
             "final_score": submission.final_score, "teacher_comment": submission.teacher_comment,
             "status": submission.status, "created_at": submission.created_at}
            for submission, profile in result.all()]


@router.post("/submissions/{submission_id}/review")
async def review_submission(
    submission_id: str, body: SubmissionReview, teacher: Profile = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    submission = await db.get(Submission, submission_id)
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    await owned_course(submission.course_id, teacher, db)
    submission.final_score = body.final_score
    submission.teacher_comment = body.teacher_comment
    submission.status = "reviewed"
    record_event(db, teacher.id, "submission.reviewed", "submission", submission.id, submission.course_id)
    await db.commit()
    return {"id": submission.id, "status": submission.status, "final_score": body.final_score,
            "teacher_comment": body.teacher_comment}


@router.get("/courses/{course_id}/questions")
async def questions(
    course_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(Question).where(Question.course_id == course_id)
                              .order_by(Question.created_at.desc()))
    return [{"id": q.id, "prompt": q.prompt, "unit_id": q.unit_id, "question_type": q.question_type,
             "rubric": q.rubric, "status": q.status, "created_at": q.created_at}
            for q in result.scalars().all()]


@router.post("/courses/{course_id}/questions", status_code=201)
async def create_question(
    course_id: str, data: QuestionCreate, teacher: Profile = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    question = Question(course_id=course_id, **data.model_dump())
    db.add(question)
    await db.flush()
    record_event(db, teacher.id, "question.created", "question", question.id, course_id)
    await db.commit()
    return {"id": question.id, **data.model_dump(), "status": question.status}


@router.get("/courses/{course_id}/activity")
async def activity(
    course_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(AuditEvent).where(AuditEvent.course_id == course_id)
                              .order_by(AuditEvent.created_at.desc()).limit(200))
    return [{"id": event.id, "action": event.action, "entity_type": event.entity_type,
             "entity_id": event.entity_id, "details": event.details, "created_at": event.created_at}
            for event in result.scalars().all()]


@router.get("/teacher/activity")
async def all_activity(
    teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    course_ids = select(Course.id).where(Course.owner_id == teacher.id)
    result = await db.execute(select(AuditEvent).where(AuditEvent.course_id.in_(course_ids))
                              .order_by(AuditEvent.created_at.desc()).limit(500))
    return [{"id": event.id, "action": event.action, "entity_type": event.entity_type,
             "entity_id": event.entity_id, "details": event.details, "created_at": event.created_at}
            for event in result.scalars().all()]


@router.get("/configuration")
async def configuration(teacher: Profile = Depends(require_teacher)) -> dict:
    return {"auth_configured": settings.auth_configured,
            "database_configured": settings.database_configured,
            "ai_configured": settings.ai_configured,
            "chat_model": settings.ai_chat_model if settings.ai_configured else None,
            "embedding_model": settings.ai_embedding_model if settings.ai_configured else None,
            "storage_configured": settings.storage_configured,
            "max_upload_mb": settings.max_upload_mb}
