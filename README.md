# Socrite

Socrite is a teacher-first platform for university mathematics and science courses. Instructors define a course's academic structure with units, topics, and skills; organize materials and upload documents; create and approve open questions, including AI-assisted drafts grounded in processed course material; and review student submissions with final scores and feedback. Activity and audit logs record changes made within each course.

The platform is designed around active learning—active recall, spaced repetition, Socratic questioning, self-explanation, transfer practice, and metacognitive reflection. Student answers create timestamped skill evidence; BKT estimates mastery, while a due/weak-skill selector uses teacher-set IRT parameters to recommend an assessment. Open-response AI scoring is only a rubric-based suggestion; a teacher must set the final score. DKT and experimental validation remain future research work.

When an OpenAI-compatible provider is configured (OpenRouter by default), the tutor uses RAG over course materials, cites retrieved sources, asks progressive questions, and avoids deciding mastery. AI output remains unavailable until the provider key and compatible 1536-dimensional embedding model are configured.

At the start of a course the student is directed to a diagnostic when no skill evidence exists. The next-activity selector then prioritizes overdue or weak skills and, when mastery estimates are strong, a transfer assessment. It uses assessment kind, BKT evidence, and teacher-entered IRT difficulty/discrimination. Only auto-graded results or teacher-confirmed open-response scores update BKT; review self-ratings are stored separately. The teacher's course analytics view shows cohort heatmaps, transfer evidence, and retention self-reports.

Socrite is built as a Vite + React frontend with a FastAPI backend, using PostgreSQL for application data and database-backed accounts/sessions, plus Neon Object Storage for private uploads. The original `socrite.html` prototype is kept in the repository as a visual and behavior reference.

## Requirements

- Node.js 20.19+ and pnpm
- Python 3.11+ and uv
- PostgreSQL and an S3-compatible Neon Object Storage bucket
- An OpenAI-compatible provider for AI features (optional; OpenRouter by default)

## Configuration

Create the root environment file from the template:

```sh
cp .env.example .env
```

Fill in the values in `.env`:

- `DATABASE_URL`: PostgreSQL connection string used by the API and Alembic. Use a direct PostgreSQL connection URL.
- `NEON_STORAGE_BUCKET`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: private Neon Object Storage bucket and credentials.
- `AI_BASE_URL`, `AI_API_KEY`, `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`: OpenAI-compatible provider. OpenRouter is the default: `AI_BASE_URL=https://openrouter.ai/api/v1`, with model IDs such as `openai/gpt-4o-mini` and `openai/text-embedding-3-small`. Change these variables to use another compatible provider or model without code changes. Leave the API key as a placeholder to run without AI.
- AI requests run only in the FastAPI backend and worker. The key is never sent to the frontend or exposed through `VITE_*` variables.
- In production, the API validates `APP_ENV`, requires `DATABASE_URL`, rejects placeholder secrets, and requires explicit HTTPS CORS origins. The frontend build allows only `VITE_API_URL` as a public variable.
- `ABANDONED_UPLOAD_HOURS`: time an uncompleted upload remains before the worker removes it; defaults to 24 hours.
- `ADMIN_EMAILS`: comma-separated bootstrap administrator addresses. Admins can manage student registration emails.
- `TEACHER_EMAILS`: comma-separated teacher addresses allowed to register.
- Student registrations are allowed only for addresses in the admin-managed `student_allowlist` table.
- Accounts use Argon2id password hashes and opaque, server-side PostgreSQL sessions in HttpOnly cookies.
- The worker removes abandoned uploads after `ABANDONED_UPLOAD_HOURS` and retries failed object deletions with backoff; deleting materials remain visible until storage confirms removal.
- Instructors can view the course cohort heatmap and evidence-based progress reports.
- `VITE_API_URL`: backend API URL, defaulting to `http://localhost:8000/api/v1`.
- `CORS_ORIGINS`, `MAX_UPLOAD_MB`, `APP_ENV`: application settings.

The root `.env` is ignored by git. Only `VITE_*` variables are exposed to browser code, so never store secrets in them.
Set `CORS_ORIGINS` to the exact frontend origins that may use the API. Use HTTPS and `APP_ENV=production` in production so session cookies are marked Secure.

## Run locally

Start the API:

```sh
cd api
uv sync --group dev
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Before running migrations, make sure `DATABASE_URL` targets the intended development branch. The same direct connection is used by the API and migrations; do not run migrations against a shared production branch without reviewing the target.

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

Open `http://localhost:5173`. Register the administrator email from `ADMIN_EMAILS` first. The administrator can authorize student emails from **Correos autorizados**; teacher accounts can register only when their email appears in `TEACHER_EMAILS`.

## Docker Compose

Docker runs the web container, FastAPI, and the material worker. PostgreSQL and Object Storage remain managed by Neon; no database or storage secrets are baked into the images.

Apply migrations as a separate operation, then start the app:

```sh
# Ensure .env points at the intended branch before running this migration.
docker compose --profile ops run --rm migrate
docker compose up --build -d
```

Open `http://localhost:8080`. Nginx serves the SPA and proxies `/api` to FastAPI; the API is also available at `http://localhost:8000`. For production, inject `.env` values through the deployment platform's secret manager and terminate TLS at a trusted reverse proxy/load balancer.

The `migrate` service uses `DATABASE_URL`. Run it manually after reviewing the target branch; it is intentionally not an automatic API startup dependency.
