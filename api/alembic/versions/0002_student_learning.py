"""Add enrollment, assessments, learning evidence, and tutor history."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002_student_learning"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("course_members_course_id_profile_id_key", "course_members", type_="unique")
    op.create_unique_constraint("uq_course_membership", "course_members", ["course_id", "profile_id"])

    op.create_check_constraint("ck_profiles_role", "profiles", "role IN ('student', 'teacher', 'admin')")
    op.create_check_constraint("ck_courses_status", "courses", "status IN ('draft', 'active', 'archived')")
    op.create_check_constraint("ck_course_members_role", "course_members", "role IN ('student', 'teacher')")
    op.create_check_constraint("ck_materials_kind", "materials", "kind IN ('file', 'link')")
    op.create_check_constraint(
        "ck_materials_status", "materials",
        "status IN ('uploading', 'queued', 'processing', 'ready', 'failed')",
    )
    op.create_check_constraint(
        "ck_questions_type", "questions",
        "question_type IN ('open', 'multiple_choice', 'numeric')",
    )
    op.create_check_constraint(
        "ck_questions_status", "questions", "status IN ('draft', 'published', 'archived')",
    )
    op.create_check_constraint(
        "ck_processing_jobs_status", "processing_jobs",
        "status IN ('queued', 'processing', 'completed', 'failed')",
    )
    op.create_check_constraint(
        "ck_submissions_status", "submissions", "status IN ('pending', 'reviewed')",
    )
    op.create_index(
        "uq_processing_jobs_active_material", "processing_jobs", ["material_id"], unique=True,
        postgresql_where=sa.text("status IN ('queued', 'processing')"),
    )

    op.add_column("questions", sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("questions", sa.Column("answer_key", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("questions", sa.Column("skill_id", sa.String(length=36), nullable=True))
    op.add_column("questions", sa.Column("irt_difficulty", sa.Float(), nullable=True))
    op.add_column("questions", sa.Column("irt_discrimination", sa.Float(), nullable=True))
    op.create_foreign_key("fk_questions_skill_id_skills", "questions", "skills", ["skill_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_questions_skill_id", "questions", ["skill_id"])
    op.add_column("submissions", sa.Column("question_attempt_id", sa.String(length=36), nullable=True))

    op.create_table(
        "course_invitations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("course_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("invited_by", sa.String(length=128), nullable=False),
        sa.Column("accepted_by", sa.String(length=128), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'revoked', 'expired')", name="ck_course_invitations_status"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["profiles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["accepted_by"], ["profiles.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_course_invitations_course_id", "course_invitations", ["course_id"])
    op.create_index("uq_course_invitations_pending", "course_invitations", ["course_id", "email"], unique=True,
                    postgresql_where=sa.text("status = 'pending'"))

    op.create_table(
        "assessments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("course_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('diagnostic', 'practice', 'quiz', 'transfer')", name="ck_assessments_kind"),
        sa.CheckConstraint("status IN ('draft', 'published', 'archived')", name="ck_assessments_status"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["profiles.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_assessments_course_id", "assessments", ["course_id"])

    op.create_table(
        "assessment_questions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("assessment_id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("points", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["assessment_id"], ["assessments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("assessment_id", "question_id", name="uq_assessment_questions_question"),
        sa.UniqueConstraint("assessment_id", "position", name="uq_assessment_questions_position"),
    )
    op.create_index("ix_assessment_questions_assessment_id", "assessment_questions", ["assessment_id"])
    op.create_index("ix_assessment_questions_question_id", "assessment_questions", ["question_id"])

    op.create_table(
        "assessment_attempts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("assessment_id", sa.String(length=36), nullable=False),
        sa.Column("course_id", sa.String(length=36), nullable=False),
        sa.Column("student_id", sa.String(length=128), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("possible_score", sa.Float(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('in_progress', 'submitted', 'reviewed', 'abandoned')", name="ck_assessment_attempt_status"),
        sa.ForeignKeyConstraint(["assessment_id"], ["assessments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("assessment_id", "student_id", "attempt_number", name="uq_assessment_attempt_number"),
    )
    op.create_index("ix_assessment_attempts_assessment_id", "assessment_attempts", ["assessment_id"])
    op.create_index("ix_assessment_attempts_course_id", "assessment_attempts", ["course_id"])
    op.create_index("ix_assessment_attempts_student_id", "assessment_attempts", ["student_id"])

    op.create_table(
        "question_attempts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("assessment_attempt_id", sa.String(length=36), nullable=False),
        sa.Column("question_id", sa.String(length=36), nullable=False),
        sa.Column("response", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("confidence", sa.SmallInteger(), nullable=True),
        sa.Column("suggested_score", sa.Float(), nullable=True),
        sa.Column("final_score", sa.Float(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("confidence IS NULL OR confidence BETWEEN 0 AND 2", name="ck_question_attempt_confidence"),
        sa.ForeignKeyConstraint(["assessment_attempt_id"], ["assessment_attempts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("assessment_attempt_id", "question_id", name="uq_question_attempt_item"),
    )
    op.create_index("ix_question_attempts_assessment_attempt_id", "question_attempts", ["assessment_attempt_id"])
    op.create_index("ix_question_attempts_question_id", "question_attempts", ["question_id"])
    op.create_foreign_key("fk_submissions_question_attempt_id", "submissions", "question_attempts",
                          ["question_attempt_id"], ["id"], ondelete="SET NULL")
    op.create_unique_constraint("uq_submissions_question_attempt_id", "submissions", ["question_attempt_id"])

    op.create_table(
        "student_skill_mastery",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("student_id", sa.String(length=128), nullable=False),
        sa.Column("skill_id", sa.String(length=36), nullable=False),
        sa.Column("probability", sa.Float(), nullable=False),
        sa.Column("observations", sa.Integer(), nullable=False),
        sa.Column("correct_count", sa.Integer(), nullable=False),
        sa.Column("incorrect_count", sa.Integer(), nullable=False),
        sa.Column("last_evidence_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("probability BETWEEN 0 AND 1", name="ck_student_skill_mastery_probability"),
        sa.ForeignKeyConstraint(["student_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("student_id", "skill_id", name="uq_student_skill_mastery"),
    )
    op.create_index("ix_student_skill_mastery_student_id", "student_skill_mastery", ["student_id"])
    op.create_index("ix_student_skill_mastery_skill_id", "student_skill_mastery", ["skill_id"])

    op.create_table(
        "review_schedules",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("student_id", sa.String(length=128), nullable=False),
        sa.Column("skill_id", sa.String(length=36), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("interval_days", sa.Integer(), nullable=False),
        sa.Column("repetitions", sa.Integer(), nullable=False),
        sa.Column("lapses", sa.Integer(), nullable=False),
        sa.Column("last_rating", sa.SmallInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("interval_days >= 1", name="ck_review_schedule_interval"),
        sa.ForeignKeyConstraint(["student_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("student_id", "skill_id", name="uq_review_schedule_student_skill"),
    )
    op.create_index("ix_review_schedules_student_id", "review_schedules", ["student_id"])
    op.create_index("ix_review_schedules_skill_id", "review_schedules", ["skill_id"])
    op.create_index("ix_review_schedules_due_at", "review_schedules", ["due_at"])

    op.create_table(
        "tutor_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("course_id", sa.String(length=36), nullable=False),
        sa.Column("student_id", sa.String(length=128), nullable=False),
        sa.Column("skill_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('active', 'completed', 'abandoned')", name="ck_tutor_session_status"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_tutor_sessions_course_id", "tutor_sessions", ["course_id"])
    op.create_index("ix_tutor_sessions_student_id", "tutor_sessions", ["student_id"])

    op.create_table(
        "tutor_messages",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant', 'system')", name="ck_tutor_message_role"),
        sa.ForeignKeyConstraint(["session_id"], ["tutor_sessions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_tutor_messages_session_id", "tutor_messages", ["session_id"])

    op.create_table(
        "learning_reflections",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("course_id", sa.String(length=36), nullable=False),
        sa.Column("student_id", sa.String(length=128), nullable=False),
        sa.Column("prompt", sa.String(length=500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["profiles.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_learning_reflections_course_id", "learning_reflections", ["course_id"])
    op.create_index("ix_learning_reflections_student_id", "learning_reflections", ["student_id"])

    op.create_table(
        "ai_usage_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("course_id", sa.String(length=36), nullable=True),
        sa.Column("actor_id", sa.String(length=128), nullable=False),
        sa.Column("feature", sa.String(length=40), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("model", sa.String(length=120), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("estimated_cost", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_id"], ["profiles.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_ai_usage_events_course_id", "ai_usage_events", ["course_id"])
    op.create_index("ix_ai_usage_events_actor_id", "ai_usage_events", ["actor_id"])
    op.create_index("ix_ai_usage_events_created_at", "ai_usage_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_events_created_at", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_actor_id", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_course_id", table_name="ai_usage_events")
    op.drop_table("ai_usage_events")
    op.drop_index("ix_learning_reflections_student_id", table_name="learning_reflections")
    op.drop_index("ix_learning_reflections_course_id", table_name="learning_reflections")
    op.drop_table("learning_reflections")
    op.drop_index("ix_tutor_messages_session_id", table_name="tutor_messages")
    op.drop_table("tutor_messages")
    op.drop_index("ix_tutor_sessions_student_id", table_name="tutor_sessions")
    op.drop_index("ix_tutor_sessions_course_id", table_name="tutor_sessions")
    op.drop_table("tutor_sessions")
    op.drop_index("ix_review_schedules_due_at", table_name="review_schedules")
    op.drop_index("ix_review_schedules_skill_id", table_name="review_schedules")
    op.drop_index("ix_review_schedules_student_id", table_name="review_schedules")
    op.drop_table("review_schedules")
    op.drop_index("ix_student_skill_mastery_skill_id", table_name="student_skill_mastery")
    op.drop_index("ix_student_skill_mastery_student_id", table_name="student_skill_mastery")
    op.drop_table("student_skill_mastery")
    op.drop_index("ix_question_attempts_question_id", table_name="question_attempts")
    op.drop_index("ix_question_attempts_assessment_attempt_id", table_name="question_attempts")
    op.drop_table("question_attempts")
    op.drop_index("ix_assessment_attempts_student_id", table_name="assessment_attempts")
    op.drop_index("ix_assessment_attempts_course_id", table_name="assessment_attempts")
    op.drop_index("ix_assessment_attempts_assessment_id", table_name="assessment_attempts")
    op.drop_table("assessment_attempts")
    op.drop_index("ix_assessment_questions_question_id", table_name="assessment_questions")
    op.drop_index("ix_assessment_questions_assessment_id", table_name="assessment_questions")
    op.drop_table("assessment_questions")
    op.drop_index("ix_assessments_course_id", table_name="assessments")
    op.drop_table("assessments")
    op.drop_index("uq_course_invitations_pending", table_name="course_invitations")
    op.drop_index("ix_course_invitations_course_id", table_name="course_invitations")
    op.drop_table("course_invitations")
    op.drop_constraint("uq_submissions_question_attempt_id", "submissions", type_="unique")
    op.drop_constraint("fk_submissions_question_attempt_id", "submissions", type_="foreignkey")
    op.drop_index("uq_processing_jobs_active_material", table_name="processing_jobs")
    op.drop_column("submissions", "question_attempt_id")
    op.drop_index("ix_questions_skill_id", table_name="questions")
    op.drop_constraint("fk_questions_skill_id_skills", "questions", type_="foreignkey")
    op.drop_column("questions", "irt_discrimination")
    op.drop_column("questions", "irt_difficulty")
    op.drop_column("questions", "skill_id")
    op.drop_column("questions", "answer_key")
    op.drop_column("questions", "options")
    op.drop_constraint("ck_submissions_status", "submissions", type_="check")
    op.drop_constraint("ck_processing_jobs_status", "processing_jobs", type_="check")
    op.drop_constraint("ck_questions_status", "questions", type_="check")
    op.drop_constraint("ck_questions_type", "questions", type_="check")
    op.drop_constraint("ck_materials_status", "materials", type_="check")
    op.drop_constraint("ck_materials_kind", "materials", type_="check")
    op.drop_constraint("ck_course_members_role", "course_members", type_="check")
    op.drop_constraint("ck_courses_status", "courses", type_="check")
    op.drop_constraint("ck_profiles_role", "profiles", type_="check")
    op.drop_constraint("uq_course_membership", "course_members", type_="unique")
    op.create_unique_constraint(
        "course_members_course_id_profile_id_key", "course_members", ["course_id", "profile_id"]
    )
