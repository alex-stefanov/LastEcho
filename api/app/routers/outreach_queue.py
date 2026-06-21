"""Admin-only: full draft content, approval, and escalation.

Gated by the admin bearer token (see auth.verify_admin, wired in main.py) — not
reachable without authenticating via POST /api/admin/login.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from .. import mailer, store_db, triage
from ..config import settings
from ..data import DataStore
from ..dependencies import get_db, get_store
from ..schemas import DraftStatus, DraftUpdate, OutreachDraft

router = APIRouter(prefix="/api/outreach-queue", tags=["admin"])
logger = logging.getLogger("lastecho")


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


@router.patch("/{draft_id}", response_model=OutreachDraft, summary="Edit a draft's subject/body/recipient (admin)")
def update_draft(
    draft_id: int, patch: DraftUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> OutreachDraft:
    """Only drafts still awaiting a decision can be edited — once sent, the
    email already went out and the record should reflect what was actually
    sent, not be rewritten after the fact."""
    row = _get_or_404(conn, draft_id)
    if row["status"] not in ("pending_review", "approved"):
        raise HTTPException(status_code=400, detail="Only pending or approved drafts can be edited")
    if patch.institutionEmail is not None and patch.institutionEmail != "" and not mailer.is_valid_address(patch.institutionEmail):
        raise HTTPException(status_code=400, detail="Invalid recipient email address")
    store_db.update_draft(
        conn,
        draft_id,
        subject=patch.subject,
        body=patch.body,
        institution_email=patch.institutionEmail,
    )
    return _row_to_draft(_get_or_404(conn, draft_id))


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
    _get_or_404(conn, draft_id)
    if not store_db.set_status_if(conn, draft_id, "approved", "sent"):
        raise HTTPException(status_code=400, detail="Only approved drafts can be marked sent")
    return _row_to_draft(_get_or_404(conn, draft_id))


@router.post("/{draft_id}/send", response_model=OutreachDraft, summary="Actually send the email via SMTP")
def send(draft_id: int, conn: sqlite3.Connection = Depends(get_db)) -> OutreachDraft:
    """Transmit an approved draft to the matched organization's address, then
    record it sent. Distinct from mark-sent (which only records a manual send):
    this one really delivers, so it requires a recipient email and configured
    SMTP — failing loudly (400/503/502) rather than marking sent on a no-op."""
    row = _get_or_404(conn, draft_id)
    if row["status"] != "approved":
        raise HTTPException(status_code=400, detail="Only approved drafts can be sent")
    recipient = row["institution_email"]
    if not recipient:
        raise HTTPException(
            status_code=400,
            detail="This draft's institution has no email address — use its contact page and Mark sent instead.",
        )
    if not mailer.is_configured(settings):
        raise HTTPException(
            status_code=503,
            detail="Email sending is not configured. Set LASTECHO_SMTP_HOST and LASTECHO_SMTP_FROM (see .env.example).",
        )
    # Claim the draft atomically before delivering: if a concurrent request
    # already moved it out of 'approved', we lose the race and stop here, so the
    # same email is never sent twice.
    if not store_db.set_status_if(conn, draft_id, "approved", "sent"):
        raise HTTPException(status_code=409, detail="Draft is no longer awaiting send")
    try:
        mailer.send(to=recipient, subject=row["subject"], body=row["body"], settings=settings)
    except Exception as exc:  # delivery failed — release the claim, leave it un-sent
        store_db.revert_send_claim(conn, draft_id)
        logger.error("send failed for draft %s: %s", draft_id, exc)
        raise HTTPException(status_code=502, detail="Email delivery failed")
    return _row_to_draft(_get_or_404(conn, draft_id))


@router.post("/{draft_id}/mark-replied", response_model=OutreachDraft, summary="Admin records a reply came in")
def mark_replied(draft_id: int, conn: sqlite3.Connection = Depends(get_db)) -> OutreachDraft:
    _get_or_404(conn, draft_id)
    if not store_db.set_status_if(conn, draft_id, "sent", "replied"):
        raise HTTPException(status_code=400, detail="Only sent drafts can be marked replied")
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
        organizations=store.organizations,
    )
    return _row_to_draft(new_row) if new_row else None
