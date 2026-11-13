"""Store student research data consent."""

from alembic import op

revision = "0011_student_data_consent"
down_revision = "0010_optional_material_ocr"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN student_data_consent BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE users ADD COLUMN student_data_consent_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN student_data_consent_at")
    op.execute("ALTER TABLE users DROP COLUMN student_data_consent")
