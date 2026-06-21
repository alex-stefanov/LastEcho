"""Short-lived, signed admin session tokens.

A token is `<payload>.<sig>` where `payload` is base64url(expiry-unix-seconds)
and `sig` is HMAC-SHA256(payload, key). The signing key is the configured
`admin_token` (a fresh random per-process secret unless LASTECHO_ADMIN_TOKEN
pins it).

Two properties this buys over the previous static bearer token:
- **Expiry**: each token carries its own deadline, so a leaked token stops
  working on its own after the TTL — no server restart required.
- **Revocation**: rotating the key (change LASTECHO_ADMIN_TOKEN, or just
  restart with it unset so a new random key is generated) invalidates every
  outstanding token at once.

The token is opaque to the client, which only stores and replays it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _sign(payload: str, key: str) -> str:
    digest = hmac.new(key.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    return _b64encode(digest)


def issue(key: str, ttl_seconds: int) -> str:
    """Mint a token signed with `key` that expires `ttl_seconds` from now."""
    payload = _b64encode(str(int(time.time()) + ttl_seconds).encode("ascii"))
    return f"{payload}.{_sign(payload, key)}"


def verify(token: str | None, key: str) -> bool:
    """True only if `token` is well-formed, signed with `key`, and unexpired.
    Never raises — any malformed/garbage input (including non-ASCII) is False."""
    if not token or "." not in token:
        return False
    payload, _, sig = token.partition(".")
    # Constant-time signature check before trusting the payload.
    if not hmac.compare_digest(sig, _sign(payload, key)):
        return False
    try:
        expires_at = int(_b64decode(payload).decode("ascii"))
    except Exception:  # malformed base64 / non-numeric payload -> treat as invalid
        return False
    return time.time() < expires_at
