"""Builds each language's escalation ladder: local -> continental -> global.

"Local" is whichever is better: a hand-verified Regional hotspot institution
(if the language's region is one of the 10 named hotspots) or a live
National-tier match from its lat/lng (everything else, including the 30
"Scattered" mock languages). Continental and Global are always hand-verified
fallbacks. This ladder is what the triage sweep climbs as institutions don't
reply — see triage.py.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from . import national_lookup, organizations as organizations_mod, store_db
from .schemas import Institution, InstitutionsFile, Language, Organization

# Coarse continent bounding boxes — just enough to pick the right Continental
# fallback entry, not precise geocoding (that's what the National tier is for).
_CONTINENT_BOXES: list[tuple[str, float, float, float, float]] = [
    # name, min_lat, max_lat, min_lng, max_lng
    ("Europe", 36, 72, -25, 45),
    ("Africa", -35, 37, -18, 52),
    ("Oceania", -50, 0, 110, 180),
    ("Americas", -56, 72, -170, -34),
    ("Asia", -10, 77, 45, 180),
]


def continent_for(lat: float, lng: float) -> str | None:
    for name, min_lat, max_lat, min_lng, max_lng in _CONTINENT_BOXES:
        if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng:
            return name
    return None


@dataclass
class LadderRung:
    tier: str  # "local" | "continental" | "global"
    institution: Institution


def _global_pick(institutions: list[Institution]) -> Institution:
    # Endangered Languages Project first if present — the broadest, most
    # actionable global catalogue; otherwise whatever global entry exists.
    globals_ = [i for i in institutions if i.scope == "global"]
    for i in globals_:
        if i.id == "elp":
            return i
    return globals_[0]


def _continental_pick(institutions: list[Institution], continent: str | None) -> Institution | None:
    if continent is None:
        return None
    for i in institutions:
        if i.scope == "continental" and continent in i.continents:
            return i
    return None  # e.g. Asia has no continent-wide body — falls through to global


def _regional_pick(institutions: list[Institution], region: str) -> Institution | None:
    for i in institutions:
        if i.scope == "regional" and region in i.regions:
            return i
    return None


def _org_pick(
    organizations: list[Organization], lat: float, lng: float
) -> Institution | None:
    """The nearest real, emailable organization in the *same country* as the
    language. Reuses the National tier's offline reverse-geocode for the country
    gate (so a Portugal org never gets matched to a language in Mali) and picks
    the closest by great-circle distance among the in-country candidates."""
    if not organizations:
        return None
    cc = national_lookup.country_for(lat, lng)
    if cc is None:
        return None
    in_country = [o for o in organizations if o.cc == cc]
    if not in_country:
        return None
    nearest = min(
        in_country,
        key=lambda o: national_lookup._haversine_km(lat, lng, o.latitude, o.longitude),
    )
    return organizations_mod.to_institution(nearest)


def _national_pick(
    conn: sqlite3.Connection, lat: float, lng: float, ttl_days: int
) -> Institution | None:
    cc = national_lookup.country_for(lat, lng)
    if cc is None:
        return None
    cached = store_db.get_cached_country(conn, cc, ttl_days)
    if cached is None:
        live = national_lookup.lookup_country_institutions(cc)
        store_db.set_cached_country(conn, cc, live)
        cached = live
    if not cached:
        return None
    top = cached[0]
    return Institution(
        id=f"national-{cc}-{top['name']}",
        name=top["name"],
        type=top.get("type") or "organization",
        scope="national",
        confidence="auto-discovered",
        regions=[],
        families=[],
        continents=[],
        countries=[cc],
        helpTypes=["document"],
        url=top.get("url") or "",
        contactUrl=top.get("contact_url") or top.get("url") or "",
        email=None,
        blurb=f"Auto-discovered via the ROR registry for this language's location ({cc}).",
    )


def build_ladder(
    conn: sqlite3.Connection,
    institutions_file: InstitutionsFile,
    language: Language,
    *,
    ror_cache_ttl_days: int,
    organizations: list[Organization] | None = None,
) -> list[LadderRung]:
    """The 3-rung escalation ladder for one language: local -> continental -> global.

    Local priority: a hand-verified regional hotspot first, then the nearest
    real emailable organization in-country (the rung the send endpoint can
    actually transmit to), then a live national ROR match as the last local
    resort."""
    institutions = institutions_file.institutions
    continent = continent_for(language.lat, language.lng)

    local = (
        _regional_pick(institutions, language.region)
        or _org_pick(organizations or [], language.lat, language.lng)
        or _national_pick(conn, language.lat, language.lng, ror_cache_ttl_days)
    )
    continental = _continental_pick(institutions, continent)
    glob = _global_pick(institutions)

    ladder = []
    if local:
        ladder.append(LadderRung("local", local))
    if continental:
        ladder.append(LadderRung("continental", continental))
    ladder.append(LadderRung("global", glob))  # always present — final rung
    return ladder


def matched_institutions(
    conn: sqlite3.Connection,
    institutions_file: InstitutionsFile,
    language: Language,
    *,
    ror_cache_ttl_days: int,
    organizations: list[Organization] | None = None,
) -> list[Institution]:
    """All informational matches for the public read-only chips (not just the
    ladder rung currently being drafted) — same priority order, local first."""
    return [rung.institution for rung in build_ladder(
        conn, institutions_file, language,
        ror_cache_ttl_days=ror_cache_ttl_days, organizations=organizations,
    )]
