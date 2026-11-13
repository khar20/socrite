"""Uppercase names and course metadata."""

from alembic import op

revision = "0008_uppercase_names"
down_revision = "0007_remove_ai_usage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE users SET "
        "first_name = upper(btrim(first_name)), "
        "paternal_last_name = upper(btrim(paternal_last_name)), "
        "maternal_last_name = upper(btrim(maternal_last_name))"
    )
    op.execute(
        "UPDATE courses SET "
        "title = upper(btrim(title)), "
        "code = upper(btrim(code)), "
        "academic_period = upper(btrim(academic_period))"
    )
    op.execute("UPDATE units SET title = upper(btrim(title))")
    op.execute("UPDATE unit_topics SET title = upper(btrim(title))")
    op.execute("UPDATE skills SET title = upper(btrim(title))")
    op.execute("UPDATE assessments SET title = upper(btrim(title))")


def downgrade() -> None:
    pass
