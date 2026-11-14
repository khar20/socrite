from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_teacher
from app.config import settings
from app.db import get_db
from app.models import (
    Assessment,
    AssessmentAttempt,
    AssessmentQuestion,
    AuditEvent,
    Course,
    CourseMember,
    LearningEvidenceEvent,
    Material,
    Question,
    QuestionAttempt,
    ReviewSchedule,
    Skill,
    SpacedReviewEvent,
    StudentSkillMastery,
    Submission,
    Topic,
    Unit,
    User,
)
from app.routers.courses import owned_course
from app.schemas import (
    AssessmentCreate,
    AssessmentUpdate,
    AssessmentQuestionIn,
    QuestionCreate,
    QuestionUpdate,
    SubmissionReview,
)
from app.services.audit import record_event
from app.services.pedagogy import record_skill_evidence

router = APIRouter(tags=["teacher"])


@router.get("/teacher/dashboard")
async def dashboard(
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
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
    course_id: str, limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0),
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    total_students = await db.scalar(select(func.count(CourseMember.id)).where(
        CourseMember.course_id == course_id, CourseMember.role == "student",
    )) or 0
    result = await db.execute(
        select(CourseMember, User).join(User, User.id == CourseMember.profile_id)
        .where(CourseMember.course_id == course_id, CourseMember.role == "student")
        .order_by(User.first_name, User.paternal_last_name, User.maternal_last_name)
        .limit(limit).offset(offset)
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
    return {
        "students": [{
            "id": member.id, "name": profile.full_name, "email": profile.email,
            "mastery_average": (
                mastery_by_student[profile.id]["sum"] / mastery_by_student[profile.id]["count"]
                if profile.id in mastery_by_student else None
            ),
            "evidence_count": mastery_by_student.get(profile.id, {}).get("count", 0),
            "skills": mastery_by_student.get(profile.id, {}).get("skills", []),
        } for member, profile in members],
        "pagination": {"total": total_students, "limit": limit, "offset": offset},
    }


@router.get("/courses/{course_id}/analytics")
async def course_analytics(
    course_id: str,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    membership_filter = (CourseMember.course_id == course_id, CourseMember.role == "student")
    total_students = await db.scalar(
        select(func.count(CourseMember.id)).where(*membership_filter)
    ) or 0
    members = (await db.execute(
        select(CourseMember, User).join(User, User.id == CourseMember.profile_id)
        .where(*membership_filter)
        .order_by(User.first_name, User.paternal_last_name, User.email)
        .limit(limit).offset(offset)
    )).all()
    student_ids = [user.id for _, user in members]
    skills_and_units = (await db.execute(
        select(Skill, Unit).join(Unit, Unit.id == Skill.unit_id)
        .where(Unit.course_id == course_id).order_by(Unit.position, Skill.position)
    )).all()
    skills = [{"id": skill.id, "title": skill.title, "unit": unit.title}
              for skill, unit in skills_and_units]
    mastery_rows = []
    if student_ids:
        mastery_rows = (await db.execute(select(StudentSkillMastery).where(
            StudentSkillMastery.student_id.in_(student_ids),
            StudentSkillMastery.skill_id.in_([item[0].id for item in skills_and_units] or [""]),
        ))).scalars().all()
    mastery_map = {(row.student_id, row.skill_id): row for row in mastery_rows}

    evidence_by_student: dict[str, dict] = {}
    transfer_evidence = (await db.execute(
        select(LearningEvidenceEvent.student_id, func.count(LearningEvidenceEvent.id),
               func.avg(case((LearningEvidenceEvent.is_correct.is_(True), 1.0), else_=0.0)))
        .where(LearningEvidenceEvent.course_id == course_id, LearningEvidenceEvent.is_transfer.is_(True))
        .group_by(LearningEvidenceEvent.student_id)
    )).all()
    transfer_by_student = {student_id: {"count": count, "accuracy": accuracy}
                           for student_id, count, accuracy in transfer_evidence}
    if student_ids:
        evidence_rows = (await db.execute(
            select(LearningEvidenceEvent.student_id, func.count(LearningEvidenceEvent.id),
                   func.sum(case((LearningEvidenceEvent.is_correct.is_(True), 1), else_=0)),
                   func.max(LearningEvidenceEvent.created_at))
            .where(LearningEvidenceEvent.course_id == course_id,
                   LearningEvidenceEvent.student_id.in_(student_ids))
            .group_by(LearningEvidenceEvent.student_id)
        )).all()
        evidence_by_student = {
            student_id: {"count": count, "correct": correct or 0, "last": last}
            for student_id, count, correct, last in evidence_rows
        }
        retention_rows = (await db.execute(
            select(SpacedReviewEvent.student_id,
                   func.count(SpacedReviewEvent.id),
                   func.avg(SpacedReviewEvent.rating),
                   func.count(SpacedReviewEvent.id).filter(
                       SpacedReviewEvent.due_at_before <= SpacedReviewEvent.created_at,
                   ))
            .where(SpacedReviewEvent.course_id == course_id,
                   SpacedReviewEvent.student_id.in_(student_ids))
            .group_by(SpacedReviewEvent.student_id)
        )).all()
        retention_by_student = {
            student_id: {"count": count, "rating": rating, "due_count": due_count}
            for student_id, count, rating, due_count in retention_rows
        }
    else:
        retention_by_student = {}

    mastery_by_student: dict[str, list[float]] = {}
    for row in mastery_rows:
        mastery_by_student.setdefault(row.student_id, []).append(row.probability)
    student_payload = []
    for _, user in members:
        evidence = evidence_by_student.get(user.id, {})
        transfer = transfer_by_student.get(user.id, {})
        retention = retention_by_student.get(user.id, {})
        probabilities = mastery_by_student.get(user.id, [])
        student_payload.append({
            "id": user.id,
            "name": user.full_name,
            "email": user.email,
            "is_active": user.is_active,
            "mastery_average": sum(probabilities) / len(probabilities) if probabilities else None,
            "evidence_count": evidence.get("count", 0),
            "evidence_accuracy": evidence["correct"] / evidence["count"] if evidence.get("count") else None,
            "last_evidence_at": evidence.get("last"),
            "transfer_count": transfer.get("count", 0),
            "transfer_accuracy": transfer.get("accuracy"),
            "review_count": retention.get("count", 0),
            "average_review_rating": retention.get("rating"),
            "on_time_reviews": retention.get("due_count", 0),
        })

    heatmap = [{
        **skill,
        "cells": [{
            "student_id": user.id,
            "probability": (row.probability if (row := mastery_map.get((user.id, skill["id"]))) else None),
            "observations": row.observations if row else 0,
        } for _, user in members],
    } for skill in skills]

    now = datetime.now(UTC)
    overall_mastery = await db.scalar(
        select(func.avg(StudentSkillMastery.probability))
        .join(Skill, Skill.id == StudentSkillMastery.skill_id)
        .join(Unit, Unit.id == Skill.unit_id)
        .where(Unit.course_id == course_id)
    )
    completed_reviews = await db.scalar(select(func.count(SpacedReviewEvent.id)).where(
        SpacedReviewEvent.course_id == course_id,
        SpacedReviewEvent.due_at_before <= SpacedReviewEvent.created_at,
    )) or 0
    overdue_reviews = await db.scalar(select(func.count(ReviewSchedule.id)).select_from(ReviewSchedule)
    .join(Skill, Skill.id == ReviewSchedule.skill_id)
    .join(Unit, Unit.id == Skill.unit_id).where(
        Unit.course_id == course_id,
        ReviewSchedule.due_at <= now,
    )) or 0
    return {
        "students": student_payload,
        "skills": skills,
        "heatmap": heatmap,
        "pagination": {"total": total_students, "limit": limit, "offset": offset},
        "summary": {
            "students": total_students,
            "average_mastery": overall_mastery,
            "transfer_evidence": sum(item["count"] for item in transfer_by_student.values()),
            "transfer_accuracy": (
                sum(item["accuracy"] * item["count"] for item in transfer_by_student.values())
                / sum(item["count"] for item in transfer_by_student.values())
                if any(item["count"] for item in transfer_by_student.values()) else None
            ),
            "completed_retention_reviews": completed_reviews,
            "overdue_reviews": overdue_reviews,
        },
    }


@router.get("/courses/{course_id}/reviews")
async def reviews(
    course_id: str, limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0),
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    total = await db.scalar(select(func.count(Submission.id)).where(Submission.course_id == course_id)) or 0
    result = await db.execute(select(Submission, User, QuestionAttempt)
                              .join(User, User.id == Submission.student_id)
                              .outerjoin(QuestionAttempt, QuestionAttempt.id == Submission.question_attempt_id)
                              .where(Submission.course_id == course_id)
                              .order_by(Submission.created_at.desc()).limit(limit).offset(offset))
    items = [{"id": submission.id, "student_name": user.full_name, "student_email": user.email,
             "response": submission.response, "suggested_score": submission.suggested_score,
             "suggested_feedback": attempt.feedback if attempt else "",
             "final_score": submission.final_score, "teacher_comment": submission.teacher_comment,
             "status": submission.status, "created_at": submission.created_at}
            for submission, user, attempt in result.all()]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/submissions/{submission_id}/review")
async def review_submission(
    submission_id: str, body: SubmissionReview, teacher: User = Depends(require_teacher),
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
            assessment_attempt = await db.get(AssessmentAttempt, answer.assessment_attempt_id)
            question = await db.get(Question, answer.question_id)
            assessment = await db.get(Assessment, assessment_attempt.assessment_id) if assessment_attempt else None
            if question and question.skill_id:
                await record_skill_evidence(
                    db,
                    submission.student_id,
                    question.skill_id,
                    body.final_score >= 12,
                    course_id=submission.course_id,
                    evidence_type="teacher_review",
                    question_id=question.id,
                    assessment_id=assessment_attempt.assessment_id if assessment_attempt else None,
                    attempt_id=assessment_attempt.id if assessment_attempt else None,
                    confidence=answer.confidence,
                    is_transfer=assessment is not None and assessment.kind == "transfer",
                )
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
    course_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    assessments = (await db.execute(select(Assessment).where(Assessment.course_id == course_id)
                                   .order_by(Assessment.created_at.desc()))).scalars().all()
    result = []
    for assessment in assessments:
        attempt_count = await db.scalar(select(func.count(AssessmentAttempt.id)).where(
            AssessmentAttempt.assessment_id == assessment.id,
        )) or 0
        items = (await db.execute(select(AssessmentQuestion).where(
            AssessmentQuestion.assessment_id == assessment.id).order_by(AssessmentQuestion.position))).scalars().all()
        linked_questions = (await db.execute(
            select(Question).join(AssessmentQuestion, AssessmentQuestion.question_id == Question.id)
            .where(AssessmentQuestion.assessment_id == assessment.id)
            .order_by(AssessmentQuestion.position)
        )).scalars().all() if items else []
        result.append({"id": assessment.id, "title": assessment.title, "description": assessment.description,
                       "kind": assessment.kind, "status": assessment.status,
                       "settings": assessment.settings,
                       "attempt_count": attempt_count,
                       "question_ids": [item.question_id for item in items],
                       "questions": [{"id": question.id, "prompt": question.prompt,
                           "question_type": question.question_type, "options": question.options,
                           "answer_key": question.answer_key, "rubric": question.rubric,
                           "unit_id": question.unit_id, "skill_id": question.skill_id,
                           "topic_id": question.topic_id, "bank_visible": question.bank_visible,
                           "status": question.status, "source_refs": question.source_refs}
                           for question in linked_questions],
                       "created_at": assessment.created_at})
    return result


@router.post("/courses/{course_id}/assessments", status_code=201)
async def create_assessment(
    course_id: str, data: AssessmentCreate, teacher: User = Depends(require_teacher),
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
    return {"id": assessment.id, **data.model_dump(), "status": assessment.status,
            "settings": assessment.settings, "question_ids": []}


@router.patch("/assessments/{assessment_id}")
async def update_assessment(
    assessment_id: str, data: AssessmentUpdate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    assessment = await db.get(Assessment, assessment_id)
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    await owned_course(assessment.course_id, teacher, db)
    if assessment.status not in {"draft", "published"}:
        raise HTTPException(status_code=409, detail="Las actividades archivadas no se pueden editar.")
    if assessment.status == "published":
        attempt_count = await db.scalar(select(func.count(AssessmentAttempt.id)).where(
            AssessmentAttempt.assessment_id == assessment.id,
        )) or 0
        if attempt_count:
            raise HTTPException(status_code=409, detail="No se puede editar una actividad con intentos; archívala para conservar el historial.")
        if data.kind != assessment.kind:
            raise HTTPException(status_code=409, detail="El tipo de una actividad publicada no se puede cambiar.")
    assessment.title = data.title
    assessment.description = data.description
    if assessment.status == "draft":
        assessment.kind = data.kind
    assessment.settings = {**(assessment.settings or {}), "instructions": data.instructions}
    record_event(db, teacher.id, "assessment.updated", "assessment", assessment.id, assessment.course_id)
    await db.commit()
    return {"id": assessment.id, **data.model_dump(), "status": assessment.status}


@router.delete("/assessments/{assessment_id}")
async def delete_assessment(
    assessment_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    assessment = await db.get(Assessment, assessment_id)
    if assessment is None:
        raise HTTPException(status_code=404, detail="No se encontró la actividad.")
    await owned_course(assessment.course_id, teacher, db)
    attempts = await db.scalar(select(func.count(AssessmentAttempt.id)).where(
        AssessmentAttempt.assessment_id == assessment.id,
    )) or 0
    try:
        if assessment.status != "draft" or attempts:
            assessment.status = "archived"
            record_event(db, teacher.id, "assessment.archived", "assessment", assessment.id,
                         assessment.course_id, {"attempt_count": attempts})
        else:
            associations = (await db.execute(select(AssessmentQuestion).where(
                AssessmentQuestion.assessment_id == assessment.id,
            ))).scalars().all()
            private_question_ids = []
            for association in associations:
                question = await db.get(Question, association.question_id)
                if question is not None and not question.bank_visible:
                    private_question_ids.append(question.id)
                await db.delete(association)
            await db.flush()
            await db.delete(assessment)
            await db.flush()
            for question_id in private_question_ids:
                used_elsewhere = await db.scalar(select(func.count(AssessmentQuestion.id)).where(
                    AssessmentQuestion.question_id == question_id,
                )) or 0
                has_attempts = await db.scalar(select(func.count(QuestionAttempt.id)).where(
                    QuestionAttempt.question_id == question_id,
                )) or 0
                has_submissions = await db.scalar(select(func.count(Submission.id)).where(
                    Submission.question_id == question_id,
                )) or 0
                if not used_elsewhere and not has_attempts and not has_submissions:
                    question = await db.get(Question, question_id)
                    if question is not None:
                        await db.delete(question)
            record_event(db, teacher.id, "assessment.deleted", "assessment", assessment.id,
                         assessment.course_id)
        archived = assessment.status == "archived"
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="No se puede eliminar la actividad porque tiene respuestas asociadas.") from exc
    return {"id": assessment_id, "status": "archived" if archived else "deleted"}


@router.put("/assessments/{assessment_id}/questions/{question_id}")
async def assign_assessment_question(
    assessment_id: str, question_id: str, data: AssessmentQuestionIn,
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    assessment = await db.get(Assessment, assessment_id)
    question = await db.get(Question, question_id)
    if assessment is None or question is None:
        raise HTTPException(status_code=404, detail="Assessment or question not found")
    await owned_course(assessment.course_id, teacher, db)
    if assessment.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft assessments can be edited")
    if question.course_id != assessment.course_id or question.status != "published" or not question.bank_visible:
        raise HTTPException(status_code=422, detail="Choose a published question from this course")
    if not question.skill_id or not question.topic_id:
        raise HTTPException(status_code=409, detail="La pregunta debe estar vinculada con una habilidad y un tema.")
    skill = await db.get(Skill, question.skill_id)
    topic = await db.get(Topic, question.topic_id)
    unit = await db.get(Unit, skill.unit_id) if skill else None
    if (skill is None or topic is None or unit is None or unit.course_id != assessment.course_id
            or skill.unit_id != topic.unit_id or skill.status != "published" or topic.status != "published"):
        raise HTTPException(status_code=409, detail="La pregunta debe estar vinculada a una habilidad y tema publicados de este curso.")
    item = await db.scalar(select(AssessmentQuestion).where(
        AssessmentQuestion.assessment_id == assessment_id,
        AssessmentQuestion.question_id == question_id,
    ))
    if item is None:
        item = AssessmentQuestion(assessment_id=assessment_id, **data.model_dump())
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
    assessment_id: str, question_id: str, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> Response:
    assessment = await db.get(Assessment, assessment_id)
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found")
    await owned_course(assessment.course_id, teacher, db)
    if assessment.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft assessments can be edited")
    question = await db.get(Question, question_id)
    item = await db.scalar(select(AssessmentQuestion).where(
        AssessmentQuestion.assessment_id == assessment_id,
        AssessmentQuestion.question_id == question_id,
    ))
    if item is not None:
        await db.delete(item)
        await db.flush()
        if not question.bank_visible:
            other_links = await db.scalar(select(func.count(AssessmentQuestion.id)).where(
                AssessmentQuestion.question_id == question.id,
            )) or 0
            attempts = await db.scalar(select(func.count(QuestionAttempt.id)).where(
                QuestionAttempt.question_id == question.id,
            )) or 0
            submissions = await db.scalar(select(func.count(Submission.id)).where(
                Submission.question_id == question.id,
            )) or 0
            if not other_links and not attempts and not submissions:
                await db.delete(question)
        record_event(db, teacher.id, "assessment.question.removed", "assessment", assessment.id,
                     assessment.course_id, {"question_id": question_id})
        await db.commit()
    return Response(status_code=204)


@router.patch("/assessments/{assessment_id}/publish")
async def publish_assessment(
    assessment_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
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
    linked_questions = (await db.execute(
        select(Question).join(AssessmentQuestion, AssessmentQuestion.question_id == Question.id)
        .where(AssessmentQuestion.assessment_id == assessment.id)
    )).scalars().all()
    private_questions = []
    for question in linked_questions:
        if question.bank_visible and question.status != "published":
            raise HTTPException(status_code=409, detail="Aprueba las preguntas del banco antes de publicar la actividad.")
        if question.status == "archived" or not question.skill_id or not question.topic_id:
            raise HTTPException(status_code=409, detail="Cada pregunta debe tener una habilidad y un tema publicados.")
        if question.question_type == "open" and not question.rubric:
            raise HTTPException(status_code=409, detail="Agrega criterios de revisión a cada pregunta abierta antes de publicar.")
        skill = await db.get(Skill, question.skill_id)
        topic = await db.get(Topic, question.topic_id)
        unit = await db.get(Unit, skill.unit_id) if skill else None
        if (skill is None or topic is None or unit is None or unit.course_id != assessment.course_id
                or skill.unit_id != topic.unit_id or skill.status != "published" or topic.status != "published"):
            raise HTTPException(status_code=409, detail="Publica la habilidad y el tema vinculados a cada pregunta.")
        if not question.bank_visible and question.status == "draft":
            private_questions.append(question)
    for question in private_questions:
        question.status = "published"
    assessment.status = "published"
    assessment.published_at = datetime.now(UTC)
    record_event(db, teacher.id, "assessment.published", "assessment", assessment.id,
                 assessment.course_id)
    await db.commit()
    return {"id": assessment.id, "status": assessment.status}


async def validate_question_curriculum(
    db: AsyncSession, course_id: str, data: QuestionCreate,
) -> str:
    if not data.skill_id or not data.topic_id:
        raise HTTPException(status_code=422, detail="Vincula cada pregunta con una habilidad y un tema publicados.")
    skill = await db.get(Skill, data.skill_id)
    topic = await db.get(Topic, data.topic_id)
    if skill is None or topic is None or skill.unit_id != topic.unit_id:
        raise HTTPException(status_code=422, detail="La habilidad y el tema deben pertenecer a la misma unidad.")
    unit = await db.get(Unit, skill.unit_id)
    if unit is None or unit.course_id != course_id or (data.unit_id and data.unit_id != unit.id):
        raise HTTPException(status_code=422, detail="La habilidad y el tema deben pertenecer a este curso y unidad.")
    if skill.status != "published" or topic.status != "published":
        raise HTTPException(status_code=409, detail="Publica la habilidad y el tema antes de vincular la pregunta.")
    return unit.id


@router.get("/courses/{course_id}/questions")
async def questions(
    course_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await owned_course(course_id, teacher, db)
    result = await db.execute(select(Question).where(
        Question.course_id == course_id, Question.bank_visible.is_(True),
    )
                              .order_by(Question.created_at.desc()))
    return [{"id": q.id, "prompt": q.prompt, "unit_id": q.unit_id, "question_type": q.question_type,
             "skill_id": q.skill_id, "topic_id": q.topic_id, "bank_visible": q.bank_visible,
             "options": q.options, "answer_key": q.answer_key,
             "rubric": q.rubric, "irt_difficulty": q.irt_difficulty,
             "irt_discrimination": q.irt_discrimination,
             "source_refs": q.source_refs,
             "status": q.status, "created_at": q.created_at}
            for q in result.scalars().all()]


@router.post("/courses/{course_id}/questions", status_code=201)
async def create_question(
    course_id: str, data: QuestionCreate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    linked_unit_id = await validate_question_curriculum(db, course_id, data)
    question = Question(course_id=course_id, **(data.model_dump() | {"unit_id": linked_unit_id}))
    db.add(question)
    await db.flush()
    record_event(db, teacher.id, "question.created", "question", question.id, course_id)
    await db.commit()
    return {"id": question.id, **data.model_dump(), "status": question.status}


@router.patch("/questions/{question_id}")
async def update_question(
    question_id: str, data: QuestionUpdate, teacher: User = Depends(require_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    await owned_course(question.course_id, teacher, db)
    if question.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft questions can be edited")
    linked_unit_id = await validate_question_curriculum(db, question.course_id, data)
    values = data.model_dump() | {"unit_id": linked_unit_id}
    for key, value in values.items():
        setattr(question, key, value)
    record_event(db, teacher.id, "question.updated", "question", question.id, question.course_id)
    await db.commit()
    return {"id": question.id, **values, "status": question.status}


@router.delete("/questions/{question_id}", status_code=204)
async def delete_question(
    question_id: str, teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> Response:
    question = await db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    await owned_course(question.course_id, teacher, db)
    if question.status != "draft":
        raise HTTPException(status_code=409, detail="Published questions cannot be deleted")
    submissions = await db.scalar(select(func.count(Submission.id)).where(Submission.question_id == question.id)) or 0
    attempts = await db.scalar(select(func.count(QuestionAttempt.id)).where(
        QuestionAttempt.question_id == question.id,
    )) or 0
    if submissions or attempts:
        raise HTTPException(status_code=409, detail="This question has student responses or attempts and cannot be deleted")

    associations = (await db.execute(
        select(AssessmentQuestion, Assessment.status)
        .join(Assessment, Assessment.id == AssessmentQuestion.assessment_id)
        .where(AssessmentQuestion.question_id == question.id)
    )).all()
    if any(status != "draft" for _, status in associations):
        raise HTTPException(
            status_code=409,
            detail="This question belongs to a published or archived assessment. Remove it from that assessment before deleting it.",
        )

    try:
        for association, _ in associations:
            await db.delete(association)
        record_event(db, teacher.id, "question.deleted", "question", question.id, question.course_id)
        await db.delete(question)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This question is still referenced by student activity or an assessment and cannot be deleted.",
        ) from exc
    return Response(status_code=204)


@router.get("/courses/{course_id}/activity")
async def activity(
    course_id: str, limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    await owned_course(course_id, teacher, db)
    event_filter = AuditEvent.course_id == course_id
    total = await db.scalar(select(func.count(AuditEvent.id)).where(event_filter)) or 0
    result = await db.execute(select(AuditEvent).where(event_filter)
                              .order_by(AuditEvent.created_at.desc()).limit(limit).offset(offset))
    items = [{"id": event.id, "action": event.action, "entity_type": event.entity_type,
             "entity_id": event.entity_id, "details": event.details, "created_at": event.created_at}
             for event in result.scalars().all()]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/teacher/activity")
async def all_activity(
    limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
    teacher: User = Depends(require_teacher), db: AsyncSession = Depends(get_db),
) -> dict:
    course_ids = select(Course.id).where(Course.owner_id == teacher.id)
    event_filter = AuditEvent.course_id.in_(course_ids)
    total = await db.scalar(select(func.count(AuditEvent.id)).where(event_filter)) or 0
    result = await db.execute(select(AuditEvent).where(event_filter)
                              .order_by(AuditEvent.created_at.desc()).limit(limit).offset(offset))
    items = [{"id": event.id, "action": event.action, "entity_type": event.entity_type,
             "entity_id": event.entity_id, "details": event.details, "created_at": event.created_at}
             for event in result.scalars().all()]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/configuration")
async def configuration(teacher: User = Depends(require_teacher)) -> dict:
    return {"database_configured": settings.database_configured,
            "ai_configured": settings.ai_configured,
            "ai_vision_configured": settings.ai_vision_configured,
            "ai_provider": settings.ai_provider_name or None,
            "chat_model": settings.ai_chat_model if settings.ai_configured else None,
            "embedding_model": settings.ai_embedding_model if settings.ai_configured else None,
            "storage_configured": settings.storage_configured,
            "max_upload_mb": settings.max_upload_mb}
