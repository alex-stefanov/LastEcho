"""Public, read-only outreach context — used by the globe app.

No draft content (subject/body/ask) is exposed here, only status and matched
institutions for context. Drafting/approving/sending live behind the
admin-only outreach_queue router.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import matching, store_db
from ..config import settings
from ..data import DataStore
from ..dependencies import get_db, get_store
from ..schemas import Institution, OutreachStatusSummary

router = APIRouter(prefix="/api", tags=["outreach"])

# The matched-institution count for a language is derived from static in-memory
# data plus the ROR cache, so it's effectively constant for the process lifetime.
# Computing it calls matched_institutions -> build_ladder, which reverse-geocodes
# (twice) per language — and this runs on a public endpoint hit on every globe
# load, for every language ever contacted. Memoize it so that cost is paid once
# per language rather than on every request. (Worst case is a cosmetic ±1
# staleness if a later sweep warms a new national rung; cleared on restart.)
_institution_count_cache: dict[int, int] = {}


def _institution_count(conn: sqlite3.Connection, store: DataStore, language) -> int:
    cached = _institution_count_cache.get(language.id)
    if cached is not None:
        return cached
    count = len(
        matching.matched_institutions(
            conn, store.institutions, language,
            ror_cache_ttl_days=settings.ror_cache_ttl_days,
            organizations=store.organizations,
        )
    )
    _institution_count_cache[language.id] = count
    return count


def _summary_for_row(conn: sqlite3.Connection, row: sqlite3.Row, institution_count: int) -> OutreachStatusSummary:
    status = row["status"]
    can_escalate = False
    if status == "sent" and row["sent_at"]:
        sent_at = datetime.fromisoformat(row["sent_at"])
        can_escalate = datetime.now(timezone.utc) - sent_at >= timedelta(days=settings.escalate_after_days)
    return OutreachStatusSummary(
        hasPending=status == "pending_review",
        hasApproved=status == "approved",
        hasRejected=status == "rejected",
        hasSent=status == "sent",
        hasReplied=status == "replied",
        canEscalate=can_escalate,
        currentTier=row["tier"],
        institutionCount=institution_count,
    )


@router.get("/outreach-status", summary="Per-language outreach status (read-only)")
def outreach_status(
    store: DataStore = Depends(get_store), conn: sqlite3.Connection = Depends(get_db)
) -> dict[int, OutreachStatusSummary]:
    latest = store_db.latest_per_language(conn)
    by_id = {l.id: l for l in store.dataset.languages}
    out: dict[int, OutreachStatusSummary] = {}
    for language_id, row in latest.items():
        language = by_id.get(language_id)
        count = _institution_count(conn, store, language) if language is not None else 0
        out[language_id] = _summary_for_row(conn, row, count)
    return out


@router.get(
    "/languages/{language_id}/institutions",
    response_model=list[Institution],
    summary="Matched institutions for one language (read-only context, no draft content)",
)
def language_institutions(
    language_id: int,
    store: DataStore = Depends(get_store),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[Institution]:
    language = next((l for l in store.dataset.languages if l.id == language_id), None)
    if language is None:
        raise HTTPException(status_code=404, detail="Language not found")
    return matching.matched_institutions(
        conn, store.institutions, language,
        ror_cache_ttl_days=settings.ror_cache_ttl_days,
        organizations=store.organizations,
    )
