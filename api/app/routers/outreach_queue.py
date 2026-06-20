"""Admin-only: full draft content, approval, and escalation.

Not linked from the public globe app. No auth in this slice (see PLAN.md
"Out of scope") — acceptable for a demo, called out as a known gap rather
than hidden.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import store_db, triage
from ..config import settings
from ..data import DataStore
from ..dependencies import get_db, get_store
from ..schemas import DraftStatus, OutreachDraft

router = APIRouter(prefix="/api/outreach-queue", tags=["admin"])


def _can_escalate(row: sqlite3.Row) -> bool:
    if row["status"] != "sent" or not row["sent_at"]:
        return False
    sent_at = datetime.fromisoformat(row["sent_at"])
    return datetime.now(timezone.utc) - sent_at >= timedelta(days=settings.escalate_after_days)


def _row_to_draft(row: sqlite3.Row) -> OutreachDraft:
    return OutreachDraft(
        id=row["id"],
        languageId=row["language_id"],
        institutionId=row["institution_id"],
        tier=row["tier"],
        subject=row["subject"],
        body=row["body"],
        ask=row["ask"],
        status=row["status"],
        createdAt=row["created_at"],
        decidedAt=row["decided_at"],
        sentAt=row["sent_at"],
        canEscalate=_can_escalate(row),
        languageName=row["language_name"],
        institutionName=row["institution_name"],
        institutionUrl=row["institution_url"],
        institutionContactUrl=row["institution_contact_url"],
        institutionEmail=row["institution_email"],
    )


@router.get("", response_model=list[OutreachDraft], summary="List drafts (admin)")
def list_queue(status: DraftStatus | None = None, conn: sqlite3.Connection = Depends(get_db)) -> list[OutreachDraft]:
    return [_row_to_draft(r) for r in store_db.list_drafts(conn, status)]


def _get_or_404(conn: sqlite3.Connection, draft_id: int) -> sqlite3.Row:
    row = store_db.get_draft(conn, draft_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return row


@router.post("/{draft_id}/approve", response_model=OutreachDraft, summary="Approve a draft (admin)")
def approve(draft_id: int, conn: sqlite3.Connection = Depends(get_db)) -> OutreachDraft:
    _get_or_404(conn, draft_id)
    store_db.set_status(conn, draft_id, "approved")
    return _row_to_draft(_get_or_404(conn, draft_id))


@router.post("/{draft_id}/reject", response_model=OutreachDraft, summary="Reject a draft (admin)")
def reject(draft_id: int, conn: sqlite3.Connection = Depends(get_db)) -> OutreachDraft:
    _get_or_404(conn, draft_id)
    store_db.set_status(conn, draft_id, "rejected")
    return _row_to_draft(_get_or_404(conn, draft_id))


@router.post("/{draft_id}/mark-sent", response_model=OutreachDraft, summary="Admin records they sent it")
def mark_sent(draft_id: int, conn: sqlite3.Connection = Depends(get_db)) -> OutreachDraft:
    row = _get_or_404(conn, draft_id)
    if row["status"] != "approved":
        raise HTTPException(status_code=400, detail="Only approved drafts can be marked sent")
    store_db.set_status(conn, draft_id, "sent")
    return _row_to_draft(_get_or_404(conn, draft_id))


@router.post("/{draft_id}/mark-replied", response_model=OutreachDraft, summary="Admin records a reply came in")
def mark_replied(draft_id: int, conn: sqlite3.Connection = Depends(get_db)) -> OutreachDraft:
    row = _get_or_404(conn, draft_id)
    if row["status"] != "sent":
        raise HTTPException(status_code=400, detail="Only sent drafts can be marked replied")
    store_db.set_status(conn, draft_id, "replied")
    return _row_to_draft(_get_or_404(conn, draft_id))


@router.post(
    "/{draft_id}/escalate",
    response_model=OutreachDraft | None,
    summary="No reply after the wait window — mark it and queue the next rung",
)
def escalate(
    draft_id: int,
    store: DataStore = Depends(get_store),
    conn: sqlite3.Connection = Depends(get_db),
) -> OutreachDraft | None:
    row = _get_or_404(conn, draft_id)
    if row["status"] != "sent":
        raise HTTPException(status_code=400, detail="Only sent drafts can be escalated")
    if not _can_escalate(row):
        raise HTTPException(
            status_code=400,
            detail=f"Too soon to escalate — wait {settings.escalate_after_days} days from send before declaring no reply",
        )
    by_id = {l.id: l for l in store.dataset.languages}
    new_row = triage.escalate(
        conn,
        by_id,
        store.institutions,
        draft_id,
        ror_cache_ttl_days=settings.ror_cache_ttl_days,
        anthropic_api_key=settings.anthropic_api_key,
    )
    return _row_to_draft(new_row) if new_row else None
