from functools import lru_cache
from urllib.parse import urlparse

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models import Profile

bearer = HTTPBearer(auto_error=False)


@lru_cache(maxsize=1)
def jwks_client() -> PyJWKClient:
    if not settings.neon_auth_jwks_url or "YOUR-" in settings.neon_auth_jwks_url:
        raise HTTPException(status_code=503, detail="Neon Auth is not configured")
    return PyJWKClient(settings.neon_auth_jwks_url, cache_keys=True)


def verify_token(token: str) -> dict:
    if not settings.neon_auth_url or "YOUR-" in settings.neon_auth_url:
        raise HTTPException(status_code=503, detail="Neon Auth is not configured")
    try:
        key = jwks_client().get_signing_key_from_jwt(token).key
        issuer = f"{urlparse(settings.neon_auth_url).scheme}://{urlparse(settings.neon_auth_url).netloc}"
        return jwt.decode(token, key, algorithms=["EdDSA"], issuer=issuer, audience=issuer)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token") from exc


def role_for_email(email: str) -> str:
    return "teacher" if email.strip().casefold() in settings.teacher_email_set else "student"


async def authenticated_claims(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    if credentials is None or credentials.scheme.casefold() != "bearer":
        raise HTTPException(status_code=401, detail="Sign in to continue")
    return verify_token(credentials.credentials)


async def sync_profile(
    claims: dict = Depends(authenticated_claims), db: AsyncSession = Depends(get_db),
) -> Profile:
    profile_id = claims.get("sub")
    email = str(claims.get("email", "")).strip().casefold()
    if not profile_id or not email:
        raise HTTPException(status_code=401, detail="The access token has no user email")
    result = await db.execute(select(Profile).where(Profile.id == str(profile_id)))
    profile = result.scalar_one_or_none()
    role = role_for_email(email)
    if profile is None:
        profile = Profile(id=str(profile_id), email=email, name=str(claims.get("name") or ""), role=role)
        db.add(profile)
    else:
        profile.email = email
        profile.name = str(claims.get("name") or profile.name)
        profile.role = role
    await db.commit()
    await db.refresh(profile)
    return profile


async def current_profile(
    claims: dict = Depends(authenticated_claims), db: AsyncSession = Depends(get_db),
) -> Profile:
    profile_id = claims.get("sub")
    if not profile_id:
        raise HTTPException(status_code=401, detail="Invalid access token")
    result = await db.execute(select(Profile).where(Profile.id == str(profile_id)))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=403, detail="Synchronize your account before continuing")
    return profile


async def require_teacher(profile: Profile = Depends(current_profile)) -> Profile:
    if profile.email.casefold() not in settings.teacher_email_set or profile.role != "teacher":
        raise HTTPException(status_code=403, detail="Teacher access is not enabled for this account")
    return profile
