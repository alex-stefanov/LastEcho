"""Shared FastAPI dependencies."""

from __future__ import annotations

import sqlite3

from fastapi import Request

from .data import DataStore


def get_store(request: Request) -> DataStore:
    """Return the process-wide DataStore attached to app state at startup."""
    return request.app.state.store


def get_db(request: Request) -> sqlite3.Connection:
    """Return the process-wide SQLite connection attached to app state at startup."""
    return request.app.state.db
