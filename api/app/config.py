"""Application configuration.

All settings have sensible defaults so the API runs with zero env setup in
development. Override via environment variables for deployment.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

# api/app/config.py -> api/
_API_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _API_ROOT.parent
_DEFAULT_DATA_PATH = _API_ROOT / "data" / "languages.json"
_DEFAULT_INSTITUTIONS_PATH = _API_ROOT / "data" / "institutions.json"
# Single source of truth — the same file the frontend ships. Real, emailable
# language organizations that the send endpoint can actually transmit to.
_DEFAULT_ORGANIZATIONS_PATH = _REPO_ROOT / "client" / "src" / "data" / "language_organizations.json"
_DEFAULT_DB_PATH = _API_ROOT / "data" / "lastecho.db"


def _load_dotenv(path: Path) -> None:
    """Load api/.env into os.environ. Real environment variables take precedence,
    so a deployed config is never overridden by a stray local .env.

    Uses python-dotenv when available (handles quoting, inline comments, escapes,
    and multiline values correctly); falls back to a minimal KEY=VALUE parser so
    the app still boots with zero extra dependencies installed."""
    if not path.exists():
        return
    try:
        from dotenv import dotenv_values

        for key, value in dotenv_values(path).items():
            if value is not None:
                os.environ.setdefault(key, value)
        return
    except ImportError:
        pass
    # Fallback: minimal parser. Handles surrounding quotes and *unquoted* inline
    # comments (so `KEY=secret # note` loads `secret`, not `secret # note`).
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        # Strip an unquoted trailing comment; quoted values keep their '#'.
        if value[:1] not in ("'", '"'):
            value = value.split(" #", 1)[0].rstrip()
        os.environ.setdefault(key.strip(), value.strip('"').strip("'"))


# Load api/.env before settings are read, so SMTP creds etc. land in os.environ.
_load_dotenv(_API_ROOT / ".env")


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


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
    # CORS origins (comma-separated). Defaults to the local dev origins only —
    # never "*", which (combined with the admin token) would let any site drive
    # the API from a victim's browser. Set LASTECHO_CORS_ORIGINS to the deployed
    # frontend origin(s) in production.
    cors_origins: list[str] = field(
        default_factory=lambda: _csv_env(
            "LASTECHO_CORS_ORIGINS", "http://localhost:5173,http://localhost:4173"
        )
    )

    # --- outreach (the "response layer") ---
    institutions_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("LASTECHO_INSTITUTIONS_PATH", _DEFAULT_INSTITUTIONS_PATH)
        )
    )
    # Real, emailable language organizations — matched into the local rung of the
    # ladder so a draft can carry a deliverable address (see matching._org_pick).
    organizations_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("LASTECHO_ORGANIZATIONS_PATH", _DEFAULT_ORGANIZATIONS_PATH)
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

    # --- Email sending ---
    # Preferred transport: Postmark's HTTP API (port 443). Many hosts (incl.
    # Render's free tier) block outbound SMTP ports, which makes the SMTP path
    # below hang and fail; the HTTP API is not affected. When this token is set,
    # mailer.send() uses the API and ignores the SMTP_* settings (smtp_from is
    # still used as the From address).
    postmark_token: str | None = field(
        default_factory=lambda: os.environ.get("LASTECHO_POSTMARK_TOKEN") or None
    )
    # --- SMTP (fallback transport) ---
    # Unset host/from -> mailer.is_configured() is False and the send endpoint
    # returns 503 instead of silently pretending to send. Mark-sent (manual
    # record) still works without any SMTP config.
    smtp_host: str | None = field(
        default_factory=lambda: os.environ.get("LASTECHO_SMTP_HOST") or None
    )
    smtp_port: int = field(
        default_factory=lambda: int(os.environ.get("LASTECHO_SMTP_PORT", "587"))
    )
    smtp_user: str | None = field(
        default_factory=lambda: os.environ.get("LASTECHO_SMTP_USER") or None
    )
    smtp_password: str | None = field(
        default_factory=lambda: os.environ.get("LASTECHO_SMTP_PASSWORD") or None
    )
    # The From: address. Defaults to the SMTP user if that looks like an address.
    smtp_from: str | None = field(
        default_factory=lambda: os.environ.get("LASTECHO_SMTP_FROM")
        or os.environ.get("LASTECHO_SMTP_USER")
        or None
    )
    smtp_use_tls: bool = field(
        default_factory=lambda: _bool_env("LASTECHO_SMTP_USE_TLS", True)
    )

    # --- admin auth (server-side) ---------------------------------------------
    # The admin/triage endpoints are gated by a bearer token. Set a password to
    # enable admin: POST /api/admin/login exchanges user+password for the token,
    # which the client then sends as the X-Admin-Token header. With no password
    # set, login and every admin endpoint fail closed (503) — there is no
    # client-side-only gate.
    admin_user: str = field(
        default_factory=lambda: os.environ.get("LASTECHO_ADMIN_USER", "admin")
    )
    admin_password: str | None = field(
        default_factory=lambda: os.environ.get("LASTECHO_ADMIN_PASSWORD") or None
    )
    # Signing key for the short-lived session tokens (see tokens.py) — NOT handed
    # to the client. Defaults to a fresh random value per process: leaving
    # LASTECHO_ADMIN_TOKEN unset means a restart rotates the key and revokes every
    # outstanding token. Set it only if you need tokens to survive restarts.
    admin_token: str = field(
        default_factory=lambda: os.environ.get("LASTECHO_ADMIN_TOKEN")
        or secrets.token_urlsafe(32)
    )
    # How long an issued admin token stays valid (default 8h). After this the
    # client must log in again; a leaked token also stops working on its own.
    admin_token_ttl_seconds: int = field(
        default_factory=lambda: int(os.environ.get("LASTECHO_ADMIN_TOKEN_TTL_SECONDS", "28800"))
    )

    # --- operational limits ---------------------------------------------------
    # Per-IP request cap (sliding 60s window) applied to the API routers.
    rate_limit_per_min: int = field(
        default_factory=lambda: int(os.environ.get("LASTECHO_RATE_LIMIT_PER_MIN", "120"))
    )
    # Much tighter per-IP cap on POST /api/admin/login specifically — password
    # guessing should never get the generous public-read budget.
    admin_login_rate_limit_per_min: int = field(
        default_factory=lambda: int(os.environ.get("LASTECHO_ADMIN_LOGIN_RATE_LIMIT_PER_MIN", "10"))
    )
    # Expose the interactive API docs (/docs, /redoc, /openapi.json). On by
    # default for local development; set LASTECHO_EXPOSE_DOCS=false in production
    # so the full admin/triage surface isn't published to anonymous users.
    expose_docs: bool = field(
        default_factory=lambda: _bool_env("LASTECHO_EXPOSE_DOCS", True)
    )
    # The startup triage sweep does live ROR lookups + (optionally) paid Anthropic
    # calls. Off by default so boot is fast and cheap; run it on demand via
    # POST /api/triage/run, or set this true to sweep once at startup (backgrounded).
    run_sweep_on_startup: bool = field(
        default_factory=lambda: _bool_env("LASTECHO_RUN_SWEEP_ON_STARTUP", False)
    )

    @property
    def admin_configured(self) -> bool:
        return bool(self.admin_password)

    def __post_init__(self) -> None:
        # Fail loudly on the one deployment shape that silently breaks admin auth:
        # multiple workers with a per-process random signing key. Each worker would
        # then sign tokens with a different key, so a token minted on worker A is
        # rejected (401) by worker B — intermittently, depending on which worker the
        # load balancer routes to. The same per-process assumption also makes the
        # rate limiter and sweep dedup unreliable across workers. Pinning
        # LASTECHO_ADMIN_TOKEN gives every worker the same key and resolves it.
        workers = int(os.environ.get("WEB_CONCURRENCY", "1") or "1")
        if self.admin_configured and workers > 1 and not os.environ.get("LASTECHO_ADMIN_TOKEN"):
            raise RuntimeError(
                "Multi-worker deployment (WEB_CONCURRENCY > 1) requires a pinned "
                "LASTECHO_ADMIN_TOKEN: per-process random signing keys make admin "
                "tokens fail verification across workers. Set LASTECHO_ADMIN_TOKEN "
                "to a stable secret, or run a single worker."
            )


settings = Settings()
