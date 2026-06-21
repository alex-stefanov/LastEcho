"""Offline data build — generates the precomputed dataset the API serves.

Reads the real Glottolog snapshot the frontend ships
(client/src/data/timeline_by_year/{TODAY}.json) and emits the outreach
dataset to ``data/languages.json``, ranked by the *same* triage score the
frontend's Rescue Queue uses (ported from client/src/data/triage.ts). This is
what makes the outreach queue draft real, triage-ordered languages rather than
placeholder data.

It depends only on the standard library. Run from the api/ directory:

    python scripts/build_data.py
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

# scripts/build_data.py -> api/
API_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = API_ROOT.parent
TIMELINE_DIR = REPO_ROOT / "client" / "src" / "data" / "timeline_by_year"
OUTPUT_PATH = API_ROOT / "data" / "languages.json"

TODAY = 2026

# Default triage weights — mirror DEFAULT_WEIGHTS in client/src/data/triage.ts
# so the backend's drafting order matches the Rescue Queue's default view.
W_URGENCY = 5
W_POPULATION = 3
W_UNIQUENESS = 2

# Signal 1: extinction urgency from the Glottolog 8-level risk scale.
# Mirrors RISK_SCORE in triage.ts.
RISK_SCORE = {
    "critical": 1.00,
    "at_risk": 0.80,
    "vulnerable": 0.55,
    "unknown": 0.25,
    "stable": 0.20,
    "recovering": 0.10,
    "alive": 0.05,
    "lost": 0.00,
}


def _urgency_signal(risk: str) -> float:
    return RISK_SCORE.get(risk, 0.25)


def _population_signal(speakers: int | None, log_max: float) -> float:
    # Fewer speakers = higher need; unknown/none counts as maximum need.
    if speakers is None or speakers <= 0:
        return 1.0
    if log_max <= 0:
        return 0.0
    return 1 - math.log(speakers + 1) / log_max


def _uniqueness_signal(family_root: str, family_sizes: dict[str, int]) -> float:
    # Last of its family = most unique. Mirrors uniquenessSignal in triage.ts.
    n = family_sizes.get(family_root, 1)
    if n == 1:
        return 1.00
    if n <= 3:
        return 0.75
    if n <= 10:
        return 0.45
    if n <= 30:
        return 0.20
    return 0.05


def _triage_score(lang: dict, log_max: float, family_sizes: dict[str, int]) -> float:
    total = W_URGENCY + W_POPULATION + W_UNIQUENESS
    return (
        W_URGENCY * _urgency_signal(lang["risk"])
        + W_POPULATION * _population_signal(lang.get("speakers"), log_max)
        + W_UNIQUENESS * _uniqueness_signal(lang.get("family_root") or "Unknown", family_sizes)
    ) / total


def _stable_id(iso_code: str) -> int:
    """A deterministic, JS-safe (<2^53) int id derived from the ISO code, so ids
    stay stable across rebuilds — the sweep keys "already contacted" on id, and a
    stable id means a yearly rebuild never re-drafts a language already handled."""
    return int(hashlib.sha1(iso_code.encode("utf-8")).hexdigest()[:12], 16)


def generate() -> list[dict]:
    snapshot = json.loads((TIMELINE_DIR / f"{TODAY}.json").read_text(encoding="utf-8"))
    langs = snapshot["languages"]

    # Eligible for outreach: not already lost, and not a positive-zero speaker
    # count (mirrors rankLanguages' filter in triage.ts). Null speakers are kept.
    eligible = [
        l for l in langs
        if l.get("risk") != "lost"
        and (l.get("speakers") is None or l["speakers"] > 0)
        and l.get("latitude_map") is not None
        and l.get("longitude_map") is not None
    ]

    # Dataset-wide normalizers, computed once (as in triage.ts buildLogMax / buildFamilySizes).
    max_speakers = max((l["speakers"] for l in eligible if l.get("speakers")), default=0)
    log_max = math.log(max_speakers + 1)
    family_sizes: dict[str, int] = {}
    for l in eligible:
        fam = l.get("family_root") or "Unknown"
        family_sizes[fam] = family_sizes.get(fam, 0) + 1

    eligible.sort(key=lambda l: _triage_score(l, log_max, family_sizes), reverse=True)

    out: list[dict] = []
    for i, l in enumerate(eligible):
        out.append({
            "id": _stable_id(l["iso_code"]),
            "name": l["name"],
            "lat": l["latitude_map"],
            "lng": l["longitude_map"],
            "family": l.get("family_root") or "Unknown",
            "region": "",  # no hotspot grouping in the real snapshot; regional rung is skipped
            "speakers": l.get("speakers"),
            "docLevel": None,  # not present in the snapshot
            "risk": l.get("risk"),
            "rank": i + 1,  # 1 = most urgent by triage score
            "declineStart": None,
            "lostYear": None,
        })
    return out


def main() -> None:
    languages = generate()
    payload = {
        "meta": {"minYear": 2000, "maxYear": 2050, "today": TODAY},
        "languages": languages,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(languages)} languages to {OUTPUT_PATH} (ranked by triage score).")


if __name__ == "__main__":
    main()
