"""Replace external auth profiles with database users and sessions."""

import sqlalchemy as sa

from alembic import op

revision = "0005_database_auth"
down_revision = "0004_processing_lease"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("profiles", "users")
    op.execute("ALTER TABLE users RENAME CONSTRAINT profiles_pkey TO users_pkey")
    op.execute("ALTER TABLE users RENAME CONSTRAINT ck_profiles_role TO ck_users_role")
    op.execute("ALTER INDEX ix_profiles_email RENAME TO ix_users_email")

    op.drop_column("users", "name")
    op.add_column("users", sa.Column("first_name", sa.String(length=100), nullable=False))
    op.add_column("users", sa.Column("paternal_last_name", sa.String(length=100), nullable=False))
    op.add_column("users", sa.Column("maternal_last_name", sa.String(length=100), nullable=False))
    op.add_column("users", sa.Column("hashed_password", sa.String(length=255), nullable=False))
    op.add_column("users", sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("failed_login_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "ck_users_failed_login_attempts", "users", "failed_login_attempts >= 0",
    )

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])
    op.create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True)

    op.create_table(
        "student_allowlist",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("added_by", sa.String(length=128), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_student_allowlist_email", "student_allowlist", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_student_allowlist_email", table_name="student_allowlist")
    op.drop_table("student_allowlist")
    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_expires_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")

    op.drop_constraint("ck_users_failed_login_attempts", "users", type_="check")
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_attempts")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "is_active")
    op.drop_column("users", "hashed_password")
    op.drop_column("users", "maternal_last_name")
    op.drop_column("users", "paternal_last_name")
    op.drop_column("users", "first_name")
    op.add_column("users", sa.Column("name", sa.String(length=200), nullable=False, server_default=""))
    op.execute("ALTER TABLE users RENAME CONSTRAINT ck_users_role TO ck_profiles_role")
    op.execute("ALTER TABLE users RENAME CONSTRAINT users_pkey TO profiles_pkey")
    op.execute("ALTER INDEX ix_users_email RENAME TO ix_profiles_email")
    op.rename_table("users", "profiles")
