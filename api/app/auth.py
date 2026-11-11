import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.db import get_db
from app.models import AuthSession, StudentAllowlist, User

SESSION_COOKIE = "socrite_session"
SESSION_TTL = timedelta(days=7)
SESSION_TTL_SECONDS = int(SESSION_TTL.total_seconds())
LOGIN_FAILURE_LIMIT = 5
LOGIN_LOCK_DURATION = timedelta(minutes=15)
LAST_SEEN_INTERVAL = timedelta(minutes=5)

password_hasher = PasswordHasher()
DUMMY_PASSWORD_HASH = password_hasher.hash("socrite-invalid-login-placeholder")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def hash_password(password: str) -> str:
    return await run_in_threadpool(password_hasher.hash, password)


async def verify_password(password: str, hashed_password: str) -> bool:
    try:
        return await run_in_threadpool(password_hasher.verify, hashed_password, password)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        return False


async def registration_role(email: str, db: AsyncSession) -> str | None:
    if email in settings.admin_email_set:
        return "admin"
    if email in settings.teacher_email_set:
        return "teacher"
    allowed = await db.scalar(
        select(StudentAllowlist.id).where(StudentAllowlist.email == email).with_for_update()
    )
    return "student" if allowed else None


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=settings.app_env.casefold() == "production",
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=settings.app_env.casefold() == "production",
        samesite="lax",
        path="/",
    )


async def create_session(user: User, request: Request, response: Response, db: AsyncSession) -> None:
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    db.add(AuthSession(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=now + SESSION_TTL,
        last_seen_at=now,
        user_agent=request.headers.get("user-agent", "")[:512] or None,
        ip_address=request.client.host if request.client else None,
    ))
    user.last_login_at = now
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()
    set_session_cookie(response, token)


async def current_session(
    request: Request, db: AsyncSession = Depends(get_db),
) -> AuthSession:
    token = request.cookies.get(SESSION_COOKIE, "")
    if not token or len(token) > 256:
        raise HTTPException(status_code=401, detail="Inicia sesión para continuar")
    session = await db.scalar(
        select(AuthSession).where(AuthSession.token_hash == hash_token(token))
    )
    now = datetime.now(UTC)
    if session is None:
        raise HTTPException(status_code=401, detail="La sesión no es válida")
    if session.expires_at <= now:
        await db.delete(session)
        await db.commit()
        raise HTTPException(status_code=401, detail="La sesión expiró")
    user = await db.get(User, session.user_id)
    if user is None or not user.is_active:
        await db.delete(session)
        await db.commit()
        raise HTTPException(status_code=401, detail="La cuenta no está activa")
    if session.last_seen_at <= now - LAST_SEEN_INTERVAL:
        session.last_seen_at = now
        await db.commit()
    return session


async def current_user(
    session: AuthSession = Depends(current_session), db: AsyncSession = Depends(get_db),
) -> User:
    user = await db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="La cuenta no está activa")
    return user


async def require_teacher(user: User = Depends(current_user)) -> User:
    if user.role not in {"admin", "teacher"}:
        raise HTTPException(status_code=403, detail="Se requiere acceso docente")
    return user


async def require_student(user: User = Depends(current_user)) -> User:
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Se requiere acceso de estudiante")
    return user


async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Se requiere acceso de administración")
    return user


async def revoke_user_sessions(db: AsyncSession, user_id: str) -> None:
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
