"""FastAPI application entry point.

Composition only: build the app, wire middleware, load the dataset on startup,
and mount the routers. Endpoint logic lives in `routers/`.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import store_db, triage
from .auth import verify_admin
from .config import settings
from .data import DataStore
from .ratelimit import rate_limit
from .routers import admin_auth, languages, outreach_queue, outreach_status
from .routers import triage as triage_router

logger = logging.getLogger("lastecho")


def _run_startup_sweep() -> None:
    """Run the triage sweep on its own connection, off the request path."""
    conn = store_db.connect(settings.db_path)
    try:
        result = triage.run_sweep(
            conn,
            _STORE.dataset.languages,
            _STORE.institutions,
            top_n=settings.triage_top_n,
            ror_cache_ttl_days=settings.ror_cache_ttl_days,
            anthropic_api_key=settings.anthropic_api_key,
            organizations=_STORE.organizations,
        )
        logger.info("startup triage sweep: drafted=%s skipped=%s", result.drafted, result.skipped)
    except Exception:  # never let a background sweep crash the process
        logger.exception("startup triage sweep failed")
    finally:
        conn.close()


# Module-level handle so the background sweep thread can reach the loaded data.
_STORE: DataStore


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global _STORE
    # Load and validate the datasets once, before the server accepts traffic.
    store = DataStore(settings.data_path, settings.institutions_path, settings.organizations_path)
    store.load()
    app.state.store = store
    _STORE = store

    # Ensure the schema exists so per-request connections (see dependencies.get_db)
    # find the tables. This connection is kept only for shutdown bookkeeping.
    conn = store_db.connect(settings.db_path)
    store_db.create_tables(conn)
    app.state.db = conn

    # The triage sweep is automatic, not user-triggered (see PLAN.md "Trigger
    # design"). It does live network + paid API calls, so it is off by default
    # and, when enabled, runs in the background rather than blocking startup.
    if settings.run_sweep_on_startup:
        threading.Thread(target=_run_startup_sweep, name="triage-sweep", daemon=True).start()

    yield
    conn.close()


def create_app() -> FastAPI:
    app = FastAPI(title=settings.title, version=settings.version, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    # Public, read-only — rate limited.
    app.include_router(languages.router, dependencies=[Depends(rate_limit)])
    app.include_router(outreach_status.router, dependencies=[Depends(rate_limit)])
    app.include_router(admin_auth.router, dependencies=[Depends(rate_limit)])
    # Admin + triage — rate limited and behind the admin token.
    app.include_router(outreach_queue.router, dependencies=[Depends(rate_limit), Depends(verify_admin)])
    app.include_router(triage_router.router, dependencies=[Depends(rate_limit), Depends(verify_admin)])

    @app.get("/", tags=["meta"], summary="Service info")
    def root() -> dict:
        return {
            "service": settings.title,
            "version": settings.version,
            "docs": "/docs",
            "endpoints": [
                "/api/health",
                "/api/outreach-status",
                "/api/languages/{id}/institutions",
                "/api/admin/login",
                "/api/outreach-queue",
                "/api/outreach-queue/{id}/send",
                "/api/triage/run",
            ],
        }

    return app


app = create_app()
