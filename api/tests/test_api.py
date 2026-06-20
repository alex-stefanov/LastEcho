"""Smoke tests covering the API contract the frontend depends on."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    # The context manager runs the lifespan, which loads the dataset.
    with TestClient(app) as c:
        yield c


def test_health_ok(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["count"] > 0
