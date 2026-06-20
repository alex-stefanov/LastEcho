"""Real, emailable language organizations (language_organizations.json).

These differ from the hand-verified institutions in one decisive way: every
entry has a deliverable email address, so they are the rungs the send endpoint
can actually transmit to. They are folded into the existing escalation ladder
as a *local* candidate (see matching._org_pick) — reusing the draft/send
pipeline rather than introducing a parallel one.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import national_lookup
from .schemas import Institution, Organization


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "org"


def load_organizations(path: Path) -> list[Organization]:
    """Read, validate, and reverse-geocode each org's country once.

    Missing/malformed file -> empty list: orgs are an enrichment, not a hard
    dependency, so their absence must never break startup (the ladder still has
    its verified institutions). `cc` is resolved here so matching never pays the
    reverse-geocode cost on the request path.
    """
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    orgs: list[Organization] = []
    for item in raw:
        try:
            org = Organization.model_validate(item)
        except Exception:
            continue  # skip a single bad record rather than drop the whole file
        org.cc = national_lookup.country_for(org.latitude, org.longitude)
        orgs.append(org)
    return orgs


def to_institution(org: Organization) -> Institution:
    """Adapt an Organization onto the Institution shape the ladder/draft/send
    pipeline already speaks. Scope "regional" lands it in the local rung; the
    email is the whole point — it's what makes the draft actually sendable."""
    return Institution(
        id=f"org-{_slug(org.name)}",
        name=org.name,
        type="language organization",
        scope="regional",
        confidence="verified",
        regions=[],
        families=[],
        continents=[],
        countries=[org.cc] if org.cc else [],
        helpTypes=["document", "teach"],
        url="",
        contactUrl=f"mailto:{org.email}",
        email=org.email,
        blurb=f"{org.name} — a language organization in {org.city}, {org.country}.",
    )
