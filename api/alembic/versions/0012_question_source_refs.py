"""Add source references to generated questions."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012_question_source_refs"
down_revision = "0011_student_data_consent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "questions",
        sa.Column(
            "source_refs",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("questions", "source_refs")
