"""Add topic links and assessment-only question scope."""

import sqlalchemy as sa

from alembic import op

revision = "0014_assessment_question_scope"
down_revision = "0013_curriculum_publish"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("topic_id", sa.String(length=36), nullable=True))
    op.create_foreign_key(
        "fk_questions_topic_id_unit_topics", "questions", "unit_topics",
        ["topic_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_questions_topic_id", "questions", ["topic_id"])
    op.add_column(
        "questions", sa.Column("bank_visible", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("questions", "bank_visible")
    op.drop_index("ix_questions_topic_id", table_name="questions")
    op.drop_constraint("fk_questions_topic_id_unit_topics", "questions", type_="foreignkey")
    op.drop_column("questions", "topic_id")
