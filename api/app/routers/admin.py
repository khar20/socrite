from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin, revoke_user_sessions
from app.config import settings
from app.db import get_db
from app.models import AuthSession, StudentAllowlist, User
from app.schemas import StudentAllowlistCreate, StudentAllowlistOut, UserActiveUpdate
from app.services.audit import record_event

router = APIRouter(prefix="/admin", tags=["administration"])


@router.get("/student-allowlist")
async def list_student_allowlist(
    limit: int = Query(default=25, ge=1, le=100), offset: int = Query(default=0, ge=0),
    _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
) -> dict:
    total = await db.scalar(select(func.count(StudentAllowlist.id))) or 0
    rows = (await db.execute(
        select(StudentAllowlist, User)
        .outerjoin(User, (User.email == StudentAllowlist.email) & (User.role == "student"))
        .order_by(StudentAllowlist.email).limit(limit).offset(offset)
    )).all()
    items = [{
        "id": entry.id,
        "email": entry.email,
        "created_at": entry.created_at,
        "registered": user is not None,
        "student_name": user.full_name if user else None,
    } for entry, user in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/student-allowlist", response_model=StudentAllowlistOut, status_code=201)
async def add_student_email(
    data: StudentAllowlistCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    email = str(data.email).strip().casefold()
    if email in settings.admin_email_set or email in settings.teacher_email_set:
        raise HTTPException(status_code=409, detail="El correo ya está autorizado como administrador o docente")
    if await db.scalar(select(StudentAllowlist.id).where(StudentAllowlist.email == email)):
        raise HTTPException(status_code=409, detail="Este correo ya está autorizado")

    user = await db.scalar(select(User).where(User.email == email).with_for_update())
    if user and user.role != "student":
        raise HTTPException(status_code=409, detail="El correo pertenece a una cuenta de personal")
    entry = StudentAllowlist(email=email, added_by=admin.id)
    db.add(entry)
    if user:
        user.is_active = True
    await db.flush()
    record_event(db, admin.id, "admin.student_allowlist.added", "student_allowlist", entry.id,
                 details={"account_registered": user is not None})
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Este correo ya está autorizado") from exc
    await db.refresh(entry)
    return {
        "id": entry.id,
        "email": entry.email,
        "created_at": entry.created_at,
        "registered": user is not None,
        "student_name": user.full_name if user else None,
    }


@router.delete("/student-allowlist/{entry_id}", status_code=204)
async def remove_student_email(
    entry_id: str, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
) -> None:
    entry = await db.scalar(
        select(StudentAllowlist).where(StudentAllowlist.id == entry_id).with_for_update()
    )
    if entry is None:
        raise HTTPException(status_code=404, detail="No se encontró el correo autorizado")
    user = await db.scalar(select(User).where(User.email == entry.email).with_for_update())
    if user and user.role == "student":
        user.is_active = False
        await revoke_user_sessions(db, user.id)
    record_event(db, admin.id, "admin.student_allowlist.removed", "student_allowlist", entry.id,
                 details={"account_deactivated": bool(user and user.role == "student")})
    await db.delete(entry)
    await db.commit()


@router.get("/users")
async def list_users(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    total = await db.scalar(select(func.count(User.id))) or 0
    users = (await db.execute(
        select(User).order_by(User.created_at.desc(), User.email).limit(limit).offset(offset)
    )).scalars().all()
    return {
        "items": [{"id": user.id, "email": user.email, "full_name": user.full_name,
                   "role": user.role, "is_active": user.is_active,
                   "created_at": user.created_at, "last_login_at": user.last_login_at}
                  for user in users],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.patch("/users/{user_id}/active")
async def set_user_active(
    user_id: str,
    data: UserActiveUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await db.execute(select(func.pg_advisory_xact_lock(8675309)))
    user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise HTTPException(status_code=404, detail="No se encontró la cuenta")
    if not data.is_active and user.id == admin.id:
        raise HTTPException(status_code=409, detail="No puedes desactivar tu propia cuenta")
    if not data.is_active and user.role == "admin":
        active_admins = await db.scalar(select(func.count(User.id)).where(
            User.role == "admin", User.is_active.is_(True),
        )) or 0
        if active_admins <= 1:
            raise HTTPException(status_code=409, detail="Debe quedar al menos un administrador activo")
    user.is_active = data.is_active
    if not data.is_active:
        await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    record_event(db, admin.id, "admin.user.activated" if data.is_active else "admin.user.deactivated",
                 "user", user.id, details={"role": user.role})
    await db.commit()
    return {"id": user.id, "is_active": user.is_active}
