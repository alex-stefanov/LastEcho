"""Lightweight, dependency-free per-IP rate limiting.

A sliding 60-second window keyed by client IP, applied as a FastAPI dependency
to the API routers. Bounds abuse of the public read endpoints (which can fan
out to reverse-geocoding) and brute-forcing of the admin login, without pulling
in an external rate-limit library. In-process only — for multi-process
deployments put a real limiter (e.g. at the reverse proxy) in front.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from .config import settings

_WINDOW_SECONDS = 60.0
_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def rate_limit(request: Request) -> None:
    """FastAPI dependency: 429 once a client exceeds the configured per-minute cap."""
    limit = settings.rate_limit_per_min
    if limit <= 0:
        return
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _lock:
        bucket = _hits[client]
        cutoff = now - _WINDOW_SECONDS
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="Too many requests — slow down.")
        bucket.append(now)
