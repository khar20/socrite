"""Make OCR an explicit material processing option."""

import sqlalchemy as sa

from alembic import op

revision = "0010_optional_material_ocr"
down_revision = "0009_optional_material_indexing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "materials",
        sa.Column("ocr_on_upload", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("materials", "ocr_on_upload")
