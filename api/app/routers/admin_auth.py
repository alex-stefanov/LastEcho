"""Admin login — exchanges username + password for the admin bearer token.

The token returned here is sent by the client as the `X-Admin-Token` header on
every admin/triage call (see auth.verify_admin). Credentials are verified
server-side with constant-time comparison; nothing about them ships in the
client bundle.
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import settings

router = APIRouter(prefix="/api/admin", tags=["admin"])


class LoginRequest(BaseModel):
    user: str
    password: str


class LoginResponse(BaseModel):
    token: str


@router.post("/login", response_model=LoginResponse, summary="Exchange credentials for an admin token")
def login(body: LoginRequest) -> LoginResponse:
    if not settings.admin_configured:
        raise HTTPException(
            status_code=503,
            detail="Admin access is not configured. Set LASTECHO_ADMIN_PASSWORD.",
        )
    # Constant-time on both fields so timing can't reveal a correct username.
    user_ok = secrets.compare_digest(body.user, settings.admin_user)
    pw_ok = secrets.compare_digest(body.password, settings.admin_password or "")
    if not (user_ok and pw_ok):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return LoginResponse(token=settings.admin_token)
