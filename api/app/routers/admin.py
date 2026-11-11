from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin, revoke_user_sessions
from app.config import settings
from app.db import get_db
from app.models import StudentAllowlist, User
from app.schemas import StudentAllowlistCreate, StudentAllowlistOut

router = APIRouter(prefix="/admin", tags=["administration"])


@router.get("/student-allowlist", response_model=list[StudentAllowlistOut])
async def list_student_allowlist(
    _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = (await db.execute(
        select(StudentAllowlist, User)
        .outerjoin(User, (User.email == StudentAllowlist.email) & (User.role == "student"))
        .order_by(StudentAllowlist.email)
    )).all()
    return [{
        "id": entry.id,
        "email": entry.email,
        "created_at": entry.created_at,
        "registered": user is not None,
        "student_name": user.full_name if user else None,
    } for entry, user in rows]


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
    entry_id: str, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
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
    await db.delete(entry)
    await db.commit()
