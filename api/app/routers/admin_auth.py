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

from .. import tokens
from ..config import settings

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _ct_equals(a: str, b: str) -> bool:
    """Constant-time string compare that, unlike secrets.compare_digest on str,
    accepts non-ASCII input (it raises a TypeError on non-ASCII str). Comparing
    the UTF-8 bytes preserves the timing-safety while never crashing on a
    Unicode username/password supplied by an unauthenticated client."""
    return secrets.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


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
    user_ok = _ct_equals(body.user, settings.admin_user)
    pw_ok = _ct_equals(body.password, settings.admin_password or "")
    if not (user_ok and pw_ok):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # Mint a short-lived signed token rather than handing out the static signing
    # key — it expires on its own, and rotating the key revokes all tokens.
    return LoginResponse(token=tokens.issue(settings.admin_token, settings.admin_token_ttl_seconds))
