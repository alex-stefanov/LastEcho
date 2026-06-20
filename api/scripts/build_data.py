"""Offline data build — generates the precomputed dataset the API serves.

This is the stand-in for the real train-and-predict pipeline. For now it emits a
deterministic mock dataset to ``data/languages.json``. Later, this same script
will load the training file, fit the model, and write (a) these precomputed
per-language predictions and (b) a saved model artifact for the future live
"score my language" endpoint.

It depends only on the standard library, so it can run without the API's
runtime dependencies.

Run from the api/ directory:  python scripts/build_data.py
"""

from __future__ import annotations

import json
import random
from pathlib import Path

# scripts/build_data.py -> api/
API_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = API_ROOT / "data" / "languages.json"

MIN_YEAR = 1990
MAX_YEAR = 2045
TODAY = 2026

# Deterministic — same seed every build, so the demo is reproducible.
rnd = random.Random(20260620)


def jitter(spread: float) -> float:
    # roughly-gaussian jitter in [-1.5, 1.5] * spread (sum of three uniforms)
    return (rnd.random() + rnd.random() + rnd.random() - 1.5) * spread


# Grounded in the real endangerment hotspots from PLAN.md.
HOTSPOTS = [
    {"name": "New Guinea Highlands", "lat": -5.6, "lng": 143.5, "spread": 6, "count": 34, "family": "Trans–New Guinea"},
    {"name": "Amazon Basin", "lat": -4.5, "lng": -64, "spread": 9, "count": 26, "family": "Arawakan"},
    {"name": "Northern Australia", "lat": -14, "lng": 133, "spread": 8, "count": 20, "family": "Pama–Nyungan"},
    {"name": "Caucasus", "lat": 42.6, "lng": 44.5, "spread": 3, "count": 13, "family": "Northeast Caucasian"},
    {"name": "Pacific Northwest", "lat": 50, "lng": -124, "spread": 6, "count": 14, "family": "Salishan"},
    {"name": "Mesoamerica", "lat": 17, "lng": -95, "spread": 5, "count": 14, "family": "Oto–Manguean"},
    {"name": "West Africa", "lat": 8, "lng": 6, "spread": 8, "count": 16, "family": "Niger–Congo"},
    {"name": "Eastern Himalaya", "lat": 27.5, "lng": 93, "spread": 5, "count": 18, "family": "Sino–Tibetan"},
    {"name": "Siberia", "lat": 62, "lng": 108, "spread": 12, "count": 12, "family": "Tungusic"},
    {"name": "Mainland SE Asia", "lat": 20, "lng": 101, "spread": 6, "count": 14, "family": "Austroasiatic"},
]

SYLL = ["ka", "wa", "mi", "tu", "na", "ku", "li", "ya", "ro", "en", "ba",
        "si", "to", "nga", "ai", "um", "da", "we", "pa", "ngu"]
DOC = ["none", "wordlist", "grammar sketch", "full grammar"]
SCATTER_FAMILIES = ["Sino–Tibetan", "Niger–Congo", "Austronesian", "Indo–European", "Uralic", "Isolate"]


def coin_name() -> str:
    n = 2 + int(rnd.random() * 2)
    out = "".join(SYLL[int(rnd.random() * len(SYLL))] for _ in range(n))
    return out[0].upper() + out[1:]


def build_profile() -> dict:
    r = rnd.random()
    if r < 0.4:
        return {"declineStart": None, "lostYear": None}  # stable / alive
    if r < 0.62:
        # chronic at-risk, some heading to loss
        lost = TODAY + int(rnd.random() * 18) if rnd.random() < 0.4 else None
        return {"declineStart": 1900, "lostYear": lost}
    if r < 0.85:
        # actively declining within the window
        decline_start = 1995 + int(rnd.random() * 30)
        return {"declineStart": decline_start, "lostYear": decline_start + 8 + int(rnd.random() * 32)}
    # already lost
    lost_year = 1992 + int(rnd.random() * 32)
    return {"declineStart": lost_year - (5 + int(rnd.random() * 15)), "lostYear": lost_year}


def speakers_for(profile: dict) -> int:
    if profile["lostYear"] is not None and profile["lostYear"] <= TODAY:
        return 0
    if profile["declineStart"] is not None and profile["declineStart"] <= TODAY:
        return 20 + int(rnd.random() * 3000)
    return 1500 + int(rnd.random() * 90000)


def doc_level() -> str:
    idx = min(3, int(rnd.random() * rnd.random() * 4 + rnd.random() * 0.6))
    return DOC[idx]


def generate() -> list[dict]:
    out: list[dict] = []
    next_id = 0

    def push(lat: float, lng: float, family: str, region: str) -> None:
        nonlocal next_id
        profile = build_profile()
        out.append({
            "id": next_id,
            "name": coin_name(),
            "lat": max(-78, min(80, lat)),
            "lng": ((lng + 540) % 360) - 180,
            "family": "Isolate" if rnd.random() < 0.08 else family,
            "region": region,
            "speakers": speakers_for(profile),
            "docLevel": doc_level(),
            "rank": 0,
            **profile,
        })
        next_id += 1

    for hotspot in HOTSPOTS:
        for _ in range(hotspot["count"]):
            push(
                hotspot["lat"] + jitter(hotspot["spread"]),
                hotspot["lng"] + jitter(hotspot["spread"]),
                hotspot["family"],
                hotspot["name"],
            )

    # Sparse global scatter so the whole planet reads as inhabited.
    for _ in range(30):
        push(
            jitter(36) + 18,
            rnd.random() * 360 - 180,
            SCATTER_FAMILIES[int(rnd.random() * len(SCATTER_FAMILIES))],
            "Scattered",
        )

    # Triage rank (placeholder proxy): soonest-closing window first, lost last.
    def urgency(lang: dict) -> float:
        if lang["lostYear"] is not None and lang["lostYear"] <= TODAY:
            return -1  # already lost
        if lang["lostYear"] is not None:
            return MAX_YEAR + 1 - lang["lostYear"]  # sooner = higher
        if lang["declineStart"] is not None:
            return 4
        return 0

    def doc_gap(lang: dict) -> int:
        return 3 - DOC.index(lang["docLevel"])  # thinner record = higher

    out.sort(key=lambda lang: urgency(lang) * 4 + doc_gap(lang), reverse=True)
    for i, lang in enumerate(out):
        lang["rank"] = i + 1

    return out


def main() -> None:
    languages = generate()
    payload = {
        "meta": {"minYear": MIN_YEAR, "maxYear": MAX_YEAR, "today": TODAY},
        "languages": languages,
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(languages)} languages -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
