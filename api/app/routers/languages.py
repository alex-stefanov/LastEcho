"""Liveness probe.

The language dataset itself is no longer served over HTTP — the frontend
bundles it directly (see client/src/data/languages.json). The backend still
loads it into the DataStore on startup for triage and institution matching.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..data import DataStore
from ..dependencies import get_store
from ..schemas import Health

router = APIRouter(prefix="/api", tags=["languages"])


@router.get("/health", response_model=Health, summary="Liveness probe")
def health(store: DataStore = Depends(get_store)) -> Health:
    return Health(status="ok", count=len(store.dataset.languages))
