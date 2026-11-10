import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_teacher, role_for_email
from app.config import settings
from app.db import get_db
from app.models import (
    Assessment,
    AssessmentAttempt,
    AssessmentQuestion,
    AuditEvent,
    Course,
    CourseInvitation,
    CourseMember,
    Material,
    Profile,
    Question,
    QuestionAttempt,
    Skill,
    StudentSkillMastery,
    Submission,
    Unit,
)
from app.routers.courses import owned_course
from app.schemas import (
    AssessmentCreate,
    AssessmentQuestionIn,
    CourseInviteCreate,
    QuestionCreate,
    QuestionUpdate,
    SubmissionReview,
)
from app.services.audit import record_event
from app.services.pedagogy import record_skill_evidence

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
    mastery_by_student: dict[str, dict] = {}
    if members:
        student_ids = [profile.id for _, profile in members]
        mastery_rows = (await db.execute(
            select(StudentSkillMastery, Skill, Unit)
            .join(Skill, Skill.id == StudentSkillMastery.skill_id)
            .join(Unit, Unit.id == Skill.unit_id)
            .where(StudentSkillMastery.student_id.in_(student_ids), Unit.course_id == course_id)
            .order_by(Unit.position, Skill.position)
        )).all()
        for mastery, skill, unit in mastery_rows:
            summary = mastery_by_student.setdefault(mastery.student_id, {"sum": 0.0, "count": 0, "skills": []})
            summary["sum"] += mastery.probability
            summary["count"] += 1
            summary["skills"].append({"id": skill.id, "name": skill.title, "unit": unit.title,
                                      "probability": mastery.probability,
                                      "observations": mastery.observations})
    invites = (await db.execute(
        select(CourseInvitation).where(
            CourseInvitation.course_id == course_id,
            CourseInvitation.status == "pending",
            CourseInvitation.expires_at > datetime.now(UTC),
        ).order_by(CourseInvitation.created_at.desc())
    )).scalars().all()
    return {
        "students": [{
            "id": member.id, "name": profile.name, "email": profile.email,
            "mastery_average": (
                mastery_by_student[profile.id]["sum"] / mastery_by_student[profile.id]["count"]
                if profile.id in mastery_by_student else None
            ),
            "evidence_count": mastery_by_student.get(profile.id, {}).get("count", 0),
            "skills": mastery_by_student.get(profile.id, {}).get("skills", []),
        } for member, profile in members],
        "invitations": [{"id": invite.id, "email": invite.email, "expires_at": invite.expires_at}
                        for invite in invites],
    }


@router.post("/courses/{course_id}/invitations", status_code=201)
async def create_invitation(
    course_id: str, data: CourseInviteCreate, teacher: Profile = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    course = await owned_course(course_id, teacher, db)
    if course.status != "active":
        raise HTTPException(status_code=409, detail="Activate the course before inviting students")
    email = data.email.strip().casefold()
    if role_for_email(email) != "student":
        raise HTTPException(status_code=422, detail="A teacher account cannot be invited as a student")
    existing_profile = await db.scalar(select(Profile).where(Profile.email == email))
    if existing_profile and await db.scalar(select(CourseMember.id).where(
        CourseMember.course_id == course_id,
        CourseMember.profile_id == existing_profile.id,
        CourseMember.role == "student",
    )):
        raise HTTPException(status_code=409, detail="This student is already enrolled")
    existing_invitation = await db.scalar(
        select(CourseInvitation).where(
            CourseInvitation.course_id == course_id,
            CourseInvitation.email == email,
            CourseInvitation.status == "pending",
        ).with_for_update()
    )
    if existing_invitation:
        existing_invitation.status = "revoked"
    token = secrets.token_urlsafe(32)
    invitation = CourseInvitation(
        course_id=course_id,
        email=email,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        invited_by=teacher.id,
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(invitation)
    await db.flush()
    record_event(db, teacher.id, "student.invited", "invitation", invitation.id, course_id)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="An invitation for this email is already pending") from exc
    return {"id": invitation.id, "email": email, "token": token, "expires_at": invitation.expires_at}


@router.delete("/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    invitation_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Response:
    result = await db.execute(select(CourseInvitation).join(Course).where(
        CourseInvitation.id == invitation_id, Course.owner_id == teacher.id,
    ))
    invitation = result.scalar_one_or_none()
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.status == "pending":
        invitation.status = "revoked"
        record_event(db, teacher.id, "student.invitation.revoked", "invitation", invitation.id,
                     invitation.course_id)
        await db.commit()
    return Response(status_code=204)


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
    if submission.status == "reviewed":
        return {"id": submission.id, "status": submission.status,
                "final_score": submission.final_score, "teacher_comment": submission.teacher_comment}
    submission.final_score = body.final_score
    submission.teacher_comment = body.teacher_comment
    submission.status = "reviewed"
    if submission.question_attempt_id:
        answer = await db.get(QuestionAttempt, submission.question_attempt_id)
        if answer:
            answer.final_score = body.final_score / 20
            question = await db.get(Question, answer.question_id)
            if question and question.skill_id:
                await record_skill_evidence(db, submission.student_id, question.skill_id,
                                            body.final_score >= 12)
            assessment_attempt = await db.get(AssessmentAttempt, answer.assessment_attempt_id)
            if assessment_attempt:
                answers = (await db.execute(select(QuestionAttempt).where(
                    QuestionAttempt.assessment_attempt_id == assessment_attempt.id,
                ))).scalars().all()
                if answers and all(item.final_score is not None for item in answers):
                    assessment_attempt.status = "reviewed"
                    weights = (await db.execute(select(AssessmentQuestion.question_id,
                                                      AssessmentQuestion.points).where(
                        AssessmentQuestion.assessment_id == assessment_attempt.assessment_id,
                    ))).all()
                    point_map = dict(weights)
                    assessment_attempt.score = sum(
                        (item.final_score or 0) * point_map.get(item.question_id, 0) for item in answers
                    )
    record_event(db, teacher.id, "submission.reviewed", "submission", submission.id, submission.course_id)
    await db.commit()
    return {"id": submission.id, "status": submission.status, "final_score": body.final_score,
            "teacher_comment": body.teacher_comment}


@router.get("/courses/{course_id}/assessments")
async def list_assessments(
    course_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    assessments = (await db.execute(select(Assessment).where(Assessment.course_id == course_id)
                                   .order_by(Assessment.created_at.desc()))).scalars().all()
    result = []
    for assessment in assessments:
        items = (await db.execute(select(AssessmentQuestion).where(
            AssessmentQuestion.assessment_id == assessment.id).order_by(AssessmentQuestion.position))).scalars().all()
        result.append({"id": assessment.id, "title": assessment.title, "description": assessment.description,
                       "kind": assessment.kind, "status": assessment.status,
                       "question_ids": [item.question_id for item in items],
                       "created_at": assessment.created_at})
    return result


@router.post("/courses/{course_id}/assessments", status_code=201)
async def create_assessment(
    course_id: str, data: AssessmentCreate, teacher: Profile = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    course = await owned_course(course_id, teacher, db)
    if course.status == "archived":
        raise HTTPException(status_code=409, detail="Archived courses cannot receive assessments")
    assessment = Assessment(course_id=course_id, created_by=teacher.id, **data.model_dump())
    db.add(assessment)
    await db.flush()
    record_event(db, teacher.id, "assessment.created", "assessment", assessment.id, course_id)
    await db.commit()
    return {"id": assessment.id, **data.model_dump(), "status": assessment.status, "question_ids": []}


@router.put("/assessments/{assessment_id}/questions/{question_id}")
async def assign_assessment_question(
    assessment_id: str, question_id: str, data: AssessmentQuestionIn,
    teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    assessment = await db.get(Assessment, assessment_id)
    question = await db.get(Question, question_id)
    if assessment is None or question is None:
        raise HTTPException(status_code=404, detail="Assessment or question not found")
    await owned_course(assessment.course_id, teacher, db)
    if assessment.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft assessments can be edited")
    if question.course_id != assessment.course_id or question.status != "published":
        raise HTTPException(status_code=422, detail="Choose a published question from this course")
    item = await db.scalar(select(AssessmentQuestion).where(
        AssessmentQuestion.assessment_id == assessment_id,
        AssessmentQuestion.question_id == question_id,
    ))
    if item is None:
        item = AssessmentQuestion(assessment_id=assessment_id, question_id=question_id, **data.model_dump())
        db.add(item)
    else:
        for key, value in data.model_dump().items():
            setattr(item, key, value)
    record_event(db, teacher.id, "assessment.question.assigned", "assessment", assessment.id,
                 assessment.course_id, {"question_id": question_id})
    await db.commit()
    return {"assessment_id": assessment_id, "question_id": question_id, **data.model_dump()}


@router.delete("/assessments/{assessment_id}/questions/{question_id}", status_code=204)
async def remove_assessment_question(
    assessment_id: str, question_id: str, teacher: Profile = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> Response:
    assessment = await db.get(Assessment, assessment_id)
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    await owned_course(assessment.course_id, teacher, db)
    if assessment.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft assessments can be edited")
    item = await db.scalar(select(AssessmentQuestion).where(
        AssessmentQuestion.assessment_id == assessment_id,
        AssessmentQuestion.question_id == question_id,
    ))
    if item is not None:
        await db.delete(item)
        record_event(db, teacher.id, "assessment.question.removed", "assessment", assessment.id,
                     assessment.course_id, {"question_id": question_id})
        await db.commit()
    return Response(status_code=204)


@router.patch("/assessments/{assessment_id}/publish")
async def publish_assessment(
    assessment_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    assessment = await db.get(Assessment, assessment_id)
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    course = await owned_course(assessment.course_id, teacher, db)
    if course.status == "archived":
        raise HTTPException(status_code=409, detail="Archived courses cannot publish assessments")
    if assessment.status == "published":
        return {"id": assessment.id, "status": assessment.status}
    count = await db.scalar(select(func.count(AssessmentQuestion.id)).where(
        AssessmentQuestion.assessment_id == assessment.id,
    )) or 0
    if not count:
        raise HTTPException(status_code=409, detail="Add at least one question before publishing")
    assessment.status = "published"
    assessment.published_at = datetime.now(UTC)
    record_event(db, teacher.id, "assessment.published", "assessment", assessment.id,
                 assessment.course_id)
    await db.commit()
    return {"id": assessment.id, "status": assessment.status}


@router.get("/courses/{course_id}/questions")
async def questions(
    course_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(Question).where(Question.course_id == course_id)
                              .order_by(Question.created_at.desc()))
    return [{"id": q.id, "prompt": q.prompt, "unit_id": q.unit_id, "question_type": q.question_type,
             "skill_id": q.skill_id, "options": q.options, "answer_key": q.answer_key,
             "rubric": q.rubric, "status": q.status, "created_at": q.created_at}
            for q in result.scalars().all()]


@router.post("/courses/{course_id}/questions", status_code=201)
async def create_question(
    course_id: str, data: QuestionCreate, teacher: Profile = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    if data.unit_id:
        unit = await db.get(Unit, data.unit_id)
        if unit is None or unit.course_id != course_id:
            raise HTTPException(status_code=422, detail="Unit does not belong to this course")
    if data.skill_id:
        skill = await db.get(Skill, data.skill_id)
        if skill is None:
            raise HTTPException(status_code=422, detail="Skill not found")
        unit = await db.get(Unit, skill.unit_id)
        if unit is None or unit.course_id != course_id or (data.unit_id and skill.unit_id != data.unit_id):
            raise HTTPException(status_code=422, detail="Skill does not belong to this course unit")
    question = Question(course_id=course_id, **data.model_dump())
    db.add(question)
    await db.flush()
    record_event(db, teacher.id, "question.created", "question", question.id, course_id)
    await db.commit()
    return {"id": question.id, **data.model_dump(), "status": question.status}


@router.patch("/questions/{question_id}")
async def update_question(
    question_id: str, data: QuestionUpdate, teacher: Profile = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    await owned_course(question.course_id, teacher, db)
    if question.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft questions can be edited")
    if data.unit_id:
        unit = await db.get(Unit, data.unit_id)
        if unit is None or unit.course_id != question.course_id:
            raise HTTPException(status_code=422, detail="Unit does not belong to this course")
    if data.skill_id:
        skill = await db.get(Skill, data.skill_id)
        if skill is None:
            raise HTTPException(status_code=422, detail="Skill not found")
        unit = await db.get(Unit, skill.unit_id)
        if unit is None or unit.course_id != question.course_id or (data.unit_id and skill.unit_id != data.unit_id):
            raise HTTPException(status_code=422, detail="Skill does not belong to this course unit")
    for key, value in data.model_dump().items():
        setattr(question, key, value)
    record_event(db, teacher.id, "question.updated", "question", question.id, question.course_id)
    await db.commit()
    return {"id": question.id, **data.model_dump(), "status": question.status}


@router.delete("/questions/{question_id}", status_code=204)
async def delete_question(
    question_id: str, teacher: Profile = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Response:
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    await owned_course(question.course_id, teacher, db)
    if question.status != "draft":
        raise HTTPException(status_code=409, detail="Published questions cannot be deleted")
    submissions = await db.scalar(select(func.count(Submission.id)).where(Submission.question_id == question.id)) or 0
    if submissions:
        raise HTTPException(status_code=409, detail="Questions used in submissions cannot be deleted")
    record_event(db, teacher.id, "question.deleted", "question", question.id, question.course_id)
    await db.delete(question)
    await db.commit()
    return Response(status_code=204)


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
            "migration_database_configured": settings.migration_database_configured,
            "ai_configured": settings.ai_configured,
            "ai_provider": settings.ai_provider_name or None,
            "chat_model": settings.ai_chat_model if settings.ai_configured else None,
            "embedding_model": settings.ai_embedding_model if settings.ai_configured else None,
            "storage_configured": settings.storage_configured,
            "max_upload_mb": settings.max_upload_mb}
