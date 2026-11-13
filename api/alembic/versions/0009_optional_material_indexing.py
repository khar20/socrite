"""Allow uploaded materials to skip indexing."""

import sqlalchemy as sa

from alembic import op

revision = "0009_optional_material_indexing"
down_revision = "0008_uppercase_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "materials",
        sa.Column("index_on_upload", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("materials", "index_on_upload")
