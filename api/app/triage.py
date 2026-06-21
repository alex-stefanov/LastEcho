"""The triage sweep: picks urgent languages, drafts the first rung of their
outreach ladder, and queues it for human review. Runs on API startup and via
POST /api/triage/run — never on a timer (see PLAN.md "Trigger design").

Escalation to the next rung (continental -> global) is a separate, explicit
admin action (see routers/outreach_queue.py escalate()) — the sweep only ever
starts a language's *first* rung, once.
"""

from __future__ import annotations

import sqlite3
import threading

from . import matching, outreach, store_db
from .schemas import InstitutionsFile, Language, Organization, TriageRunResult

# Serializes sweeps within the process. The "has this language been contacted?"
# check is read-then-write, so two concurrent sweeps (the startup background
# thread + an admin POST /api/triage/run, or two admin clicks) could each pass
# the check before either inserts — producing duplicate first-rung drafts and
# duplicate paid Anthropic calls. A non-blocking acquire means a second
# concurrent sweep returns immediately as a no-op rather than piling up.
_sweep_lock = threading.Lock()


def run_sweep(
    conn: sqlite3.Connection,
    languages: list[Language],
    institutions_file: InstitutionsFile,
    *,
    top_n: int,
    ror_cache_ttl_days: int,
    anthropic_api_key: str | None,
    organizations: list[Organization] | None = None,
) -> TriageRunResult:
    """Top up the review queue to `top_n` drafts awaiting review.

    Drafts the next most-urgent languages (by rank) that have never been
    contacted, until there are `top_n` drafts in pending_review. A language with
    any draft — pending, sent, rejected, replied — is never re-drafted, so once
    you handle a draft (approve/send, reject) its slot is filled by the next
    most-urgent untouched language on the following run. This makes the sweep a
    self-refilling queue rather than a one-time top-N seed."""
    if not _sweep_lock.acquire(blocking=False):
        # Another sweep is already running — don't duplicate its work.
        return TriageRunResult(drafted=0, skipped=0, escalated=0)
    try:
        pending = len(store_db.list_drafts(conn, "pending_review"))
        need = top_n - pending
        if need <= 0:
            return TriageRunResult(drafted=0, skipped=0, escalated=0)

        drafted = 0
        skipped = 0
        for language in sorted(languages, key=lambda l: l.rank):
            if drafted >= need:
                break
            if store_db.latest_draft_for_language(conn, language.id) is not None:
                continue  # already contacted — never re-drafted (tracks who we've emailed)

            ladder = matching.build_ladder(
                conn, institutions_file, language,
                ror_cache_ttl_days=ror_cache_ttl_days, organizations=organizations,
            )
            if not ladder:
                skipped += 1
                continue
            first = ladder[0]
            draft = outreach.draft(language, first.institution, first.tier, api_key=anthropic_api_key)
            store_db.insert_draft(
                conn,
                language_id=language.id,
                institution_id=first.institution.id,
                tier=first.tier,
                subject=draft["subject"],
                body=draft["body"],
                ask=draft["ask"],
                language_name=language.name,
                institution_name=first.institution.name,
                institution_url=first.institution.url,
                institution_contact_url=first.institution.contactUrl,
                institution_email=first.institution.email,
            )
            drafted += 1

        return TriageRunResult(drafted=drafted, skipped=skipped, escalated=0)
    finally:
        _sweep_lock.release()


def escalate(
    conn: sqlite3.Connection,
    languages_by_id: dict[int, Language],
    institutions_file: InstitutionsFile,
    draft_id: int,
    *,
    ror_cache_ttl_days: int,
    anthropic_api_key: str | None,
    organizations: list[Organization] | None = None,
) -> sqlite3.Row | None:
    """Mark a sent-but-unanswered draft as no_reply and queue the next rung.
    Returns the new draft row, or None if the current rung was already the
    last one (global) — there's nowhere further to escalate to."""
    current = store_db.get_draft(conn, draft_id)
    if current is None:
        return None
    store_db.set_status(conn, draft_id, "no_reply")

    language = languages_by_id.get(current["language_id"])
    if language is None:
        return None
    ladder = matching.build_ladder(
        conn, institutions_file, language,
        ror_cache_ttl_days=ror_cache_ttl_days, organizations=organizations,
    )
    # Find where the draft we're escalating from sits in the (possibly
    # re-derived) ladder. Prefer the institution actually contacted — the ladder
    # composition can shift between sends (e.g. the national ROR cache expiring),
    # so matching by stored institution_id is more reliable than by tier name.
    # Fall back to tier only if that institution is no longer in the ladder.
    inst_id = current["institution_id"]
    current_index = next(
        (i for i, rung in enumerate(ladder) if rung.institution.id == inst_id), None
    )
    if current_index is None:
        tiers = [rung.tier for rung in ladder]
        try:
            current_index = tiers.index(current["tier"])
        except ValueError:
            return None
    next_index = current_index + 1
    if next_index >= len(ladder):
        return None  # already at the last rung (global) — ladder exhausted

    next_rung = ladder[next_index]
    draft = outreach.draft(language, next_rung.institution, next_rung.tier, api_key=anthropic_api_key)
    new_id = store_db.insert_draft(
        conn,
        language_id=language.id,
        institution_id=next_rung.institution.id,
        tier=next_rung.tier,
        subject=draft["subject"],
        body=draft["body"],
        ask=draft["ask"],
        language_name=language.name,
        institution_name=next_rung.institution.name,
        institution_url=next_rung.institution.url,
        institution_contact_url=next_rung.institution.contactUrl,
        institution_email=next_rung.institution.email,
    )
    return store_db.get_draft(conn, new_id)
