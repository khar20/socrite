"""Index material embeddings for semantic retrieval."""

from alembic import op

revision = "0003_material_vector_index"
down_revision = "0002_student_learning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_material_chunks_embedding_hnsw",
        "material_chunks",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_material_chunks_embedding_hnsw", table_name="material_chunks")
