# Socrite

Socrite is a teacher-first platform for university mathematics and science courses. Instructors define a course's academic structure with units, topics, and skills; organize materials and upload documents; create and approve open questions, including AI-assisted drafts grounded in processed course material; and review student submissions with final scores and feedback. Activity and audit logs record changes made within each course.

The platform is designed around active learning—active recall, spaced repetition, Socratic questioning, self-explanation, and problem-based practice—so students build understanding instead of relying on AI assistants for answers. The current release implements the instructor workspace; student-facing learning workflows are not yet available.

Socrite is built as a Vite + React frontend with a FastAPI backend, using Neon PostgreSQL, Neon Managed Auth, and Neon Object Storage. The original `socrite.html` prototype is kept in the repository as a visual and behavior reference.

## Requirements

- Node.js 20.19+ and pnpm
- Python 3.11+ and uv
- A Neon project with PostgreSQL, Managed Auth, and Object Storage
- An OpenAI-compatible API key for AI features (optional)

## Configuration

Create the root environment file from the template:

```sh
cp .env.example .env
```

Fill in the values in `.env`:

- `DATABASE_URL`, `DATABASE_URL_UNPOOLED`: Neon PostgreSQL connection strings. Use the pooled URL for app traffic and the direct (non-pooler) URL for Alembic migrations.
- `NEON_AUTH_URL`, `NEON_AUTH_JWKS_URL`, `VITE_NEON_AUTH_URL`: Neon Managed Auth endpoints. For every environment/branch, enable email/password, OTP verification, **Require Verification**, and **Send Verification Email on Sign-up** in Neon Auth settings. Teacher access is rejected unless the verified-email JWT claim is true.
- `NEON_STORAGE_BUCKET`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: private Neon Object Storage bucket and credentials.
- `AI_BASE_URL`, `AI_API_KEY`, `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`: OpenAI-compatible provider. Leave the key as a placeholder to run without AI.
- `TEACHER_EMAILS`: comma-separated email addresses allowed into the teacher area.
- `VITE_API_URL`: backend API URL, defaulting to `http://localhost:8000/api/v1`.
- `CORS_ORIGINS`, `MAX_UPLOAD_MB`, `APP_ENV`: application settings.

The root `.env` is ignored by git. Only `VITE_*` variables are exposed to browser code, so never store secrets in them.
Add each deployed frontend origin to Neon Auth's trusted domains and to `CORS_ORIGINS`.

## Run locally

Start the API:

```sh
cd api
uv sync --group dev
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

To process uploaded materials, run the worker in another terminal:

```sh
cd api
uv run python worker.py
```

Start the frontend:

```sh
cd web
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Sign in with a Neon Auth account whose email is listed in `TEACHER_EMAILS` to access the teacher area.
