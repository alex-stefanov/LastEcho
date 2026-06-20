"""On-demand triage sweep trigger. See app/triage.py for the actual logic."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from .. import triage as triage_logic
from ..config import settings
from ..data import DataStore
from ..dependencies import get_db, get_store
from ..schemas import TriageRunResult

router = APIRouter(prefix="/api/triage", tags=["admin"])


@router.post("/run", response_model=TriageRunResult, summary="Run the triage sweep now")
def run(store: DataStore = Depends(get_store), conn: sqlite3.Connection = Depends(get_db)) -> TriageRunResult:
    return triage_logic.run_sweep(
        conn,
        store.dataset.languages,
        store.institutions,
        top_n=settings.triage_top_n,
        ror_cache_ttl_days=settings.ror_cache_ttl_days,
        anthropic_api_key=settings.anthropic_api_key,
    )
