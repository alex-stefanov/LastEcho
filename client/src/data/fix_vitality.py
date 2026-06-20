"""
fix_vitality.py
Fixes two issues in timeline_by_year/ JSON files:
  1. Vitality classification uses a 10-year context window, not the last 1-2 years.
  2. Scenario projections use each language's own observed rate, not a blanket category rate.
Writes *_v2.json files. Never touches originals.
"""

import json
import math
import os
import csv
from collections import defaultdict

# ── Constants ────────────────────────────────────────────────────────────────
MAX_PROJ_GROWTH  =  0.015
MAX_PROJ_DECLINE = -0.035
FLAT_BAND        =  0.005
SPEAKER_FLOOR    =  0.30

CONTEXT_WINDOW   = 10   # years

GROWTH        =  0.01
MILD_DECLINE  = -0.015
DECLINE       = -0.04
STEEP_DECLINE = -0.08
CRITICAL_SIZE =  50
SMALL_SIZE    =  1000
EXTINCT_MAX   =  10

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
YEAR_DIR = os.path.join(DATA_DIR, "timeline_by_year")

OBSERVED_YEARS      = {2018, 2023, 2024}
INTERPOLATED_YEARS  = set(range(2019, 2023))   # 2019–2022
SCENARIO_YEARS      = set(range(2025, 2051))
BACKCAST_YEARS      = set(range(2000, 2018))
ALL_YEARS           = sorted(range(2000, 2051))

# ── Load all year files ───────────────────────────────────────────────────────
print("Loading year files…")
year_data = {}   # year -> {iso_code -> record}
for yr in ALL_YEARS:
    path = os.path.join(YEAR_DIR, f"{yr}.json")
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    year_data[yr] = {rec["iso_code"]: rec for rec in raw["languages"]}

# Collect the top-level metadata (year, language_count) per file
year_meta = {}
for yr in ALL_YEARS:
    path = os.path.join(YEAR_DIR, f"{yr}.json")
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    year_meta[yr] = {k: v for k, v in raw.items() if k != "languages"}

all_iso = set()
for yr in ALL_YEARS:
    all_iso.update(year_data[yr].keys())
print(f"  {len(all_iso)} unique languages across {len(ALL_YEARS)} years")

# ── Step 1: Build per-language series ────────────────────────────────────────
print("Step 1 — building series…")

# For each language: sorted list of (year, speakers, series_type)
lang_series = defaultdict(list)
for yr in ALL_YEARS:
    for iso, rec in year_data[yr].items():
        sp = rec.get("speakers")
        st = rec.get("series_type", "unknown")
        lang_series[iso].append((yr, sp, st))

for iso in lang_series:
    lang_series[iso].sort(key=lambda x: x[0])

# ── Step 2: Measure each language's observed trend ───────────────────────────
print("Step 2 — computing observed trends…")

def annualized_rate(sp_start, sp_end, years):
    """Compound annual growth rate."""
    if not sp_start or not sp_end or years == 0:
        return None
    if sp_start <= 0 or sp_end <= 0:
        return None
    return (sp_end / sp_start) ** (1 / years) - 1

lang_trend = {}   # iso -> {observed_rate, trend_confidence, sp_2024, sp_2023, sp_2018}

for iso, series in lang_series.items():
    by_year = {yr: sp for yr, sp, st in series if sp is not None and sp > 0}

    sp_2018 = by_year.get(2018)
    sp_2023 = by_year.get(2023)
    sp_2024 = by_year.get(2024)

    # Prefer 2023→2024 (same-source, 1 year)
    if sp_2023 is not None and sp_2024 is not None:
        rate = annualized_rate(sp_2023, sp_2024, 1)
        confidence = "high"
        source = "2023→2024"
    # Fall back to 2018→2023 (cross-source, 5 years)
    elif sp_2018 is not None and sp_2023 is not None:
        rate = annualized_rate(sp_2018, sp_2023, 5)
        confidence = "low"
        source = "2018→2023 (cross-source)"
    elif sp_2018 is not None and sp_2024 is not None:
        rate = annualized_rate(sp_2018, sp_2024, 6)
        confidence = "low"
        source = "2018→2024 (cross-source)"
    else:
        rate = None
        confidence = "low"
        source = "no observed interval"

    lang_trend[iso] = {
        "observed_rate": rate,
        "trend_confidence": confidence,
        "trend_source": source,
        "sp_2018": sp_2018,
        "sp_2023": sp_2023,
        "sp_2024": sp_2024,
    }

low_conf = sum(1 for v in lang_trend.values() if v["trend_confidence"] == "low")
print(f"  trend_confidence=low: {low_conf} / {len(lang_trend)}")

# ── Step 3: Compute corrected projections ─────────────────────────────────────
print("Step 3 — correcting projections…")

def projected_rate(observed_rate):
    """Clamp observed rate per rules; treat near-flat as flat."""
    if observed_rate is None:
        return 0.0
    if abs(observed_rate) < FLAT_BAND:
        return 0.0
    return max(MAX_PROJ_DECLINE, min(MAX_PROJ_GROWTH, observed_rate))

# For each language, compute the corrected speaker count for every year
# that is NOT observed (i.e. not 2018/2023/2024).
# Anchor forward projections from 2024; anchor backcasts from 2018.

corrected_speakers = {}   # iso -> {year -> corrected_speakers}

for iso, trend in lang_trend.items():
    sp_2024 = trend["sp_2024"]
    sp_2018 = trend["sp_2018"]
    rate    = projected_rate(trend["observed_rate"])
    obs_r   = trend["observed_rate"]

    corr = {}

    # Forward: 2025–2050 anchored from 2024
    if sp_2024 is not None:
        floor_val = sp_2024 * SPEAKER_FLOOR
        # Only relax floor if observed rate justifies steeper loss
        # (observed_rate < MAX_PROJ_DECLINE means it IS genuinely steep)
        use_floor = not (obs_r is not None and obs_r < MAX_PROJ_DECLINE)
        for yr in SCENARIO_YEARS:
            dt = yr - 2024
            val = sp_2024 * ((1 + rate) ** dt)
            if use_floor:
                val = max(val, floor_val)
            corr[yr] = round(val)

    # Interpolated 2019–2022: recompute from 2018→2023 linear (keep interpolated logic)
    if sp_2018 is not None and trend["sp_2023"] is not None:
        sp_2023 = trend["sp_2023"]
        for yr in INTERPOLATED_YEARS:
            frac = (yr - 2018) / (2023 - 2018)
            corr[yr] = round(sp_2018 + frac * (sp_2023 - sp_2018))
    elif sp_2018 is not None:
        for yr in INTERPOLATED_YEARS:
            corr[yr] = sp_2018  # flat if no 2023

    # Backcast: 2000–2017 anchored from 2018, reversed rate
    if sp_2018 is not None:
        back_rate = -rate  # reverse: if growing forward, growing backward = declining back
        # Use a gentler approach: just hold flat for backcast (low-conf anyway)
        # Actually: roll backward using the same rate in reverse
        for yr in BACKCAST_YEARS:
            dt = 2018 - yr
            val = sp_2018 * ((1 + rate) ** (-dt))  # divide out dt years of growth
            corr[yr] = round(max(val, 1))

    corrected_speakers[iso] = corr

# ── Step 4: Re-classify vitality ──────────────────────────────────────────────
print("Step 4 — re-classifying vitality…")

def classify_vitality(iso, year, speakers, context_rate, original_risk):
    """First-match vitality level based on context_rate and speakers."""
    if speakers is None:
        return "unknown", "unknown", "no speaker data"

    n = speakers
    r = context_rate  # may be None

    # lost
    if original_risk == "lost" or (n is not None and n <= EXTINCT_MAX):
        return "lost", "gone", f"{n} speakers ≤ {EXTINCT_MAX} threshold"

    # critical
    if n < CRITICAL_SIZE or (r is not None and r <= STEEP_DECLINE):
        reason = f"{n} speakers < {CRITICAL_SIZE}" if n < CRITICAL_SIZE else f"{r*100:.1f}%/yr ≤ {STEEP_DECLINE*100:.0f}%"
        return "critical", "serious", reason

    # at_risk
    if r is not None and r <= DECLINE:
        return "at_risk", "serious", f"{r*100:.2f}%/yr ≤ {DECLINE*100:.0f}%/yr sustained"

    # vulnerable
    if r is not None and r <= MILD_DECLINE:
        return "vulnerable", "watch", f"{r*100:.2f}%/yr (mild decline)"

    # stable
    if r is None or abs(r) < FLAT_BAND:
        if n >= SMALL_SIZE:
            return "stable", "healthy", f"flat trend, {n} speakers"
        else:
            return "vulnerable", "watch", f"flat trend but only {n} speakers"

    # recovering or alive (r >= GROWTH or above mild_decline with large pop)
    if r is not None and r >= GROWTH:
        historically_small = (n < 100_000)
        if historically_small:
            return "recovering", "healthy", f"{r*100:.2f}%/yr growth, {n} speakers"
        else:
            return "alive", "healthy", f"{r*100:.2f}%/yr growth, large population"

    # Between MILD_DECLINE and GROWTH (and n >= SMALL_SIZE)
    if n >= SMALL_SIZE:
        return "stable", "healthy", f"{r*100:.2f}%/yr near-flat, {n} speakers"

    return "vulnerable", "watch", f"{r*100:.2f}%/yr, only {n} speakers"


def compute_context_rate(iso, year, corrected_speakers, lang_trend):
    """
    Annualized rate over up to CONTEXT_WINDOW years ending at `year`,
    using corrected speaker series (observed values kept for obs years).
    """
    trend = lang_trend[iso]
    # Build a unified series combining observed anchors and corrected values
    points = {}

    # Observed anchors override everything
    if trend["sp_2018"] is not None:
        points[2018] = trend["sp_2018"]
    if trend["sp_2023"] is not None:
        points[2023] = trend["sp_2023"]
    if trend["sp_2024"] is not None:
        points[2024] = trend["sp_2024"]

    # Fill in corrected for non-observed years
    corr = corrected_speakers.get(iso, {})
    for yr, sp in corr.items():
        if yr not in points:
            points[yr] = sp

    # Find the earliest year we can use as the start of the context window
    start_yr = year - CONTEXT_WINDOW
    # Clamp to what we have
    available = sorted(y for y in points if y <= year and points[y] > 0)
    if len(available) < 2:
        return None

    # Find the oldest point in the window (or further back if window is short)
    window_start_candidates = [y for y in available if y >= start_yr]
    if window_start_candidates:
        start_point = window_start_candidates[0]
    else:
        start_point = available[0]

    end_point = year
    if end_point not in points or points[end_point] <= 0:
        # use most recent available before year
        candidates = [y for y in available if y <= year]
        if not candidates:
            return None
        end_point = candidates[-1]

    if start_point == end_point:
        return None

    sp_start = points.get(start_point)
    sp_end   = points.get(end_point)
    if not sp_start or not sp_end or sp_start <= 0:
        return None

    return annualized_rate(sp_start, sp_end, end_point - start_point)


# ── Build all augmented records ───────────────────────────────────────────────
print("Building augmented records…")

# We'll accumulate changes for CSVs
corrections   = []   # projection changes
reclassified  = []   # vitality changes

# Build the new augmented data: for each year, rebuild the languages list
augmented = {}   # year -> list of records

for yr in ALL_YEARS:
    augmented[yr] = []

for iso in sorted(all_iso):
    trend = lang_trend.get(iso, {})
    corr  = corrected_speakers.get(iso, {})
    obs_rate = trend.get("observed_rate")
    proj_rate_val = projected_rate(obs_rate)

    for yr in ALL_YEARS:
        if iso not in year_data[yr]:
            continue
        orig = year_data[yr][iso]
        rec  = dict(orig)   # shallow copy — we'll augment

        st = rec.get("series_type", "unknown")
        original_speakers = rec.get("speakers")
        is_observed = (st == "observed")

        # ── Projection correction ──────────────────────────────────────────
        if not is_observed and iso in corr and yr in corr[iso if False else yr.__class__]:
            pass  # placeholder — handled below

        new_speakers = original_speakers  # default: unchanged

        if not is_observed and yr in corr:
            new_speakers_raw = corr[yr]
            # Only update if original had a valid speaker count (don't fill nulls)
            if original_speakers is not None and original_speakers > 0:
                new_speakers = new_speakers_raw
                # Determine correction reason
                if abs(proj_rate_val) < FLAT_BAND:
                    reason = f"observed rate ≈ 0 (flat projection); was {obs_rate*100:.2f}%/yr" if obs_rate else "no observed rate; projected flat"
                else:
                    reason = f"observed rate {obs_rate*100:.2f}%/yr → clamped to {proj_rate_val*100:.2f}%/yr"
                rec["speakers_raw"] = original_speakers
                rec["speakers"] = new_speakers
                rec["correction_reason"] = reason

                # Track for corrections.csv (only scenario years, 2050 entry)
                if yr == 2050 and st == "scenario":
                    sp_2024 = trend.get("sp_2024")
                    corrections.append({
                        "iso_code": iso,
                        "name": orig.get("name"),
                        "sp_2024": sp_2024,
                        "old_sp_2050": original_speakers,
                        "new_sp_2050": new_speakers,
                        "observed_rate": f"{obs_rate*100:.3f}%" if obs_rate is not None else "N/A",
                        "projected_rate": f"{proj_rate_val*100:.3f}%",
                        "correction_reason": reason,
                    })

        # ── Vitality reclassification ──────────────────────────────────────
        context_rate = compute_context_rate(iso, yr, corrected_speakers, lang_trend)
        sp_for_class = new_speakers

        old_risk         = orig.get("risk", "unknown")
        old_vitality     = orig.get("vitality_group", "unknown")
        old_vitality_level = orig.get("risk", "unknown")

        new_level, new_group, new_reason = classify_vitality(
            iso, yr, sp_for_class, context_rate, old_risk
        )

        # Build reason string
        if context_rate is not None:
            ctx_str = f"{context_rate*100:.2f}%/yr context({CONTEXT_WINDOW}yr)"
        else:
            ctx_str = "no context trend"
        full_reason = f"{ctx_str}, {sp_for_class} speakers → {new_level}"

        rec["risk_original"]    = old_risk
        rec["risk"]             = new_level
        rec["vitality_group"]   = new_group
        rec["vitality_reason"]  = full_reason
        rec["trend_confidence"] = trend.get("trend_confidence", "low")
        rec["context_rate"]     = round(context_rate, 6) if context_rate is not None else None

        # Track reclassifications at 2024 (the key observed year)
        if yr == 2024 and new_group != old_vitality:
            reclassified.append({
                "iso_code": iso,
                "name": orig.get("name"),
                "year": yr,
                "old_vitality_group": old_vitality,
                "new_vitality_group": new_group,
                "old_risk": old_risk,
                "new_risk": new_level,
                "context_rate": f"{context_rate*100:.2f}%" if context_rate else "N/A",
                "speakers": sp_for_class,
                "reason": full_reason,
            })

        augmented[yr].append(rec)

# ── Step 5a: Write _v2.json files ─────────────────────────────────────────────
print("Step 5 — writing v2 files…")

for yr in ALL_YEARS:
    meta = year_meta[yr]
    out = dict(meta)
    out["language_count"] = len(augmented[yr])
    out["languages"] = augmented[yr]
    out_path = os.path.join(YEAR_DIR, f"{yr}_v2.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=4)

print(f"  Wrote {len(ALL_YEARS)} v2 files")

# ── Step 5b: Distribution report ──────────────────────────────────────────────
print("\n── Vitality Group Distribution ──────────────────────────────────────────")

def group_dist(yr, use_augmented=False):
    if use_augmented:
        recs = augmented[yr]
    else:
        recs = list(year_data[yr].values())
    dist = defaultdict(int)
    for rec in recs:
        dist[rec.get("vitality_group", "unknown")] += 1
    return dict(dist)

groups = ["healthy", "watch", "serious", "gone", "unknown"]
print(f"\n{'Group':<12} {'2024 (old)':>12} {'2024 (new)':>12} {'2050 (old)':>12} {'2050 (new)':>12}")
print("-" * 64)
old_2024 = group_dist(2024, use_augmented=False)
new_2024 = group_dist(2024, use_augmented=True)
old_2050 = group_dist(2050, use_augmented=False)
new_2050 = group_dist(2050, use_augmented=True)
for g in groups:
    print(f"{g:<12} {old_2024.get(g,0):>12} {new_2024.get(g,0):>12} {old_2050.get(g,0):>12} {new_2050.get(g,0):>12}")

# ── Step 5c: 7-level distribution ─────────────────────────────────────────────
print(f"\n── 7-Level Vitality at 2024 ─────────────────────────────────────────────")
level_dist = defaultdict(int)
for rec in augmented[2024]:
    level_dist[rec.get("risk", "unknown")] += 1
for level in ["alive", "recovering", "stable", "vulnerable", "at_risk", "critical", "lost", "unknown"]:
    print(f"  {level:<12} {level_dist.get(level,0)}")

print(f"\n── 7-Level Vitality at 2050 ─────────────────────────────────────────────")
level_dist_2050 = defaultdict(int)
for rec in augmented[2050]:
    level_dist_2050[rec.get("risk", "unknown")] += 1
for level in ["alive", "recovering", "stable", "vulnerable", "at_risk", "critical", "lost", "unknown"]:
    print(f"  {level:<12} {level_dist_2050.get(level,0)}")

# ── Step 5d: corrections.csv ──────────────────────────────────────────────────
corr_path = os.path.join(DATA_DIR, "corrections.csv")
if corrections:
    with open(corr_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=corrections[0].keys())
        w.writeheader()
        w.writerows(corrections)
    print(f"\nWrote corrections.csv ({len(corrections)} rows)")
else:
    print("\nNo projection corrections recorded.")

# ── Step 5e: reclassified.csv ─────────────────────────────────────────────────
recl_path = os.path.join(DATA_DIR, "reclassified.csv")
if reclassified:
    with open(recl_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=reclassified[0].keys())
        w.writeheader()
        w.writerows(reclassified)
    print(f"Wrote reclassified.csv ({len(reclassified)} rows)")
else:
    print("No vitality reclassifications at 2024.")

# ── Step 5f: low-confidence count ─────────────────────────────────────────────
low_conf_total = sum(
    1 for v in lang_trend.values() if v["trend_confidence"] == "low"
)
print(f"\ntend_confidence=low: {low_conf_total} / {len(lang_trend)} languages ({100*low_conf_total/len(lang_trend):.1f}%)")
print("\nDone.")
