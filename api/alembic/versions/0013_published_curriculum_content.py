"""Add approval state and source references to topics and skills."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0013_curriculum_publish"
down_revision = "0012_question_source_refs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("unit_topics", "skills"):
        op.add_column(table, sa.Column("status", sa.String(20), nullable=False, server_default="published"))
        op.alter_column(table, "status", server_default="draft")
        op.create_check_constraint(f"ck_{table}_status", table, "status IN ('draft', 'published')")
        op.add_column(table, sa.Column(
            "source_refs", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ))


def downgrade() -> None:
    for table in ("skills", "unit_topics"):
        op.drop_constraint(f"ck_{table}_status", table, type_="check")
        op.drop_column(table, "source_refs")
        op.drop_column(table, "status")
