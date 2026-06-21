"""National tier — live institution discovery from a language's lat/lng.

This is what lets the matcher cover any coordinate on Earth, not just the 10
hand-picked hotspots: reverse-geocode the point to a country (offline, no API
key), then query the ROR (Research Organization Registry) registry, filtered
to that country, for real research/government/education organizations whose
name suggests language work.

Verified live against api.ror.org: `filter=country.country_code:NG` for a
query of "indigenous languages" returns the National Institute for Nigerian
Languages — independently corroborating the hand-curated regional seed entry
for the same country. ROR is a real, neutral registry used by ORCID/Crossref/
funders; results here are tagged "auto-discovered" rather than "verified"
precisely because this is an automatic match, not a human-checked one.
"""

from __future__ import annotations

import logging
import math
import re
import time
from functools import lru_cache
from typing import Any

import httpx
import reverse_geocoder as rg

logger = logging.getLogger("lastecho")

# ISO 3166-1 alpha-2. Validated before it is interpolated into the ROR filter
# string — defense-in-depth against query injection if the source ever changes
# from the trusted reverse_geocoder `cc` field to something user-influenced.
_CC_RE = re.compile(r"^[A-Za-z]{2}$")

ROR_URL = "https://api.ror.org/v2/organizations"
QUERY_TERMS = ["indigenous languages", "endangered languages", "linguistics"]
# ROR v2 lowercases its `types` values (e.g. "education", not "Education").
RELEVANT_TYPES = {"government", "education", "facility", "nonprofit"}
KEYWORD_BOOST = (
    "indigenous", "endangered", "national institute", "academy of language",
    "linguistic", "national language", "minority language",
)
# Real ROR entries that match on keywords but aren't relevant here (commercial
# language schools, not institutions that could help document a language).
KEYWORD_BLOCK = ("school of languages", "language school", "language academy ltd")

# Ocean/remote-point sanity check: reverse_geocoder always snaps to *some*
# land point, even mid-ocean. If the match is implausibly far from the query,
# treat the country as unresolved rather than trust a misleading snap.
MAX_SNAP_KM = 300.0

# Per-call wall-clock budget across the three ROR queries below — each httpx
# call has its own 8s timeout, so without an aggregate cap one lookup could
# block ~24s. Bounds how long a single sweep/escalate item waits on ROR.
_TOTAL_DEADLINE_SECONDS = 12.0

# Caps on the third-party ROR fields we persist and later render in the admin
# UI. The name flows into the stored institution_id/name; the URL is rendered as
# a clickable href, so only http(s) is allowed (no javascript:/data: schemes).
_MAX_NAME = 200
_MAX_URL = 500


def _safe_url(value: Any) -> str | None:
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        return value[:_MAX_URL]
    return None


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# Each call runs a KD-tree query; build_ladder asks for the same coordinate
# twice (org pick + national pick), and the same languages repeat across every
# request. The result is a pure function of the coordinate, so memoize it —
# turning the repeats into dict hits. Bounded so it can't grow without limit.
@lru_cache(maxsize=4096)
def country_for(lat: float, lng: float) -> str | None:
    """Reverse-geocode to an ISO alpha-2 country code, or None if unreliable."""
    [match] = rg.search([(lat, lng)])
    dist = _haversine_km(lat, lng, float(match["lat"]), float(match["lon"]))
    if dist > MAX_SNAP_KM:
        return None
    cc = match.get("cc")
    return cc or None


def _display_name(org: dict[str, Any]) -> str:
    """ROR v2 stores names as a list of {lang, types, value} entries — the
    canonical display name is the one tagged "ror_display", not a flat field."""
    for entry in org.get("names", []):
        if "ror_display" in entry.get("types", []):
            return entry["value"]
    names = org.get("names", [])
    return names[0]["value"] if names else "Unknown organization"


def _is_relevant(org: dict[str, Any]) -> bool:
    name = _display_name(org).lower()
    if any(b in name for b in KEYWORD_BLOCK):
        return False
    types = {t.lower() for t in org.get("types", [])}
    if not types & RELEVANT_TYPES:
        return False
    return True


def _score(org: dict[str, Any]) -> int:
    name = _display_name(org).lower()
    return sum(1 for k in KEYWORD_BOOST if k in name)


def lookup_country_institutions(country_code: str, limit: int = 2) -> list[dict[str, Any]]:
    """Query ROR live for `country_code`. Network errors -> empty (caller falls
    back to the Continental tier rather than failing the whole sweep)."""
    if not _CC_RE.match(country_code):
        logger.warning("ignoring malformed country code for ROR lookup: %r", country_code)
        return []

    seen: dict[str, dict[str, Any]] = {}
    deadline = time.monotonic() + _TOTAL_DEADLINE_SECONDS
    try:
        with httpx.Client(timeout=8.0) as client:
            for term in QUERY_TERMS:
                if time.monotonic() >= deadline:
                    logger.warning("ROR lookup for %s hit its time budget; using partial results", country_code)
                    break
                resp = client.get(ROR_URL, params={"query": term, "filter": f"country.country_code:{country_code}"})
                resp.raise_for_status()
                for org in resp.json().get("items", []):
                    if not _is_relevant(org):
                        continue
                    rid = org.get("id", org.get("name"))
                    if rid not in seen:
                        seen[rid] = org
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("ROR lookup for %s failed, falling back: %s", country_code, exc)
        return []

    ranked = sorted(seen.values(), key=_score, reverse=True)[:limit]
    out = []
    for org in ranked:
        links = org.get("links") or []
        website = _safe_url(next((l.get("value") for l in links if l.get("type") == "website"), None))
        out.append(
            {
                # Clip/validate third-party fields before they are stored and
                # later rendered in the admin UI (see _MAX_NAME / _safe_url).
                "name": _display_name(org)[:_MAX_NAME],
                "type": next(iter(org.get("types", [])), "organization"),
                "url": website,
                "contact_url": website,
            }
        )
    return out
