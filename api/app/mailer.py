"""Real email transmission over SMTP (stdlib only).

The send endpoint calls this to actually deliver an approved draft. If SMTP is
not configured the endpoint refuses with 503 rather than have this module
silently no-op — an admin must never believe an email went out when it didn't.
"""

from __future__ import annotations

import json
import logging
import re
import smtplib
import ssl
import time
import urllib.error
import urllib.request
from email.message import EmailMessage

from .config import Settings

logger = logging.getLogger("lastecho")

_POSTMARK_API_URL = "https://api.postmarkapp.com/email"
_HTTP_TIMEOUT = 15

# Transient failures (connection drop, timeout, provider throttling) are worth
# one retry; auth/permanent failures are not, so they're excluded. Kept tight so
# an interactive admin send can't hang: worst case is ~timeout + backoff + timeout.
_RETRYABLE = (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, TimeoutError, OSError)
_MAX_ATTEMPTS = 2
_BACKOFF_SECONDS = 2.0
_SMTP_TIMEOUT = 15

# A single, well-formed address — no commas/semicolons (multiple recipients) and
# no whitespace. Combined with the control-character check below this prevents
# SMTP header injection (e.g. "a@x.com\nBcc: victim@y.com") via institution data.
_ADDRESS_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


def is_configured(settings: Settings) -> bool:
    """True once enough is set to actually deliver. Either transport works: the
    Postmark HTTP API (token + From) or SMTP (host + From)."""
    has_from = bool(settings.smtp_from)
    has_postmark = bool(getattr(settings, "postmark_token", None))
    return has_from and (has_postmark or bool(settings.smtp_host))


def is_valid_address(to: str) -> bool:
    return not any(c in to for c in "\r\n") and bool(_ADDRESS_RE.match(to))


def _require_valid_address(to: str) -> None:
    if not is_valid_address(to):
        raise ValueError(f"Invalid recipient address: {to!r}")


def _send_via_postmark_api(*, to: str, subject: str, body: str, settings: Settings) -> None:
    """Deliver one plain-text email through Postmark's HTTP API (port 443).

    Used in preference to SMTP because hosts like Render's free tier block
    outbound SMTP ports, which makes the SMTP path hang. Raises on any non-2xx
    response or a non-zero Postmark ErrorCode so the caller leaves it un-sent."""
    payload = json.dumps(
        {
            "From": settings.smtp_from,
            "To": to,
            "Subject": subject,
            "TextBody": body,
            "MessageStream": "outbound",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        _POSTMARK_API_URL,
        data=payload,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": settings.postmark_token,
        },
        method="POST",
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:  # 4xx/5xx — body carries Postmark's reason
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"Postmark API error {exc.code}: {detail}") from exc
    if data.get("ErrorCode", 0) != 0:
        raise RuntimeError(f"Postmark rejected the message: {data.get('Message')}")
    logger.info("Postmark API send ok in %.1fs", time.monotonic() - started)


def send(*, to: str, subject: str, body: str, settings: Settings) -> None:
    """Deliver one plain-text email. Prefers the Postmark HTTP API when a token
    is configured; otherwise falls back to SMTP (retrying transient connection
    failures with backoff). Raises on final failure so the caller can surface it
    and leave the draft un-sent."""
    if not is_configured(settings):
        raise RuntimeError("Email sending is not configured")

    _require_valid_address(to)
    # Strip CR/LF from the subject too — a model-generated subject must never be
    # able to inject extra headers.
    safe_subject = subject.replace("\r", " ").replace("\n", " ")

    if getattr(settings, "postmark_token", None):
        _send_via_postmark_api(to=to, subject=safe_subject, body=body, settings=settings)
        return

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = safe_subject
    msg.set_content(body)

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        started = time.monotonic()
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=_SMTP_TIMEOUT) as server:
                if settings.smtp_use_tls:
                    server.starttls(context=ssl.create_default_context())
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password or "")
                server.send_message(msg)
            logger.info("SMTP send ok in %.1fs (attempt %s)", time.monotonic() - started, attempt)
            return
        except _RETRYABLE:
            logger.warning("SMTP attempt %s failed after %.1fs", attempt, time.monotonic() - started)
            if attempt == _MAX_ATTEMPTS:
                raise
            time.sleep(_BACKOFF_SECONDS * attempt)
