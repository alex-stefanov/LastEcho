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
        count = 0
        if language is not None:
            count = len(
                matching.matched_institutions(
                    conn, store.institutions, language, ror_cache_ttl_days=settings.ror_cache_ttl_days
                )
            )
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
        conn, store.institutions, language, ror_cache_ttl_days=settings.ror_cache_ttl_days
    )
