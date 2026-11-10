"""Create the original Socrite teacher schema."""

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    statements = (
        """CREATE TABLE profiles (
            id VARCHAR(128) PRIMARY KEY,
            email VARCHAR(320) NOT NULL,
            name VARCHAR(200) NOT NULL,
            role VARCHAR(20) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""",
        "CREATE UNIQUE INDEX ix_profiles_email ON profiles(email)",
        """CREATE TABLE courses (
            id VARCHAR(36) PRIMARY KEY,
            owner_id VARCHAR(128) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            title VARCHAR(200) NOT NULL,
            code VARCHAR(60) NOT NULL,
            description TEXT NOT NULL,
            credits INTEGER NOT NULL,
            academic_period VARCHAR(80) NOT NULL,
            status VARCHAR(20) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX ix_courses_owner_id ON courses(owner_id)",
        """CREATE TABLE audit_events (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) REFERENCES courses(id) ON DELETE SET NULL,
            actor_id VARCHAR(128) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            action VARCHAR(80) NOT NULL,
            entity_type VARCHAR(40) NOT NULL,
            entity_id VARCHAR(36),
            details JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX ix_audit_events_action ON audit_events(action)",
        "CREATE INDEX ix_audit_events_actor_id ON audit_events(actor_id)",
        "CREATE INDEX ix_audit_events_course_id ON audit_events(course_id)",
        "CREATE INDEX ix_audit_events_created_at ON audit_events(created_at)",
        """CREATE TABLE course_members (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            profile_id VARCHAR(128) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL,
            CONSTRAINT course_members_course_id_profile_id_key UNIQUE(course_id, profile_id)
        )""",
        "CREATE INDEX ix_course_members_course_id ON course_members(course_id)",
        "CREATE INDEX ix_course_members_profile_id ON course_members(profile_id)",
        """CREATE TABLE course_settings (
            course_id VARCHAR(36) PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
            socratic_mode BOOLEAN NOT NULL,
            human_review_required BOOLEAN NOT NULL,
            attempts_before_solution INTEGER NOT NULL,
            monthly_ai_budget INTEGER NOT NULL
        )""",
        """CREATE TABLE material_folders (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            name VARCHAR(160) NOT NULL,
            position INTEGER NOT NULL
        )""",
        "CREATE INDEX ix_material_folders_course_id ON material_folders(course_id)",
        """CREATE TABLE units (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            title VARCHAR(200) NOT NULL,
            outcome TEXT NOT NULL,
            position INTEGER NOT NULL,
            weeks VARCHAR(80) NOT NULL,
            hours INTEGER NOT NULL
        )""",
        "CREATE INDEX ix_units_course_id ON units(course_id)",
        """CREATE TABLE materials (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            folder_id VARCHAR(36) REFERENCES material_folders(id) ON DELETE SET NULL,
            unit_id VARCHAR(36) REFERENCES units(id) ON DELETE SET NULL,
            uploader_id VARCHAR(128) NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
            name VARCHAR(255) NOT NULL,
            kind VARCHAR(20) NOT NULL,
            object_key VARCHAR(1024),
            url VARCHAR(2048),
            content_type VARCHAR(180) NOT NULL,
            size_bytes INTEGER NOT NULL,
            status VARCHAR(20) NOT NULL,
            error TEXT,
            chunk_count INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX ix_materials_course_id ON materials(course_id)",
        """CREATE TABLE skills (
            id VARCHAR(36) PRIMARY KEY,
            unit_id VARCHAR(36) NOT NULL REFERENCES units(id) ON DELETE CASCADE,
            title VARCHAR(240) NOT NULL,
            description TEXT NOT NULL,
            position INTEGER NOT NULL
        )""",
        "CREATE INDEX ix_skills_unit_id ON skills(unit_id)",
        """CREATE TABLE unit_topics (
            id VARCHAR(36) PRIMARY KEY,
            unit_id VARCHAR(36) NOT NULL REFERENCES units(id) ON DELETE CASCADE,
            title VARCHAR(240) NOT NULL,
            position INTEGER NOT NULL
        )""",
        "CREATE INDEX ix_unit_topics_unit_id ON unit_topics(unit_id)",
        """CREATE TABLE material_chunks (
            id VARCHAR(36) PRIMARY KEY,
            material_id VARCHAR(36) NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            page_number INTEGER,
            content TEXT NOT NULL,
            embedding VECTOR(1536)
        )""",
        "CREATE INDEX ix_material_chunks_material_id ON material_chunks(material_id)",
        """CREATE TABLE processing_jobs (
            id VARCHAR(36) PRIMARY KEY,
            material_id VARCHAR(36) NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL,
            attempts INTEGER NOT NULL,
            error TEXT,
            claimed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX ix_processing_jobs_material_id ON processing_jobs(material_id)",
        "CREATE INDEX ix_processing_jobs_status ON processing_jobs(status)",
        """CREATE TABLE questions (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            unit_id VARCHAR(36) REFERENCES units(id) ON DELETE SET NULL,
            prompt TEXT NOT NULL,
            question_type VARCHAR(30) NOT NULL,
            rubric JSONB NOT NULL,
            status VARCHAR(20) NOT NULL,
            source_material_id VARCHAR(36) REFERENCES materials(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX ix_questions_course_id ON questions(course_id)",
        """CREATE TABLE submissions (
            id VARCHAR(36) PRIMARY KEY,
            course_id VARCHAR(36) NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            student_id VARCHAR(128) NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            question_id VARCHAR(36) REFERENCES questions(id) ON DELETE SET NULL,
            response TEXT NOT NULL,
            suggested_score INTEGER,
            final_score INTEGER,
            teacher_comment TEXT,
            status VARCHAR(20) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""",
        "CREATE INDEX ix_submissions_course_id ON submissions(course_id)",
        "CREATE INDEX ix_submissions_status ON submissions(status)",
        "CREATE INDEX ix_submissions_student_id ON submissions(student_id)",
    )
    for statement in statements:
        op.execute(statement)


def downgrade() -> None:
    for table in (
        "submissions", "questions", "processing_jobs", "material_chunks", "unit_topics", "skills",
        "materials", "units", "material_folders", "course_settings", "course_members",
        "audit_events", "courses", "profiles",
    ):
        op.execute(f'DROP TABLE "{table}"')
