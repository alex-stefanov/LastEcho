"""Coverage for the outreach ("response layer") pipeline: matcher tiering,
sweep idempotency, the escalation ladder, and the national tier's lat/lng
pipeline. ROR is mocked here for CI reliability — it was verified live against
the real api.ror.org during development (see PLAN.md), independently
returning the same institution (NINLAN) as the hand-curated seed entry for
the same country.
"""

from __future__ import annotations

import sqlite3
from unittest.mock import MagicMock, patch

import pytest

from app import matching, national_lookup, store_db, triage
from app.schemas import Institution, InstitutionsFile, Language

NEW_GUINEA = Language(
    id=1, name="Testu", lat=-5.6, lng=143.5, family="Trans–New Guinea",
    region="New Guinea Highlands", speakers=200, docLevel="none", rank=1,
    declineStart=2000, lostYear=2030,
)
SCATTERED = Language(
    id=2, name="Scatu", lat=8.0, lng=6.0, family="Niger–Congo",
    region="Scattered", speakers=500, docLevel="wordlist", rank=2,
    declineStart=None, lostYear=None,
)
OCEAN = Language(
    id=3, name="Oceu", lat=0.0, lng=-150.0, family="Isolate",
    region="Scattered", speakers=10, docLevel="none", rank=3,
    declineStart=2010, lostYear=2026,
)

INSTITUTIONS = InstitutionsFile(
    institutions=[
        Institution(
            id="paradisec", name="PARADISEC", type="university", scope="regional",
            confidence="verified", regions=["New Guinea Highlands"], families=[],
            continents=[], countries=[], helpTypes=["archive"],
            url="https://paradisec.org.au", contactUrl="https://paradisec.org.au/contact",
            email=None, blurb="x",
        ),
        Institution(
            id="acalan", name="ACALAN", type="government", scope="continental",
            confidence="verified", regions=[], families=[], continents=["Africa"],
            countries=[], helpTypes=["advocate"], url="https://acalanau.org",
            contactUrl="https://acalanau.org/contact", email=None, blurb="x",
        ),
        Institution(
            id="elp", name="Endangered Languages Project", type="documentation",
            scope="global", confidence="verified", regions=[], families=[],
            continents=[], countries=[], helpTypes=["document"],
            url="https://endangeredlanguages.com", contactUrl="https://endangeredlanguages.com/contact",
            email=None, blurb="x",
        ),
    ]
)


@pytest.fixture
def conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    store_db.create_tables(c)
    yield c
    c.close()


def _ror_response(items):
    resp = MagicMock()
    resp.json.return_value = {"items": items}
    resp.raise_for_status.return_value = None
    return resp


NINLAN_ITEM = {
    "id": "https://ror.org/01v5dbc85",
    "names": [{"lang": "en", "types": ["ror_display"], "value": "National Institute for Nigerian Languages"}],
    "types": ["education"],
    "links": [{"type": "website", "value": "https://ninlan.edu.ng"}],
}


# --- matcher tiering ---------------------------------------------------------

def test_regional_outranks_national_and_global(conn):
    ladder = matching.build_ladder(conn, INSTITUTIONS, NEW_GUINEA, ror_cache_ttl_days=30)
    assert ladder[0].tier == "local"
    assert ladder[0].institution.id == "paradisec"
    assert ladder[0].institution.confidence == "verified"
    assert ladder[-1].tier == "global"


def test_continental_fallback_for_scattered_language(conn):
    with patch("app.national_lookup.httpx.Client") as MockClient:
        MockClient.return_value.__enter__.return_value.get.return_value = _ror_response([NINLAN_ITEM])
        ladder = matching.build_ladder(conn, INSTITUTIONS, SCATTERED, ror_cache_ttl_days=30)
    tiers = [r.tier for r in ladder]
    assert "local" in tiers  # national pick, auto-discovered
    local = next(r for r in ladder if r.tier == "local")
    assert local.institution.confidence == "auto-discovered"
    assert local.institution.name == "National Institute for Nigerian Languages"
    assert "continental" in tiers  # Africa -> ACALAN
    assert ladder[-1].institution.id == "elp"


def test_ocean_point_has_no_local_or_continental_match(conn):
    # Mid-Pacific: reverse_geocoder will snap to *something*, but it's >300km
    # away, so country_for must return None rather than a misleading country.
    cc = national_lookup.country_for(OCEAN.lat, OCEAN.lng)
    assert cc is None
    ladder = matching.build_ladder(conn, INSTITUTIONS, OCEAN, ror_cache_ttl_days=30)
    assert [r.tier for r in ladder] == ["global"]  # only the always-present fallback


# --- national tier: ROR filtering + caching ---------------------------------

def test_ror_lookup_filters_and_caches(conn):
    with patch("app.national_lookup.httpx.Client") as MockClient:
        get = MockClient.return_value.__enter__.return_value.get
        get.return_value = _ror_response([NINLAN_ITEM])
        results = national_lookup.lookup_country_institutions("NG")
        call_count_after_first = get.call_count

    assert results[0]["name"] == "National Institute for Nigerian Languages"
    assert call_count_after_first == len(national_lookup.QUERY_TERMS)

    # Cache a second "language" in the same country — must not hit ROR again.
    store_db.set_cached_country(conn, "NG", results)
    with patch("app.national_lookup.httpx.Client") as MockClient2:
        cached = store_db.get_cached_country(conn, "NG", ttl_days=30)
        assert cached is not None
        assert cached[0]["name"] == "National Institute for Nigerian Languages"
        MockClient2.assert_not_called()


def test_ror_network_failure_falls_back_gracefully():
    import httpx as httpx_module

    with patch("app.national_lookup.httpx.Client") as MockClient:
        MockClient.return_value.__enter__.return_value.get.side_effect = httpx_module.ConnectError("boom")
        results = national_lookup.lookup_country_institutions("NG")
    assert results == []


# --- triage sweep: top-N selection + idempotency ----------------------------

def test_sweep_drafts_only_top_n_and_is_idempotent(conn):
    languages = [NEW_GUINEA, SCATTERED, OCEAN]
    with patch("app.national_lookup.httpx.Client") as MockClient:
        MockClient.return_value.__enter__.return_value.get.return_value = _ror_response([NINLAN_ITEM])

        result = triage.run_sweep(
            conn, languages, INSTITUTIONS, top_n=2, ror_cache_ttl_days=30, anthropic_api_key=None,
        )
        assert result.drafted == 2  # top_n=2 by rank: NEW_GUINEA (1), SCATTERED (2)
        assert result.skipped == 0

        rows = store_db.list_drafts(conn)
        assert len(rows) == 2
        assert all(r["status"] == "pending_review" for r in rows)

        # Re-running must not duplicate — idempotent.
        result2 = triage.run_sweep(
            conn, languages, INSTITUTIONS, top_n=2, ror_cache_ttl_days=30, anthropic_api_key=None,
        )
    assert result2.drafted == 0
    assert result2.skipped == 2
    assert len(store_db.list_drafts(conn)) == 2


# --- approve/reject + escalation ladder -------------------------------------

def test_approve_reject_transitions(conn):
    draft_id = store_db.insert_draft(
        conn, language_id=1, institution_id="paradisec", tier="local",
        subject="s", body="b", ask="a", language_name="Testu",
        institution_name="PARADISEC", institution_url="https://x", institution_contact_url="https://x",
        institution_email=None,
    )
    store_db.set_status(conn, draft_id, "approved")
    assert store_db.get_draft(conn, draft_id)["status"] == "approved"
    store_db.set_status(conn, draft_id, "rejected")
    assert store_db.get_draft(conn, draft_id)["status"] == "rejected"


def test_escalate_advances_to_next_rung_then_stops_at_global(conn):
    with patch("app.national_lookup.httpx.Client") as MockClient:
        MockClient.return_value.__enter__.return_value.get.return_value = _ror_response([])
        ladder = matching.build_ladder(conn, INSTITUTIONS, SCATTERED, ror_cache_ttl_days=30)
    # No ROR results -> national pick is None -> local tier absent; ladder is
    # continental (ACALAN, Africa) then global.
    assert [r.tier for r in ladder] == ["continental", "global"]

    draft_id = store_db.insert_draft(
        conn, language_id=SCATTERED.id, institution_id="acalan", tier="continental",
        subject="s", body="b", ask="a", language_name="Scatu",
        institution_name="ACALAN", institution_url="https://x", institution_contact_url="https://x",
        institution_email=None,
    )
    store_db.set_status(conn, draft_id, "approved")
    store_db.set_status(conn, draft_id, "sent")

    with patch("app.national_lookup.httpx.Client") as MockClient:
        MockClient.return_value.__enter__.return_value.get.return_value = _ror_response([])
        new_row = triage.escalate(
            conn, {SCATTERED.id: SCATTERED}, INSTITUTIONS, draft_id,
            ror_cache_ttl_days=30, anthropic_api_key=None,
        )
    assert new_row["tier"] == "global"
    assert new_row["institution_id"] == "elp"
    assert store_db.get_draft(conn, draft_id)["status"] == "no_reply"

    # Escalating again from the global rung has nowhere further to go.
    store_db.set_status(conn, new_row["id"], "approved")
    store_db.set_status(conn, new_row["id"], "sent")
    with patch("app.national_lookup.httpx.Client") as MockClient:
        MockClient.return_value.__enter__.return_value.get.return_value = _ror_response([])
        result = triage.escalate(
            conn, {SCATTERED.id: SCATTERED}, INSTITUTIONS, new_row["id"],
            ror_cache_ttl_days=30, anthropic_api_key=None,
        )
    assert result is None
