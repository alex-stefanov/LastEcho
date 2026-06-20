"""FastAPI application entry point.

Composition only: build the app, wire middleware, load the dataset on startup,
and mount the routers. Endpoint logic lives in `routers/`.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import store_db, triage
from .config import settings
from .data import DataStore
from .routers import languages, outreach_queue, outreach_status
from .routers import triage as triage_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Load and validate the datasets once, before the server accepts traffic.
    store = DataStore(settings.data_path, settings.institutions_path, settings.organizations_path)
    store.load()
    app.state.store = store

    conn = store_db.connect(settings.db_path)
    store_db.create_tables(conn)
    app.state.db = conn

    # The triage sweep runs here — automatic, not user-triggered. See
    # PLAN.md "Trigger design": tied to startup/data-refresh, not a timer.
    triage.run_sweep(
        conn,
        store.dataset.languages,
        store.institutions,
        top_n=settings.triage_top_n,
        ror_cache_ttl_days=settings.ror_cache_ttl_days,
        anthropic_api_key=settings.anthropic_api_key,
        organizations=store.organizations,
    )

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

    app.include_router(languages.router)
    app.include_router(outreach_status.router)
    app.include_router(outreach_queue.router)
    app.include_router(triage_router.router)

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
                "/api/outreach-queue",
                "/api/outreach-queue/{id}/send",
                "/api/triage/run",
            ],
        }

    return app


app = create_app()
