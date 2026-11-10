import hashlib
import math
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import AIProviderError, embed_texts, generate_tutor_reply
from app.auth import require_student
from app.config import settings
from app.db import get_db
from app.models import (
    Assessment,
    AssessmentAttempt,
    AssessmentQuestion,
    Course,
    CourseInvitation,
    CourseMember,
    LearningReflection,
    Material,
    MaterialChunk,
    Profile,
    Question,
    QuestionAttempt,
    ReviewSchedule,
    Skill,
    StudentSkillMastery,
    Submission,
    Topic,
    TutorMessage,
    TutorSession,
    Unit,
)
from app.schemas import ReflectionCreate, ReviewRatingIn, StudentAnswerIn, TutorMessageCreate
from app.services.audit import record_event
from app.services.pedagogy import record_skill_evidence, review_interval
from app.storage import storage_client

router = APIRouter(prefix="/student", tags=["student"])


async def enrolled_course(course_id: str, student: Profile, db: AsyncSession) -> Course:
    result = await db.execute(
        select(Course).join(CourseMember).where(
            Course.id == course_id,
            CourseMember.profile_id == student.id,
            CourseMember.role == "student",
        )
    )
    course = result.scalar_one_or_none()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


async def owned_attempt(attempt_id: str, student: Profile, db: AsyncSession) -> AssessmentAttempt:
    attempt = await db.scalar(select(AssessmentAttempt).where(
        AssessmentAttempt.id == attempt_id, AssessmentAttempt.student_id == student.id,
    ).with_for_update())
    if attempt is None:
        raise HTTPException(status_code=404, detail="Assessment attempt not found")
    return attempt


@router.get("/courses")
async def list_courses(
    student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    courses = (await db.execute(
        select(Course).join(CourseMember).where(
            CourseMember.profile_id == student.id, CourseMember.role == "student",
        ).order_by(Course.updated_at.desc())
    )).scalars().all()
    course_ids = [course.id for course in courses]
    if not course_ids:
        return []
    unit_counts = dict((await db.execute(
        select(Unit.course_id, func.count(Unit.id)).where(Unit.course_id.in_(course_ids))
        .group_by(Unit.course_id)
    )).all())
    material_counts = dict((await db.execute(
        select(Material.course_id, func.count(Material.id)).where(
            Material.course_id.in_(course_ids), Material.status == "ready",
        ).group_by(Material.course_id)
    )).all())
    result = []
    for course in courses:
        result.append({"id": course.id, "title": course.title, "code": course.code,
                       "description": course.description, "status": course.status,
                       "credits": course.credits, "academic_period": course.academic_period,
                       "created_at": course.created_at, "unit_count": unit_counts.get(course.id, 0),
                       "material_count": material_counts.get(course.id, 0)})
    return result


@router.post("/invitations/{token}/accept")
async def accept_invitation(
    token: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    if len(token) > 128:
        raise HTTPException(status_code=404, detail="Invitation not found")
    digest = hashlib.sha256(token.encode()).hexdigest()
    invitation = await db.scalar(select(CourseInvitation).where(
        CourseInvitation.token_hash == digest,
    ).with_for_update())
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found or already used")
    if invitation.status == "accepted" and invitation.accepted_by == student.id:
        return {"course_id": invitation.course_id}
    if invitation.status != "pending":
        raise HTTPException(status_code=404, detail="Invitation not found or already used")
    if invitation.expires_at <= datetime.now(UTC):
        invitation.status = "expired"
        await db.commit()
        raise HTTPException(status_code=410, detail="Invitation has expired")
    if invitation.email.casefold() != student.email.casefold():
        raise HTTPException(status_code=403, detail="Sign in with the invited email address")
    course = await db.get(Course, invitation.course_id)
    if course is None or course.status != "active":
        raise HTTPException(status_code=409, detail="The course is not accepting students yet")
    membership = await db.scalar(select(CourseMember).where(
        CourseMember.course_id == invitation.course_id,
        CourseMember.profile_id == student.id,
    ))
    if membership is None:
        db.add(CourseMember(course_id=invitation.course_id, profile_id=student.id, role="student"))
    invitation.status = "accepted"
    invitation.accepted_by = student.id
    invitation.accepted_at = datetime.now(UTC)
    record_event(db, student.id, "student.enrolled", "course", invitation.course_id, invitation.course_id)
    await db.commit()
    return {"course_id": invitation.course_id}


@router.get("/courses/{course_id}")
async def get_course(
    course_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    course = await enrolled_course(course_id, student, db)
    unit_count = await db.scalar(select(func.count(Unit.id)).where(Unit.course_id == course.id)) or 0
    material_count = await db.scalar(select(func.count(Material.id)).where(
        Material.course_id == course.id, Material.status == "ready")) or 0
    return {"id": course.id, "title": course.title, "code": course.code,
            "description": course.description, "status": course.status,
            "credits": course.credits, "academic_period": course.academic_period,
            "created_at": course.created_at, "unit_count": unit_count,
            "material_count": material_count}


@router.get("/courses/{course_id}/curriculum")
async def get_curriculum(
    course_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await enrolled_course(course_id, student, db)
    units = (await db.execute(select(Unit).where(Unit.course_id == course_id).order_by(Unit.position))).scalars().all()
    if not units:
        return []
    unit_ids = [unit.id for unit in units]
    topics = (await db.execute(select(Topic).where(Topic.unit_id.in_(unit_ids)).order_by(Topic.position))).scalars().all()
    skills = (await db.execute(select(Skill).where(Skill.unit_id.in_(unit_ids)).order_by(Skill.position))).scalars().all()
    topics_by_unit: dict[str, list[Topic]] = {}
    skills_by_unit: dict[str, list[Skill]] = {}
    for topic in topics:
        topics_by_unit.setdefault(topic.unit_id, []).append(topic)
    for skill in skills:
        skills_by_unit.setdefault(skill.unit_id, []).append(skill)
    return [{
        "id": unit.id, "course_id": course_id, "title": unit.title, "outcome": unit.outcome,
        "position": unit.position, "weeks": unit.weeks, "hours": unit.hours,
        "topics": [{"id": topic.id, "title": topic.title, "position": topic.position}
                   for topic in topics_by_unit.get(unit.id, [])],
        "skills": [{"id": skill.id, "title": skill.title, "description": skill.description,
                    "position": skill.position} for skill in skills_by_unit.get(unit.id, [])],
    } for unit in units]


@router.get("/courses/{course_id}/materials")
async def list_materials(
    course_id: str, folder_id: str | None = None, search: str = "",
    student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await enrolled_course(course_id, student, db)
    query = select(Material).where(Material.course_id == course_id, Material.status == "ready")
    if folder_id:
        query = query.where(Material.folder_id == folder_id)
    if search.strip():
        query = query.where(Material.name.ilike(f"%{search.strip()[:160]}%"))
    materials = (await db.execute(query.order_by(Material.created_at.desc()))).scalars().all()
    return [{"id": material.id, "name": material.name, "kind": material.kind,
             "content_type": material.content_type, "size_bytes": material.size_bytes,
             "folder_id": material.folder_id, "unit_id": material.unit_id,
             "chunk_count": material.chunk_count} for material in materials]


@router.get("/materials/{material_id}/download-url")
async def download_material(
    material_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    material = await db.scalar(select(Material).join(CourseMember).where(
        Material.id == material_id,
        Material.status == "ready",
        CourseMember.course_id == Material.course_id,
        CourseMember.profile_id == student.id,
        CourseMember.role == "student",
    ))
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")
    if material.url:
        return {"url": material.url}
    if not material.object_key:
        raise HTTPException(status_code=404, detail="Material file is not available")
    client = storage_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Neon Object Storage is not configured")
    disposition = "inline" if material.content_type == "application/pdf" else "attachment"
    safe_name = material.name.replace('"', "").replace("\r", "_").replace("\n", "_")
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.neon_storage_bucket, "Key": material.object_key,
                "ResponseContentDisposition": f'{disposition}; filename="{safe_name}"'},
        ExpiresIn=300,
    )
    return {"url": url}


@router.get("/courses/{course_id}/assessments")
async def list_assessments(
    course_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await enrolled_course(course_id, student, db)
    assessments = (await db.execute(select(Assessment).where(
        Assessment.course_id == course_id, Assessment.status == "published",
    ).order_by(Assessment.published_at.desc()))).scalars().all()
    result = []
    for assessment in assessments:
        count = await db.scalar(select(func.count(AssessmentQuestion.id)).where(
            AssessmentQuestion.assessment_id == assessment.id)) or 0
        result.append({"id": assessment.id, "title": assessment.title,
                       "description": assessment.description, "kind": assessment.kind,
                       "question_count": count})
    return result


@router.get("/courses/{course_id}/submissions")
async def list_submissions(
    course_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await enrolled_course(course_id, student, db)
    result = await db.execute(
        select(Submission, Question).outerjoin(Question, Question.id == Submission.question_id)
        .where(Submission.course_id == course_id, Submission.student_id == student.id)
        .order_by(Submission.created_at.desc())
    )
    return [{"id": submission.id, "question": question.prompt if question else "Open response",
             "response": submission.response, "suggested_score": submission.suggested_score,
             "final_score": submission.final_score, "teacher_comment": submission.teacher_comment,
             "status": submission.status, "created_at": submission.created_at}
            for submission, question in result.all()]


@router.post("/assessments/{assessment_id}/attempts", status_code=201)
async def start_assessment(
    assessment_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    assessment = await db.scalar(select(Assessment).where(
        Assessment.id == assessment_id, Assessment.status == "published",
    ).with_for_update())
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    course = await enrolled_course(assessment.course_id, student, db)
    if course.status != "active":
        raise HTTPException(status_code=409, detail="This course is not accepting assessment attempts")
    active = await db.scalar(select(AssessmentAttempt).where(
        AssessmentAttempt.assessment_id == assessment.id,
        AssessmentAttempt.student_id == student.id,
        AssessmentAttempt.status == "in_progress",
    ).order_by(AssessmentAttempt.attempt_number.desc()))
    if active:
        return await assessment_attempt_payload(active, db)
    last_number = await db.scalar(select(func.max(AssessmentAttempt.attempt_number)).where(
        AssessmentAttempt.assessment_id == assessment.id,
        AssessmentAttempt.student_id == student.id,
    )) or 0
    attempt = AssessmentAttempt(assessment_id=assessment.id, course_id=assessment.course_id,
                                student_id=student.id, attempt_number=last_number + 1)
    db.add(attempt)
    record_event(db, student.id, "assessment.started", "assessment", assessment.id, assessment.course_id)
    await db.commit()
    await db.refresh(attempt)
    return await assessment_attempt_payload(attempt, db)


@router.get("/attempts/{attempt_id}")
async def get_attempt(
    attempt_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    attempt = await owned_attempt(attempt_id, student, db)
    return await assessment_attempt_payload(attempt, db)


async def assessment_attempt_payload(attempt: AssessmentAttempt, db: AsyncSession) -> dict:
    items = (await db.execute(
        select(AssessmentQuestion, Question)
        .join(Question, Question.id == AssessmentQuestion.question_id)
        .where(AssessmentQuestion.assessment_id == attempt.assessment_id)
        .order_by(AssessmentQuestion.position)
    )).all()
    answered = (await db.execute(select(QuestionAttempt).where(
        QuestionAttempt.assessment_attempt_id == attempt.id,
    ))).scalars().all()
    answer_map = {response.question_id: response for response in answered}
    return {
        "id": attempt.id, "assessment_id": attempt.assessment_id,
        "status": attempt.status, "attempt_number": attempt.attempt_number,
        "questions": [{
            "id": question.id, "prompt": question.prompt, "question_type": question.question_type,
            "options": question.options, "points": item.points,
            "response": answer_map[question.id].response if question.id in answer_map else None,
            "is_correct": answer_map[question.id].is_correct if question.id in answer_map else None,
            "pending_review": question.question_type == "open" and question.id in answer_map,
        } for item, question in items],
    }


@router.post("/attempts/{attempt_id}/questions/{question_id}")
async def answer_question(
    attempt_id: str, question_id: str, data: StudentAnswerIn,
    student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    attempt = await owned_attempt(attempt_id, student, db)
    if attempt.status != "in_progress":
        raise HTTPException(status_code=409, detail="This attempt is already submitted")
    result = await db.execute(
        select(AssessmentQuestion, Question)
        .join(Question, Question.id == AssessmentQuestion.question_id)
        .where(AssessmentQuestion.assessment_id == attempt.assessment_id, Question.id == question_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Question is not part of this assessment")
    assessment_question, question = row
    existing = await db.scalar(select(QuestionAttempt.id).where(
        QuestionAttempt.assessment_attempt_id == attempt.id,
        QuestionAttempt.question_id == question.id,
    ))
    if existing:
        saved = await db.get(QuestionAttempt, existing)
        return {"question_id": question.id, "is_correct": saved.is_correct,
                "pending_review": question.question_type == "open",
                "suggested_score": saved.suggested_score}

    response_value = data.response
    is_correct: bool | None = None
    suggested_score: float | None = None
    if question.question_type == "multiple_choice":
        if not isinstance(response_value, int) or isinstance(response_value, bool):
            raise HTTPException(status_code=422, detail="Choose one of the available options")
        if not question.options or not 0 <= response_value < len(question.options):
            raise HTTPException(status_code=422, detail="Selected option is invalid")
        is_correct = response_value == question.answer_key
        suggested_score = assessment_question.points if is_correct else 0
    elif question.question_type == "numeric":
        if not isinstance(response_value, (int, float)) or isinstance(response_value, bool):
            raise HTTPException(status_code=422, detail="Enter a numeric answer")
        expected = float(question.answer_key)
        is_correct = math.isclose(float(response_value), expected, rel_tol=1e-5, abs_tol=1e-5)
        suggested_score = assessment_question.points if is_correct else 0
    elif not isinstance(response_value, str) or not response_value.strip():
        raise HTTPException(status_code=422, detail="Write a response before submitting")

    answer = QuestionAttempt(
        assessment_attempt_id=attempt.id, question_id=question.id,
        response=response_value, is_correct=is_correct, confidence=data.confidence,
        suggested_score=suggested_score,
        final_score=None if question.question_type == "open" else suggested_score,
    )
    db.add(answer)
    await db.flush()
    if question.question_type == "open":
        db.add(Submission(
            course_id=attempt.course_id, student_id=student.id, question_id=question.id,
            question_attempt_id=answer.id, response=response_value, status="pending",
        ))
    elif is_correct is not None and question.skill_id:
        await record_skill_evidence(db, student.id, question.skill_id, is_correct)
    await db.commit()
    return {"question_id": question.id, "is_correct": is_correct,
            "pending_review": question.question_type == "open", "suggested_score": suggested_score}


@router.post("/attempts/{attempt_id}/submit")
async def submit_assessment(
    attempt_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    attempt = await owned_attempt(attempt_id, student, db)
    if attempt.status != "in_progress":
        return {"id": attempt.id, "status": attempt.status, "score": attempt.score,
                "possible_score": attempt.possible_score}
    items = (await db.execute(select(AssessmentQuestion).where(
        AssessmentQuestion.assessment_id == attempt.assessment_id))).scalars().all()
    responses = (await db.execute(select(QuestionAttempt).where(
        QuestionAttempt.assessment_attempt_id == attempt.id))).scalars().all()
    if len(responses) != len(items):
        raise HTTPException(status_code=409, detail="Answer every question before submitting")
    scores = {response.question_id: response.final_score for response in responses}
    attempt.score = sum((scores[item.question_id] or 0) for item in items)
    attempt.possible_score = sum(item.points for item in items)
    attempt.status = "submitted"
    attempt.submitted_at = datetime.now(UTC)
    record_event(db, student.id, "assessment.submitted", "assessment_attempt", attempt.id,
                 attempt.course_id)
    await db.commit()
    return {"id": attempt.id, "status": attempt.status, "score": attempt.score,
            "possible_score": attempt.possible_score}


@router.get("/courses/{course_id}/progress")
async def progress(
    course_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    await enrolled_course(course_id, student, db)
    rows = (await db.execute(
        select(StudentSkillMastery, Skill, Unit)
        .join(Skill, Skill.id == StudentSkillMastery.skill_id)
        .join(Unit, Unit.id == Skill.unit_id)
        .where(StudentSkillMastery.student_id == student.id, Unit.course_id == course_id)
        .order_by(Unit.position, Skill.position)
    )).all()
    schedules = (await db.execute(select(ReviewSchedule).join(
        Skill, Skill.id == ReviewSchedule.skill_id
    ).join(Unit, Unit.id == Skill.unit_id).where(
        ReviewSchedule.student_id == student.id, Unit.course_id == course_id,
    ).order_by(ReviewSchedule.due_at))).scalars().all()
    return {
        "mastery": [{"skill_id": mastery.skill_id, "skill": skill.title, "unit": unit.title,
                     "probability": mastery.probability, "observations": mastery.observations,
                     "last_evidence_at": mastery.last_evidence_at}
                    for mastery, skill, unit in rows],
        "reviews": [{"skill_id": schedule.skill_id, "due_at": schedule.due_at,
                     "interval_days": schedule.interval_days, "repetitions": schedule.repetitions}
                    for schedule in schedules],
    }


@router.post("/reviews/{skill_id}/rate")
async def rate_review(
    skill_id: str, data: ReviewRatingIn, course_id: str,
    student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    await enrolled_course(course_id, student, db)
    skill = await db.scalar(select(Skill).join(Unit).where(
        Skill.id == skill_id, Unit.course_id == course_id,
    ))
    if skill is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    schedule = await db.scalar(select(ReviewSchedule).where(
        ReviewSchedule.student_id == student.id, ReviewSchedule.skill_id == skill_id,
    ).with_for_update())
    if schedule is None:
        schedule = ReviewSchedule(student_id=student.id, skill_id=skill_id)
        db.add(schedule)
    interval, repetitions = review_interval(schedule.interval_days, schedule.repetitions, data.rating)
    schedule.interval_days = interval
    schedule.repetitions = repetitions
    schedule.lapses += int(data.rating == 0)
    schedule.last_rating = data.rating
    schedule.due_at = datetime.now(UTC) + timedelta(days=interval)
    await db.commit()
    return {"skill_id": skill_id, "due_at": schedule.due_at,
            "interval_days": schedule.interval_days}


@router.get("/courses/{course_id}/reflections")
async def list_reflections(
    course_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await enrolled_course(course_id, student, db)
    reflections = (await db.execute(select(LearningReflection).where(
        LearningReflection.course_id == course_id,
        LearningReflection.student_id == student.id,
    ).order_by(LearningReflection.created_at.desc()))).scalars().all()
    return [{"id": item.id, "prompt": item.prompt, "body": item.body,
             "created_at": item.created_at} for item in reflections]


@router.post("/courses/{course_id}/reflections", status_code=201)
async def create_reflection(
    course_id: str, data: ReflectionCreate, student: Profile = Depends(require_student),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await enrolled_course(course_id, student, db)
    reflection = LearningReflection(course_id=course_id, student_id=student.id, **data.model_dump())
    db.add(reflection)
    await db.flush()
    record_event(db, student.id, "student.reflection.created", "reflection", reflection.id, course_id)
    await db.commit()
    return {"id": reflection.id, **data.model_dump(), "created_at": reflection.created_at}


@router.get("/courses/{course_id}/tutor/sessions")
async def list_tutor_sessions(
    course_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    await enrolled_course(course_id, student, db)
    sessions = (await db.execute(select(TutorSession).where(
        TutorSession.course_id == course_id, TutorSession.student_id == student.id,
    ).order_by(TutorSession.started_at.desc()).limit(30))).scalars().all()
    return {"ai_configured": settings.ai_configured,
            "sessions": [{"id": session.id, "skill_id": session.skill_id,
                          "status": session.status, "started_at": session.started_at}
                         for session in sessions]}


@router.post("/courses/{course_id}/tutor/sessions", status_code=201)
async def create_tutor_session(
    course_id: str, skill_id: str | None = None, student: Profile = Depends(require_student),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await enrolled_course(course_id, student, db)
    if skill_id:
        skill = await db.scalar(select(Skill).join(Unit).where(
            Skill.id == skill_id, Unit.course_id == course_id,
        ))
        if skill is None:
            raise HTTPException(status_code=404, detail="Skill not found")
    session = TutorSession(course_id=course_id, student_id=student.id, skill_id=skill_id)
    db.add(session)
    await db.flush()
    record_event(db, student.id, "tutor.session.created", "tutor_session", session.id, course_id)
    await db.commit()
    return {"id": session.id, "course_id": course_id, "skill_id": session.skill_id,
            "status": session.status, "started_at": session.started_at}


async def owned_tutor_session(session_id: str, student: Profile, db: AsyncSession) -> TutorSession:
    session = await db.scalar(select(TutorSession).where(
        TutorSession.id == session_id, TutorSession.student_id == student.id,
    ))
    if session is None:
        raise HTTPException(status_code=404, detail="Tutor session not found")
    return session


@router.get("/tutor/sessions/{session_id}")
async def get_tutor_session(
    session_id: str, student: Profile = Depends(require_student), db: AsyncSession = Depends(get_db),
) -> dict:
    session = await owned_tutor_session(session_id, student, db)
    messages = (await db.execute(select(TutorMessage).where(
        TutorMessage.session_id == session_id,
    ).order_by(TutorMessage.created_at))).scalars().all()
    return {"id": session.id, "course_id": session.course_id, "skill_id": session.skill_id,
            "status": session.status,
            "messages": [{"id": message.id, "role": message.role, "content": message.content,
                          "citations": message.citations, "created_at": message.created_at}
                         for message in messages]}


@router.post("/tutor/sessions/{session_id}/messages", status_code=201)
async def send_tutor_message(
    session_id: str, data: TutorMessageCreate, student: Profile = Depends(require_student),
    db: AsyncSession = Depends(get_db),
) -> dict:
    session = await owned_tutor_session(session_id, student, db)
    if session.status != "active":
        raise HTTPException(status_code=409, detail="Tutor session is closed")
    if not settings.ai_configured:
        raise HTTPException(status_code=503, detail="The AI tutor is not configured")
    skill_name = ""
    if session.skill_id:
        skill_name = await db.scalar(select(Skill.title).where(Skill.id == session.skill_id)) or ""
    vector = (await embed_texts([data.content]))[0]
    nearest = (await db.execute(
        select(MaterialChunk, Material)
        .join(Material, Material.id == MaterialChunk.material_id)
        .where(Material.course_id == session.course_id, Material.status == "ready",
               MaterialChunk.embedding.is_not(None))
        .order_by(MaterialChunk.embedding.cosine_distance(vector))
        .limit(5)
    )).all()
    sources = [{"material_id": material.id, "material_name": material.name,
                "page_number": chunk.page_number, "chunk_index": chunk.chunk_index,
                "content": chunk.content} for chunk, material in nearest]
    history = (await db.execute(select(TutorMessage).where(
        TutorMessage.session_id == session_id,
    ).order_by(TutorMessage.created_at.desc()).limit(10))).scalars().all()
    conversation = [{"role": message.role, "content": message.content}
                    for message in reversed(history)]
    conversation.append({"role": "user", "content": data.content})
    try:
        reply, usage = await generate_tutor_reply(conversation, skill_name, sources)
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    user_message = TutorMessage(session_id=session_id, role="user", content=data.content)
    citations = [{key: source[key] for key in (
        "material_id", "material_name", "page_number", "chunk_index",
    )} for source in sources]
    assistant_message = TutorMessage(
        session_id=session_id, role="assistant", content=reply, citations=citations,
        model=settings.ai_chat_model, input_tokens=usage.get("prompt_tokens"),
        output_tokens=usage.get("completion_tokens"),
    )
    db.add_all([user_message, assistant_message])
    record_event(db, student.id, "tutor.message.sent", "tutor_session", session_id, session.course_id)
    await db.commit()
    await db.refresh(assistant_message)
    return {"id": assistant_message.id, "role": assistant_message.role,
            "content": assistant_message.content, "citations": assistant_message.citations,
            "created_at": assistant_message.created_at}
