from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditEvent


def record_event(
    db: AsyncSession,
    actor_id: str,
    action: str,
    entity_type: str = "",
    entity_id: str | None = None,
    course_id: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(AuditEvent(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        course_id=course_id,
        details=details or {},
    ))
