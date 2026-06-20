"""Application configuration.

All settings have sensible defaults so the API runs with zero env setup in
development. Override via environment variables for deployment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# api/app/config.py -> api/
_API_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_DATA_PATH = _API_ROOT / "data" / "languages.json"
_DEFAULT_INSTITUTIONS_PATH = _API_ROOT / "data" / "institutions.json"
_DEFAULT_DB_PATH = _API_ROOT / "data" / "lastecho.db"


def _csv_env(name: str, default: str) -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    title: str = "LastEcho API"
    version: str = "0.1.0"
    # Absolute path to the precomputed dataset emitted by scripts/build_data.py.
    data_path: Path = field(
        default_factory=lambda: Path(os.environ.get("LASTECHO_DATA_PATH", _DEFAULT_DATA_PATH))
    )
    # CORS origins. Defaults to "*" for the hackathon; set LASTECHO_CORS_ORIGINS
    # to the frontend origin(s) (comma-separated) before deploying.
    cors_origins: list[str] = field(
        default_factory=lambda: _csv_env("LASTECHO_CORS_ORIGINS", "*")
    )

    # --- outreach (the "response layer") ---
    institutions_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("LASTECHO_INSTITUTIONS_PATH", _DEFAULT_INSTITUTIONS_PATH)
        )
    )
    # SQLite file for the outreach queue + national-tier lookup cache. Not
    # checked in (gitignored) — it's process state, not source data.
    db_path: Path = field(
        default_factory=lambda: Path(os.environ.get("LASTECHO_DB_PATH", _DEFAULT_DB_PATH))
    )
    # Unset -> outreach.py falls back to a templated draft instead of calling Claude.
    anthropic_api_key: str | None = field(
        default_factory=lambda: os.environ.get("ANTHROPIC_API_KEY") or None
    )
    # How many of the most urgent languages the triage sweep drafts per run.
    triage_top_n: int = field(
        default_factory=lambda: int(os.environ.get("LASTECHO_TRIAGE_TOP_N", "15"))
    )
    # How long a sent draft waits before the admin can mark it "no reply" and
    # escalate to the next tier of the ladder (local -> continental -> global).
    escalate_after_days: int = field(
        default_factory=lambda: int(os.environ.get("LASTECHO_ESCALATE_AFTER_DAYS", "7"))
    )
    # TTL for the National-tier ROR lookup cache (country_institutions table).
    ror_cache_ttl_days: int = field(
        default_factory=lambda: int(os.environ.get("LASTECHO_ROR_CACHE_TTL_DAYS", "30"))
    )


settings = Settings()
