from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    DUMMY_PASSWORD_HASH,
    LOGIN_FAILURE_LIMIT,
    LOGIN_LOCK_DURATION,
    SESSION_COOKIE,
    clear_session_cookie,
    create_session,
    current_user,
    hash_password,
    hash_token,
    registration_role,
    revoke_user_sessions,
    verify_password,
)
from app.db import get_db
from app.models import AuthSession, User
from app.schemas import AccountNamesIn, LoginIn, PasswordUpdate, RegisterIn, UserOut

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/register", response_model=UserOut, status_code=201)
async def register(
    data: RegisterIn, request: Request, response: Response, db: AsyncSession = Depends(get_db),
) -> User:
    email = str(data.email).strip().casefold()
    role = await registration_role(email, db)
    if role is None:
        raise HTTPException(status_code=403, detail="Este correo no está autorizado para registrarse")
    if await db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con este correo")

    user = User(
        email=email,
        first_name=data.first_name,
        paternal_last_name=data.paternal_last_name,
        maternal_last_name=data.maternal_last_name,
        role=role,
        hashed_password=await hash_password(data.password),
    )
    db.add(user)
    try:
        await db.flush()
        await create_session(user, request, response, db)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Ya existe una cuenta con este correo") from exc
    return user


@router.post("/login", response_model=UserOut)
async def login(
    data: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db),
) -> User:
    email = str(data.email).strip().casefold()
    user = await db.scalar(select(User).where(User.email == email).with_for_update())
    if user is None:
        await verify_password(data.password, DUMMY_PASSWORD_HASH)
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")

    now = datetime.now(UTC)
    if user.locked_until and user.locked_until > now:
        raise HTTPException(status_code=429, detail="Demasiados intentos. Inténtalo más tarde")

    valid_password = await verify_password(data.password, user.hashed_password)
    if not valid_password or not user.is_active:
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= LOGIN_FAILURE_LIMIT:
            user.failed_login_attempts = 0
            user.locked_until = now + LOGIN_LOCK_DURATION
            await db.commit()
            raise HTTPException(status_code=429, detail="Demasiados intentos. Inténtalo más tarde")
        await db.commit()
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")

    await create_session(user, request, response, db)
    return user


@router.post("/logout", status_code=204)
async def logout(
    request: Request, response: Response, db: AsyncSession = Depends(get_db),
) -> None:
    token = request.cookies.get(SESSION_COOKIE, "")
    if token and len(token) <= 256:
        session = await db.scalar(
            select(AuthSession).where(AuthSession.token_hash == hash_token(token))
        )
        if session:
            await db.delete(session)
            await db.commit()
    clear_session_cookie(response)


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(
    data: AccountNamesIn, user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    user.first_name = data.first_name
    user.paternal_last_name = data.paternal_last_name
    user.maternal_last_name = data.maternal_last_name
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/password", status_code=204)
async def change_password(
    data: PasswordUpdate,
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    if not await verify_password(data.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta")
    user.hashed_password = await hash_password(data.new_password)
    await revoke_user_sessions(db, user.id)
    await create_session(user, request, response, db)
