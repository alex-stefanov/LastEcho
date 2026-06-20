"""The triage sweep: picks urgent languages, drafts the first rung of their
outreach ladder, and queues it for human review. Runs on API startup and via
POST /api/triage/run — never on a timer (see PLAN.md "Trigger design").

Escalation to the next rung (continental -> global) is a separate, explicit
admin action (see routers/outreach_queue.py escalate()) — the sweep only ever
starts a language's *first* rung, once.
"""

from __future__ import annotations

import sqlite3

from . import matching, outreach, store_db
from .schemas import InstitutionsFile, Language, Organization, TriageRunResult


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
    candidates = sorted(languages, key=lambda l: l.rank)[:top_n]
    drafted = 0
    skipped = 0

    for language in candidates:
        if store_db.latest_draft_for_language(conn, language.id) is not None:
            skipped += 1  # already has outreach history — idempotent, never re-drafted by the sweep
            continue

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
