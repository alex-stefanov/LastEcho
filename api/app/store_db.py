"""SQLite persistence for the outreach queue and the national-tier ROR cache.

Plain stdlib sqlite3 — no ORM. Two tables:
- outreach_queue: one row per (language, institution, tier) attempt. A
  language's outreach history is the sequence of rows it accumulates as it
  climbs the ladder (local -> continental -> global); only one is ever
  "active" (pending_review/approved/sent) at a time.
- country_institutions: cache of National-tier ROR lookups, keyed by country
  code, with a TTL so repeat languages in the same country don't re-query ROR.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ACTIVE_STATUSES = ("pending_review", "approved", "sent")


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def create_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS outreach_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            language_id INTEGER NOT NULL,
            institution_id TEXT NOT NULL,
            tier TEXT NOT NULL,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            ask TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            decided_at TEXT,
            sent_at TEXT,
            -- Denormalized at draft time: a National-tier institution is
            -- discovered live and only exists in the country_institutions
            -- cache, not a static table, so each row carries its own display
            -- fields rather than re-resolving institution_id on every read.
            language_name TEXT NOT NULL,
            institution_name TEXT NOT NULL,
            institution_url TEXT NOT NULL,
            institution_contact_url TEXT NOT NULL,
            institution_email TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_outreach_language ON outreach_queue(language_id)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS country_institutions (
            country_code TEXT NOT NULL,
            name TEXT NOT NULL,
            type TEXT,
            url TEXT,
            contact_url TEXT,
            fetched_at TEXT NOT NULL,
            PRIMARY KEY (country_code, name)
        )
        """
    )
    conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- outreach_queue ----------------------------------------------------------

def latest_draft_for_language(conn: sqlite3.Connection, language_id: int) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM outreach_queue WHERE language_id = ? ORDER BY id DESC LIMIT 1",
        (language_id,),
    ).fetchone()


def has_active_draft(conn: sqlite3.Connection, language_id: int) -> bool:
    row = conn.execute(
        f"""
        SELECT 1 FROM outreach_queue
        WHERE language_id = ? AND status IN ({','.join('?' * len(ACTIVE_STATUSES))})
        LIMIT 1
        """,
        (language_id, *ACTIVE_STATUSES),
    ).fetchone()
    return row is not None


def insert_draft(
    conn: sqlite3.Connection,
    *,
    language_id: int,
    institution_id: str,
    tier: str,
    subject: str,
    body: str,
    ask: str,
    language_name: str,
    institution_name: str,
    institution_url: str,
    institution_contact_url: str,
    institution_email: str | None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO outreach_queue
            (language_id, institution_id, tier, subject, body, ask, status, created_at,
             language_name, institution_name, institution_url, institution_contact_url, institution_email)
        VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, ?, ?, ?, ?)
        """,
        (
            language_id, institution_id, tier, subject, body, ask, _now(),
            language_name, institution_name, institution_url, institution_contact_url, institution_email,
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def get_draft(conn: sqlite3.Connection, draft_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM outreach_queue WHERE id = ?", (draft_id,)).fetchone()


def list_drafts(conn: sqlite3.Connection, status: str | None = None) -> list[sqlite3.Row]:
    if status:
        return conn.execute(
            "SELECT * FROM outreach_queue WHERE status = ? ORDER BY id DESC", (status,)
        ).fetchall()
    return conn.execute("SELECT * FROM outreach_queue ORDER BY id DESC").fetchall()


def set_status(conn: sqlite3.Connection, draft_id: int, status: str) -> None:
    field = "decided_at" if status in ("approved", "rejected") else None
    if status == "sent":
        conn.execute(
            "UPDATE outreach_queue SET status = ?, sent_at = ? WHERE id = ?",
            (status, _now(), draft_id),
        )
    elif field:
        conn.execute(
            f"UPDATE outreach_queue SET status = ?, {field} = ? WHERE id = ?",
            (status, _now(), draft_id),
        )
    else:
        conn.execute("UPDATE outreach_queue SET status = ? WHERE id = ?", (status, draft_id))
    conn.commit()


def latest_per_language(conn: sqlite3.Connection) -> dict[int, sqlite3.Row]:
    """The most recent ladder row per language — what drives the public status."""
    rows = conn.execute(
        """
        SELECT oq.* FROM outreach_queue oq
        WHERE oq.id = (
            SELECT id FROM outreach_queue
            WHERE language_id = oq.language_id
            ORDER BY id DESC LIMIT 1
        )
        """
    ).fetchall()
    return {row["language_id"]: row for row in rows}


# --- country_institutions cache ----------------------------------------------

def get_cached_country(
    conn: sqlite3.Connection, country_code: str, ttl_days: int
) -> list[dict[str, Any]] | None:
    rows = conn.execute(
        "SELECT * FROM country_institutions WHERE country_code = ?", (country_code,)
    ).fetchall()
    if not rows:
        return None
    cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
    fetched_at = datetime.fromisoformat(rows[0]["fetched_at"])
    if fetched_at < cutoff:
        return None  # stale — caller should re-fetch and overwrite
    return [dict(r) for r in rows]


def set_cached_country(
    conn: sqlite3.Connection, country_code: str, items: list[dict[str, Any]]
) -> None:
    conn.execute("DELETE FROM country_institutions WHERE country_code = ?", (country_code,))
    now = _now()
    for item in items:
        conn.execute(
            """
            INSERT OR REPLACE INTO country_institutions
                (country_code, name, type, url, contact_url, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (country_code, item["name"], item.get("type"), item.get("url"), item.get("contact_url"), now),
        )
    conn.commit()
