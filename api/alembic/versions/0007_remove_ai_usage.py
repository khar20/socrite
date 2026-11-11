"""Remove AI usage tracking and course budgets."""

import sqlalchemy as sa

from alembic import op

revision = "0007_remove_ai_usage"
down_revision = "0006_learning_analytics_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("ai_usage_events")
    op.drop_column("course_settings", "monthly_ai_budget")
    op.drop_column("tutor_messages", "input_tokens")
    op.drop_column("tutor_messages", "output_tokens")


def downgrade() -> None:
    op.add_column("tutor_messages", sa.Column("output_tokens", sa.Integer(), nullable=True))
    op.add_column("tutor_messages", sa.Column("input_tokens", sa.Integer(), nullable=True))
    op.add_column(
        "course_settings",
        sa.Column("monthly_ai_budget", sa.Integer(), server_default=sa.text("150"), nullable=False),
    )
    op.alter_column("course_settings", "monthly_ai_budget", server_default=None)

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
        sa.Column("estimated_cost", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_ai_usage_events_course_id", "ai_usage_events", ["course_id"])
    op.create_index("ix_ai_usage_events_actor_id", "ai_usage_events", ["actor_id"])
    op.create_index("ix_ai_usage_events_created_at", "ai_usage_events", ["created_at"])
