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


def _client_of(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class _SlidingWindow:
    """Per-client sliding-window counter. Self-pruning: empty/stale buckets are
    swept at most once per window so an attacker rotating source IPs can't grow
    the dict without bound (a slow memory-exhaustion DoS)."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = 0.0

    def check(self, client: str, limit: int) -> None:
        if limit <= 0:
            return
        now = time.monotonic()
        cutoff = now - _WINDOW_SECONDS
        with self._lock:
            # Periodic global sweep: drop buckets whose newest hit is already
            # stale, bounding memory to the IPs actually active this window.
            if now - self._last_sweep >= _WINDOW_SECONDS:
                self._last_sweep = now
                for key in [k for k, b in self._hits.items() if not b or b[-1] <= cutoff]:
                    del self._hits[key]

            bucket = self._hits[client]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                raise HTTPException(status_code=429, detail="Too many requests — slow down.")
            bucket.append(now)


_public = _SlidingWindow()
_login = _SlidingWindow()


def rate_limit(request: Request) -> None:
    """FastAPI dependency: 429 once a client exceeds the configured per-minute cap."""
    _public.check(_client_of(request), settings.rate_limit_per_min)


def login_rate_limit(request: Request) -> None:
    """Stricter dependency for the admin login route — throttles password guessing
    on a separate, much smaller budget than the public read endpoints."""
    _login.check(_client_of(request), settings.admin_login_rate_limit_per_min)
