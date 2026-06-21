"""Coverage for the security/robustness fixes: admin auth gating, SMTP recipient
validation (header-injection guard), and the atomic send claim that prevents a
draft from being sent twice."""

from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app import mailer, store_db
from app.auth import verify_admin
from app.routers import admin_auth


def _admin_app(monkeypatch, *, configured: bool = True) -> FastAPI:
    """A tiny app with the login router and one verify_admin-gated route, wired
    to a fake settings object so the test controls the credentials."""
    fake = SimpleNamespace(
        admin_user="admin",
        admin_password="s3cret" if configured else None,
        admin_token="tok-123",  # used as the token signing key (see tokens.py)
        admin_token_ttl_seconds=3600,
        admin_configured=configured,
    )
    monkeypatch.setattr(admin_auth, "settings", fake)
    monkeypatch.setattr("app.auth.settings", fake)

    app = FastAPI()
    app.include_router(admin_auth.router)

    @app.get("/api/secret", dependencies=[Depends(verify_admin)])
    def secret() -> dict:
        return {"ok": True}

    return app


# --- admin auth -------------------------------------------------------------

def test_login_returns_token_and_gates_admin_route(monkeypatch):
    client = TestClient(_admin_app(monkeypatch))

    # No token -> rejected.
    assert client.get("/api/secret").status_code == 401

    # Wrong password -> 401, no token.
    assert client.post("/api/admin/login", json={"user": "admin", "password": "nope"}).status_code == 401

    # Correct credentials -> token, which then unlocks the gated route.
    res = client.post("/api/admin/login", json={"user": "admin", "password": "s3cret"})
    assert res.status_code == 200
    token = res.json()["token"]
    assert client.get("/api/secret", headers={"X-Admin-Token": token}).status_code == 200
    assert client.get("/api/secret", headers={"X-Admin-Token": "wrong"}).status_code == 401


def test_admin_fails_closed_when_unconfigured(monkeypatch):
    client = TestClient(_admin_app(monkeypatch, configured=False))
    # With no password set, both login and the gated route refuse with 503 —
    # there is no client-only bypass.
    assert client.post("/api/admin/login", json={"user": "admin", "password": "x"}).status_code == 503
    assert client.get("/api/secret", headers={"X-Admin-Token": "tok-123"}).status_code == 503


def test_login_with_non_ascii_credentials_is_401_not_500(monkeypatch):
    """secrets.compare_digest raises on non-ASCII str — an unauthenticated client
    must not be able to crash login (500) by sending a Unicode password."""
    client = TestClient(_admin_app(monkeypatch))
    res = client.post("/api/admin/login", json={"user": "admin", "password": "pässwört"})
    assert res.status_code == 401  # rejected, not a 500


def test_token_expires(monkeypatch):
    """An expired token no longer unlocks the gated route."""
    from app import tokens

    key = "tok-123"
    fresh = tokens.issue(key, ttl_seconds=3600)
    assert tokens.verify(fresh, key) is True

    expired = tokens.issue(key, ttl_seconds=-1)  # already past its deadline
    assert tokens.verify(expired, key) is False
    # Tampered signature / wrong key are rejected too.
    assert tokens.verify(fresh, "other-key") is False
    assert tokens.verify(fresh[:-1] + ("x" if fresh[-1] != "x" else "y"), key) is False


# --- SMTP recipient validation (header injection) ---------------------------

@pytest.mark.parametrize("bad", ["a@x.com\nBcc: victim@y.com", "a@x.com, b@y.com", "not-an-email", "a@x.com\r\nSubject: x"])
def test_send_rejects_injection_addresses(bad):
    settings = SimpleNamespace(
        smtp_host="smtp.test", smtp_from="from@test", smtp_port=587,
        smtp_user=None, smtp_password=None, smtp_use_tls=True,
    )
    with pytest.raises(ValueError):
        mailer.send(to=bad, subject="hi", body="body", settings=settings)


# --- Postmark HTTP API transport --------------------------------------------

def _postmark_settings():
    # Token set, no SMTP host: the API path must be chosen.
    return SimpleNamespace(postmark_token="tok-123", smtp_from="from@test", smtp_host=None)


def test_is_configured_true_with_postmark_token_only():
    assert mailer.is_configured(_postmark_settings())


def test_send_uses_postmark_api_when_token_set(monkeypatch):
    captured = {}

    class _Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ErrorCode": 0, "Message": "OK"}'

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["token"] = req.headers.get("X-postmark-server-token")
        return _Resp()

    monkeypatch.setattr(mailer.urllib.request, "urlopen", fake_urlopen)
    mailer.send(to="friend@example.com", subject="hi", body="body", settings=_postmark_settings())
    assert captured["url"] == mailer._POSTMARK_API_URL
    assert captured["token"] == "tok-123"


def test_send_raises_on_postmark_error_code(monkeypatch):
    class _Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ErrorCode": 406, "Message": "Inactive recipient"}'

    monkeypatch.setattr(mailer.urllib.request, "urlopen", lambda req, timeout=None: _Resp())
    with pytest.raises(RuntimeError, match="Inactive recipient"):
        mailer.send(to="friend@example.com", subject="hi", body="body", settings=_postmark_settings())


# --- atomic send claim (no double send) -------------------------------------

def test_set_status_if_is_atomic(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    store_db.create_tables(conn)
    draft_id = store_db.insert_draft(
        conn, language_id=1, institution_id="i", tier="local", subject="s", body="b",
        ask="a", language_name="L", institution_name="I", institution_url="",
        institution_contact_url="", institution_email="x@y.com",
    )
    store_db.set_status(conn, draft_id, "approved")

    # First claim wins; a second concurrent claim from 'approved' loses.
    assert store_db.set_status_if(conn, draft_id, "approved", "sent") is True
    assert store_db.set_status_if(conn, draft_id, "approved", "sent") is False
    assert store_db.get_draft(conn, draft_id)["status"] == "sent"

    # Revert restores approved and clears sent_at.
    store_db.revert_send_claim(conn, draft_id)
    row = store_db.get_draft(conn, draft_id)
    assert row["status"] == "approved"
    assert row["sent_at"] is None
    conn.close()


# --- recipient editing (S4: empty string is an explicit clear) --------------

def test_update_draft_empty_email_clears_to_null():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    store_db.create_tables(conn)
    draft_id = store_db.insert_draft(
        conn, language_id=1, institution_id="i", tier="local", subject="s", body="b",
        ask="a", language_name="L", institution_name="I", institution_url="",
        institution_contact_url="", institution_email="x@y.com",
    )
    # Empty string clears the recipient to NULL rather than storing "".
    store_db.update_draft(conn, draft_id, institution_email="")
    assert store_db.get_draft(conn, draft_id)["institution_email"] is None

    # A real address is stored as-is; None leaves the field untouched.
    store_db.update_draft(conn, draft_id, institution_email="new@y.com")
    store_db.update_draft(conn, draft_id, subject="changed")
    row = store_db.get_draft(conn, draft_id)
    assert row["institution_email"] == "new@y.com"
    assert row["subject"] == "changed"
    conn.close()


# --- response hardening (S2 docs gating, S5 security headers) ----------------

def test_security_headers_and_docs_toggle(monkeypatch):
    from app import config, main

    # The "/" service-info route needs no DataStore, so these requests work
    # without running the app lifespan (which would load data + warm geocoding).

    # expose_docs=True -> docs reachable, no HSTS (assumed local HTTP).
    monkeypatch.setattr(main, "settings", config.Settings())
    open_client = TestClient(main.create_app())
    r = open_client.get("/")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "Strict-Transport-Security" not in r.headers
    assert open_client.get("/openapi.json").status_code == 200

    # expose_docs=False -> docs hidden (404) and HSTS present.
    monkeypatch.setenv("LASTECHO_EXPOSE_DOCS", "false")
    monkeypatch.setattr(main, "settings", config.Settings())
    closed_client = TestClient(main.create_app())
    assert closed_client.get("/openapi.json").status_code == 404
    assert "Strict-Transport-Security" in closed_client.get("/").headers
