"""On-demand triage sweep trigger. See app/triage.py for the actual logic."""

from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Depends

from .. import store_db, triage as triage_logic
from ..config import settings
from ..data import DataStore
from ..dependencies import get_store

router = APIRouter(prefix="/api/triage", tags=["admin"])
logger = logging.getLogger("lastecho")


def _run_sweep_background(store: DataStore) -> None:
    """Run one sweep on its own short-lived connection, off the request path.

    A sweep does up to top_n live ROR lookups (~12s each) plus, when a key is set,
    paid Claude calls (~20s each) — running it inline would hold a worker thread
    (and its DB connection) for minutes and can exhaust FastAPI's threadpool. The
    in-process _sweep_lock in triage.run_sweep makes a second concurrent sweep a
    no-op, so repeated clicks are safe."""
    conn = store_db.connect(settings.db_path)
    try:
        result = triage_logic.run_sweep(
            conn,
            store.dataset.languages,
            store.institutions,
            top_n=settings.triage_top_n,
            ror_cache_ttl_days=settings.ror_cache_ttl_days,
            anthropic_api_key=settings.anthropic_api_key,
            organizations=store.organizations,
        )
        logger.info("on-demand triage sweep: drafted=%s skipped=%s", result.drafted, result.skipped)
    except Exception:  # a background sweep must never take the process down
        logger.exception("on-demand triage sweep failed")
    finally:
        conn.close()


@router.post("/run", status_code=202, summary="Start the triage sweep (runs in the background)")
def run(store: DataStore = Depends(get_store)) -> dict:
    """Kick off the sweep and return immediately (202). The sweep runs in a
    background thread so the request — and the worker thread serving it — isn't
    held for the minutes a full sweep can take. Poll the queue to see results."""
    threading.Thread(
        target=_run_sweep_background, args=(store,), name="triage-sweep-ondemand", daemon=True
    ).start()
    return {"status": "started"}
