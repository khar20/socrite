from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AIUsageEvent, CourseSettings


def token_count(usage: dict, *keys: str) -> int:
    for key in keys:
        value = usage.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return 0


def has_token_count(usage: dict, *keys: str) -> bool:
    return any(isinstance(usage.get(key), int) and not isinstance(usage.get(key), bool)
               and usage[key] >= 0 for key in keys)


def estimated_cost(feature: str, input_tokens: int, output_tokens: int) -> float | None:
    if feature.endswith("embedding"):
        rate = settings.ai_embedding_usd_per_million
        return round(input_tokens * rate / 1_000_000, 10) if rate is not None else None
    if settings.ai_chat_input_usd_per_million is None or settings.ai_chat_output_usd_per_million is None:
        return None
    return round((input_tokens * settings.ai_chat_input_usd_per_million
                  + output_tokens * settings.ai_chat_output_usd_per_million) / 1_000_000, 10)


def record_ai_usage(
    db: AsyncSession,
    *,
    actor_id: str,
    course_id: str,
    feature: str,
    model: str,
    usage: dict,
) -> AIUsageEvent:
    input_tokens = token_count(usage, "prompt_tokens", "input_tokens")
    output_tokens = token_count(usage, "completion_tokens", "output_tokens")
    complete_usage = has_token_count(usage, "prompt_tokens", "input_tokens") and (
        feature.endswith("embedding")
        or has_token_count(usage, "completion_tokens", "output_tokens")
    )
    event = AIUsageEvent(
        actor_id=actor_id,
        course_id=course_id,
        feature=feature,
        provider="openai-compatible",
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        estimated_cost=estimated_cost(feature, input_tokens, output_tokens) if complete_usage else None,
    )
    db.add(event)
    return event


async def enforce_course_budget(db: AsyncSession, course_id: str) -> None:
    if not settings.ai_cost_rates_configured:
        return
    course_settings = await db.get(CourseSettings, course_id)
    budget = course_settings.monthly_ai_budget if course_settings else 150
    now = datetime.now(UTC)
    month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    spent = await db.scalar(
        select(func.coalesce(func.sum(AIUsageEvent.estimated_cost), 0)).where(
            AIUsageEvent.course_id == course_id,
            AIUsageEvent.created_at >= month_start,
        )
    ) or 0
    if spent >= budget:
        raise HTTPException(status_code=429, detail="El curso alcanzó su presupuesto mensual estimado de IA")
