"""Real email transmission over SMTP (stdlib only).

The send endpoint calls this to actually deliver an approved draft. If SMTP is
not configured the endpoint refuses with 503 rather than have this module
silently no-op — an admin must never believe an email went out when it didn't.
"""

from __future__ import annotations

import smtplib
import ssl
import time
from email.message import EmailMessage

from .config import Settings

# Transient failures (connection drop, timeout, provider throttling) are worth
# a couple of retries; auth/permanent failures are not, so they're excluded.
_RETRYABLE = (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, TimeoutError, OSError)
_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = 2.0


def is_configured(settings: Settings) -> bool:
    """True once enough is set to actually deliver: a host and a From address."""
    return bool(settings.smtp_host and settings.smtp_from)


def send(*, to: str, subject: str, body: str, settings: Settings) -> None:
    """Deliver one plain-text email. Retries transient connection failures with
    backoff; raises on the final failure (or any non-retryable error) so the
    caller can surface it and leave the draft un-sent."""
    if not is_configured(settings):
        raise RuntimeError("SMTP is not configured")

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as server:
                if settings.smtp_use_tls:
                    server.starttls(context=ssl.create_default_context())
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password or "")
                server.send_message(msg)
            return
        except _RETRYABLE:
            if attempt == _MAX_ATTEMPTS:
                raise
            time.sleep(_BACKOFF_SECONDS * attempt)
