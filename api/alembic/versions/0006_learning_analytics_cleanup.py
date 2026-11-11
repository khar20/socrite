"""Persist learning evidence and make material cleanup retryable."""

import sqlalchemy as sa

from alembic import op

revision = "0006_learning_analytics_cleanup"
down_revision = "0005_database_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_materials_status", "materials", type_="check")
    op.create_check_constraint(
        "ck_materials_status", "materials",
        "status IN ('uploading', 'queued', 'processing', 'ready', 'failed', 'deleting')",
    )
    op.add_column(
        "materials",
        sa.Column("deletion_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("materials", sa.Column("deletion_retry_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("ai_usage_events", "estimated_cost", existing_type=sa.Float(), nullable=True)

    op.create_table(
        "learning_evidence_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("student_id", sa.String(length=128), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", sa.String(length=36), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", sa.String(length=36), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.String(length=36), sa.ForeignKey("questions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assessment_id", sa.String(length=36), sa.ForeignKey("assessments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("attempt_id", sa.String(length=36), sa.ForeignKey("assessment_attempts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("evidence_type", sa.String(length=32), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("is_transfer", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("confidence", sa.SmallInteger(), nullable=True),
        sa.Column("probability_before", sa.Float(), nullable=False),
        sa.Column("probability_after", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("probability_before BETWEEN 0 AND 1", name="ck_learning_evidence_before"),
        sa.CheckConstraint("probability_after BETWEEN 0 AND 1", name="ck_learning_evidence_after"),
        sa.CheckConstraint("confidence IS NULL OR confidence BETWEEN 0 AND 2", name="ck_learning_evidence_confidence"),
    )
    for column in ("student_id", "course_id", "skill_id", "created_at"):
        op.create_index(f"ix_learning_evidence_events_{column}", "learning_evidence_events", [column])

    op.create_table(
        "spaced_review_events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("student_id", sa.String(length=128), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", sa.String(length=36), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", sa.String(length=36), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("due_at_before", sa.DateTime(timezone=True), nullable=False),
        sa.Column("interval_days", sa.Integer(), nullable=False),
        sa.Column("mastery_probability", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("rating BETWEEN 0 AND 3", name="ck_spaced_review_rating"),
        sa.CheckConstraint("interval_days >= 1", name="ck_spaced_review_event_interval"),
    )
    for column in ("student_id", "course_id", "skill_id", "created_at"):
        op.create_index(f"ix_spaced_review_events_{column}", "spaced_review_events", [column])


def downgrade() -> None:
    for column in ("created_at", "skill_id", "course_id", "student_id"):
        op.drop_index(f"ix_spaced_review_events_{column}", table_name="spaced_review_events")
    op.drop_table("spaced_review_events")
    for column in ("created_at", "skill_id", "course_id", "student_id"):
        op.drop_index(f"ix_learning_evidence_events_{column}", table_name="learning_evidence_events")
    op.drop_table("learning_evidence_events")

    op.alter_column("ai_usage_events", "estimated_cost", existing_type=sa.Float(), nullable=False)
    op.drop_column("materials", "deletion_retry_at")
    op.drop_column("materials", "deletion_attempts")
    op.drop_constraint("ck_materials_status", "materials", type_="check")
    op.create_check_constraint(
        "ck_materials_status", "materials",
        "status IN ('uploading', 'queued', 'processing', 'ready', 'failed')",
    )
