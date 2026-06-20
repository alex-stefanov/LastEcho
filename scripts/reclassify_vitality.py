import json
import os
from collections import defaultdict

DATA_DIR = os.path.join("client", "src", "data", "timeline_by_year")

# --- Thresholds ---
EXTINCT_MAX   = 10
CRITICAL_SIZE = 50
SMALL_SIZE    = 1000
HEALTHY_SIZE  = 1000
STEEP_DECLINE = -0.10
DECLINE       = -0.03
MILD_DECLINE  = -0.01
GROWTH        = 0.01

YEARS = list(range(2000, 2051))


def load_year(year):
    path = os.path.join(DATA_DIR, f"{year}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def compute_rate(series):
    """series: sorted list of (year, speakers). Returns (rate, confidence, y1, y2, s1, s2)."""
    usable = [(y, s) for y, s in series if s and s > 0]
    if len(usable) < 2:
        return None, "low", None, None, None, None
    (y1, s1), (y2, s2) = usable[-2], usable[-1]
    if y2 == y1:
        return None, "low", y1, y2, s1, s2
    rate = (s2 / s1) ** (1 / (y2 - y1)) - 1
    return rate, "high", y1, y2, s1, s2


def assign_vitality(rate, confidence, latest_speakers, original_risk):
    if latest_speakers is None:
        return "unknown", "unknown", "no speaker data"

    s = latest_speakers

    if s <= EXTINCT_MAX or original_risk == "lost":
        return "lost", "gone", f"{s} speakers → effectively lost"

    if s < CRITICAL_SIZE or (rate is not None and rate <= STEEP_DECLINE):
        pct = f"{rate*100:+.1f}%/yr" if rate is not None else "no trend"
        return "critical", "serious", f"{pct}, {s} speakers → critical"

    if rate is not None and rate <= DECLINE:
        return "at_risk", "serious", f"{rate*100:+.1f}%/yr, {s} speakers → at risk"

    if (rate is not None and rate <= MILD_DECLINE) or (s < SMALL_SIZE and rate is None):
        pct = f"{rate*100:+.1f}%/yr" if rate is not None else "no trend"
        return "vulnerable", "watch", f"{pct}, {s} speakers → vulnerable"

    if rate is not None and rate >= GROWTH and s >= 100_000:
        return "alive", "healthy", f"{rate*100:+.1f}%/yr, {s} speakers → alive"

    if rate is not None and rate >= GROWTH:
        return "recovering", "healthy", f"{rate*100:+.1f}%/yr, {s} speakers → recovering"

    # flat or no trend
    if s >= HEALTHY_SIZE:
        pct = f"{rate*100:+.1f}%/yr" if rate is not None else "no trend"
        return "stable", "healthy", f"{pct}, {s} speakers → stable"

    pct = f"{rate*100:+.1f}%/yr" if rate is not None else "no trend"
    return "vulnerable", "watch", f"{pct}, {s} speakers → vulnerable"


# --- Load all years into memory ---
print("Loading all year files...")
all_data = {}
for year in YEARS:
    all_data[year] = load_year(year)
    print(f"  Loaded {year}.json ({all_data[year]['language_count']} languages)")

# Build cumulative speaker history per iso_code up through each year
# history[iso_code] = sorted list of (year, speakers)
history = defaultdict(list)

# Track old risk distribution
old_risk_counts = defaultdict(int)
new_vitality_counts = defaultdict(int)
low_confidence_count = 0
reclassified = []  # (name, iso, series_str, rate, reason)

print("\nReclassifying and writing files...")
for year in YEARS:
    data = all_data[year]
    modified = False

    for rec in data["languages"]:
        iso = rec["iso_code"]
        spk = rec.get("speakers")
        orig_risk = rec.get("risk", "at_risk")

        # Add this year's data point to history before computing (know up-to this year)
        if spk is not None and spk > 0:
            # Avoid duplicates
            existing_years = {y for y, _ in history[iso]}
            if year not in existing_years:
                history[iso].append((year, spk))
                history[iso].sort()

        # Compute trend from everything up to and including this year
        series = history[iso]
        rate, confidence, y1, y2, s1, s2 = compute_rate(series)

        # Latest known speaker count
        usable = [(y, s) for y, s in series if s and s > 0]
        latest_speakers = usable[-1][1] if usable else None

        vitality, vitality_group, reason = assign_vitality(rate, confidence, latest_speakers, orig_risk)

        if rate is not None and y1 and y2:
            reason = f"{rate*100:+.1f}%/yr {y1}→{y2}, {latest_speakers} speakers → {vitality}"

        # Track stats (only for years we consider "real" data, i.e. ≤ 2026)
        if year <= 2026:
            old_risk_counts[orig_risk] += 1
            new_vitality_counts[vitality] += 1
            if confidence == "low":
                low_confidence_count += 1
            if orig_risk == "at_risk" and vitality_group == "healthy":
                series_str = ", ".join(f"{y}:{s}" for y, s in series[-4:])
                reclassified.append((rec["name"], iso, series_str, rate, reason))

        # Update record
        rec["risk"] = vitality
        rec["vitality_group"] = vitality_group
        rec["vitality_reason"] = reason
        rec["trend_confidence"] = confidence
        modified = True

    if modified:
        path = os.path.join(DATA_DIR, f"{year}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        print(f"  Written {year}.json")

# --- Summary ---
print("\n=== OLD risk distribution (2000-2026 records) ===")
for k, v in sorted(old_risk_counts.items(), key=lambda x: -x[1]):
    print(f"  {k:20s} {v:7,}")

print("\n=== NEW vitality distribution (2000-2026 records) ===")
order = ["alive", "stable", "recovering", "vulnerable", "at_risk", "critical", "lost", "unknown"]
for k in order:
    print(f"  {k:20s} {new_vitality_counts.get(k, 0):7,}")

print(f"\n  trend_confidence=low : {low_confidence_count:,} records")

print(f"\n=== Sample reclassified (at_risk → healthy) — first 10 ===")
seen = set()
count = 0
for name, iso, series_str, rate, reason in reclassified:
    if iso in seen:
        continue
    seen.add(iso)
    pct = f"{rate*100:+.2f}%/yr" if rate is not None else "no trend"
    print(f"  {name} ({iso}): {series_str} | {pct} | {reason}")
    count += 1
    if count >= 10:
        break

print("\nDone.")
