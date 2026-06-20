"""Shared FastAPI dependencies."""

from __future__ import annotations

import sqlite3
from typing import Iterator

from fastapi import Request

from . import store_db
from .config import settings
from .data import DataStore


def get_store(request: Request) -> DataStore:
    """Return the process-wide DataStore attached to app state at startup."""
    return request.app.state.store


def get_db() -> Iterator[sqlite3.Connection]:
    """Yield a fresh SQLite connection per request, closed when the request ends.

    A single shared connection is not safe across FastAPI's thread pool (sync
    endpoints run in worker threads); a connection per request avoids interleaved
    cursor/commit corruption. WAL mode (set in store_db.connect) lets these
    concurrent connections read while the triage sweep writes.
    """
    conn = store_db.connect(settings.db_path)
    try:
        yield conn
    finally:
        conn.close()
