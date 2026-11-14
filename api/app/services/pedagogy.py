from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LearningEvidenceEvent, ReviewSchedule, Skill, StudentSkillMastery, Unit


def update_bkt(probability: float, correct: bool, slip: float = 0.1, guess: float = 0.2,
               transition: float = 0.15) -> float:
    if correct:
        denominator = probability * (1 - slip) + (1 - probability) * guess
        posterior = probability * (1 - slip) / denominator
    else:
        denominator = probability * slip + (1 - probability) * (1 - guess)
        posterior = probability * slip / denominator
    return min(0.99, max(0.01, posterior + (1 - posterior) * transition))


def review_interval(interval_days: int, repetitions: int, rating: int) -> tuple[int, int]:
    if rating == 0:
        return 1, 0
    if rating == 1:
        next_days = max(2, round(interval_days * 1.3))
    elif rating == 2:
        next_days = max(3, round(interval_days * 2.2))
    else:
        next_days = round(interval_days * 3.4) + 1
    return next_days, repetitions + 1


async def record_skill_evidence(
    db: AsyncSession,
    student_id: str,
    skill_id: str,
    correct: bool,
    *,
    course_id: str | None = None,
    evidence_type: str = "assessment",
    question_id: str | None = None,
    assessment_id: str | None = None,
    attempt_id: str | None = None,
    confidence: int | None = None,
    is_transfer: bool = False,
) -> float:
    mastery = await db.scalar(select(StudentSkillMastery).where(
        StudentSkillMastery.student_id == student_id,
        StudentSkillMastery.skill_id == skill_id,
    ).with_for_update())
    if mastery is None:
        mastery = StudentSkillMastery(student_id=student_id, skill_id=skill_id)
        db.add(mastery)
        await db.flush()
    probability_before = mastery.probability
    mastery.probability = update_bkt(probability_before, correct)
    mastery.observations += 1
    mastery.correct_count += int(correct)
    mastery.incorrect_count += int(not correct)
    mastery.last_evidence_at = datetime.now(UTC)

    if course_id is None:
        course_id = await db.scalar(select(Unit.course_id).join(Skill).where(Skill.id == skill_id))
    if course_id is None:
        raise ValueError("A course is required to record skill evidence")
    db.add(LearningEvidenceEvent(
        student_id=student_id,
        course_id=course_id,
        skill_id=skill_id,
        question_id=question_id,
        assessment_id=assessment_id,
        attempt_id=attempt_id,
        evidence_type=evidence_type,
        is_correct=correct,
        is_transfer=is_transfer,
        confidence=confidence,
        probability_before=probability_before,
        probability_after=mastery.probability,
    ))

    schedule = await db.scalar(select(ReviewSchedule).where(
        ReviewSchedule.student_id == student_id,
        ReviewSchedule.skill_id == skill_id,
    ).with_for_update())
    if schedule is None:
        db.add(ReviewSchedule(
            student_id=student_id, skill_id=skill_id,
            due_at=datetime.now(UTC) + timedelta(days=1),
            interval_days=1, repetitions=0, lapses=0,
        ))
    return mastery.probability
