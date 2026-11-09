from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import authenticated_claims, sync_profile
from app.db import get_db
from app.models import Profile
from app.schemas import ProfileOut

router = APIRouter(prefix="/me", tags=["account"])


@router.post("/sync", response_model=ProfileOut)
async def sync_account(
    profile: Profile = Depends(sync_profile),
) -> Profile:
    return profile


@router.get("", response_model=ProfileOut)
async def get_me(
    claims: dict = Depends(authenticated_claims), db: AsyncSession = Depends(get_db),
) -> Profile:
    return await sync_profile(claims, db)
