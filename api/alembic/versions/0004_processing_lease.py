"""Add worker ownership tokens for safe lease renewal."""

import sqlalchemy as sa

from alembic import op

revision = "0004_processing_lease"
down_revision = "0003_material_vector_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("processing_jobs", sa.Column("lease_token", sa.String(length=36), nullable=True))


def downgrade() -> None:
    op.drop_column("processing_jobs", "lease_token")
