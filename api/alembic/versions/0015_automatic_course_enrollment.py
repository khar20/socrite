"""Remove invitations and enroll authorized students in the MVP course."""

import sqlalchemy as sa

from alembic import op

revision = "0015_automatic_course_enrollment"
down_revision = "0014_assessment_question_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        INSERT INTO course_members (id, course_id, profile_id, role)
        SELECT gen_random_uuid()::text, course.id, student.id, 'student'
        FROM courses AS course
        JOIN users AS student ON student.role = 'student' AND student.is_active IS TRUE
        JOIN student_allowlist AS allowed ON allowed.email = student.email
        WHERE course.status <> 'archived'
          AND (SELECT count(*) FROM courses WHERE status <> 'archived') = 1
        ON CONFLICT (course_id, profile_id) DO NOTHING
    """))
    op.drop_table("course_invitations")


def downgrade() -> None:
    op.create_table(
        "course_invitations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("course_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("invited_by", sa.String(length=128), nullable=False),
        sa.Column("accepted_by", sa.String(length=128), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'revoked', 'expired')",
            name="ck_course_invitations_status",
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["accepted_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_course_invitations_course_id", "course_invitations", ["course_id"])
    op.create_index(
        "uq_course_invitations_pending", "course_invitations", ["course_id", "email"],
        unique=True, postgresql_where=sa.text("status = 'pending'"),
    )
