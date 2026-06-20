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
        admin_token="tok-123",
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


# --- SMTP recipient validation (header injection) ---------------------------

@pytest.mark.parametrize("bad", ["a@x.com\nBcc: victim@y.com", "a@x.com, b@y.com", "not-an-email", "a@x.com\r\nSubject: x"])
def test_send_rejects_injection_addresses(bad):
    settings = SimpleNamespace(
        smtp_host="smtp.test", smtp_from="from@test", smtp_port=587,
        smtp_user=None, smtp_password=None, smtp_use_tls=True,
    )
    with pytest.raises(ValueError):
        mailer.send(to=bad, subject="hi", body="body", settings=settings)


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
