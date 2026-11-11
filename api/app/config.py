from functools import cached_property
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    app_env: str = "development"
    database_url: str = ""
    neon_storage_bucket: str = ""
    aws_endpoint_url_s3: str = ""
    aws_region: str = "us-east-2"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    ai_base_url: str = "https://openrouter.ai/api/v1"
    ai_api_key: str = ""
    ai_chat_model: str = "openai/gpt-4o-mini"
    ai_embedding_model: str = "openai/text-embedding-3-small"
    admin_emails: str = ""
    teacher_emails: str = ""
    cors_origins: str = "http://localhost:5173"
    max_upload_mb: int = 100
    abandoned_upload_hours: int = 24

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if value:
            parsed = urlsplit(value)
            if parsed.scheme in {"postgres", "postgresql", "postgresql+asyncpg"}:
                query = [("ssl" if key == "sslmode" else key, item)
                         for key, item in parse_qsl(parsed.query, keep_blank_values=True)
                         if key != "channel_binding"]
                return urlunsplit(("postgresql+asyncpg", parsed.netloc, parsed.path,
                                   urlencode(query), parsed.fragment))
        return value

    @cached_property
    def teacher_email_set(self) -> set[str]:
        return {email.strip().casefold() for email in self.teacher_emails.split(",") if email.strip()}

    @cached_property
    def admin_email_set(self) -> set[str]:
        return {email.strip().casefold() for email in self.admin_emails.split(",") if email.strip()}

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def ai_configured(self) -> bool:
        external = all(value and not value.startswith("YOUR_")
                       for value in (self.ai_base_url, self.ai_api_key))
        models = all((self.ai_chat_model, self.ai_embedding_model))
        return external and models

    @property
    def ai_request_base_url(self) -> str:
        return self.ai_base_url.rstrip("/") if self.ai_configured else ""

    @property
    def ai_request_api_key(self) -> str:
        return self.ai_api_key if self.ai_configured else ""

    @property
    def ai_provider_name(self) -> str:
        return "OpenAI-compatible provider" if self.ai_configured else ""

    @property
    def storage_configured(self) -> bool:
        values = (self.neon_storage_bucket, self.aws_endpoint_url_s3,
                  self.aws_access_key_id, self.aws_secret_access_key)
        return all(value and not value.startswith("YOUR_") for value in values)

    @property
    def database_configured(self) -> bool:
        if not self.database_url:
            return False
        parsed = urlsplit(self.database_url)
        values = (parsed.username, parsed.password, parsed.hostname, parsed.path.strip("/"))
        return parsed.scheme.startswith("postgresql") and all(
            value and value not in {"USER", "PASSWORD", "HOST", "DBNAME"} for value in values
        )


settings = Settings()
