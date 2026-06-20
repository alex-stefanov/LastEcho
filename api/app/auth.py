"""Server-side admin authentication.

The admin (outreach-queue) and triage routers are gated by `verify_admin`,
which checks an `X-Admin-Token` bearer token against the configured admin token.
Tokens are issued by POST /api/admin/login (see routers/admin_auth.py) in
exchange for the admin username + password. This replaces the previous
client-side-only check, which could be bypassed from the browser console.

Fail closed: if no admin password is configured, both login and every gated
endpoint return 503 rather than silently allowing access.
"""

from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from .config import settings


def verify_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """FastAPI dependency: allow the request only if it carries a valid admin
    token. Attach via `include_router(..., dependencies=[Depends(verify_admin)])`."""
    if not settings.admin_configured:
        raise HTTPException(
            status_code=503,
            detail="Admin access is not configured. Set LASTECHO_ADMIN_PASSWORD.",
        )
    if not x_admin_token or not secrets.compare_digest(x_admin_token, settings.admin_token):
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")
