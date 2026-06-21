"""
LastEcho — build_timeline.py
Fills one continuous yearly series per language, tagged by how trustworthy each
year is, so the dashboard can render trust visually.

series_type, weakest to strongest:
    backcast      2000-2017  extrapolated backward from 2018 (NOT history)
    interpolated  2019-2022  geometric fill between the real 2018 and 2023 points
    observed      2018/2023/2024  real ELCat snapshot values
    scenario      2025-2050  forward projection from 2024 (chosen assumptions)
    benchmark     real census/survey points from benchmarks.csv (ground truth)

Rates reuse the scenario logic. Missing-speaker languages stay 'unknown' and are
never invented into a number.

Usage:
    python build_timeline.py --mysql --host localhost --user root \
        --password PW --database languages_production --mysql-out
    python build_timeline.py --csv language_core_year.csv
"""

import argparse
import numpy as np
import pandas as pd

import lastecho_common as L
from scenario_project import active_rate   # same rate logic as the scenario

BACK_START = 2000
SCEN_END = 2050
SNAPS = [2018, 2023, 2024]


def geom_interp(s0, y0, s1, y1, y):
    """Geometric value at year y between (y0,s0) and (y1,s1)."""
    frac = (y - y0) / (y1 - y0)
    return s0 * (s1 / s0) ** frac


def build(core, p):
    by_iso = {}
    for r in core.itertuples(index=False):
        by_iso.setdefault(r.iso_code, {})[r.snapshot_year] = r

    rows = []
    for iso, yrs in by_iso.items():
        latest = yrs.get(2024) or yrs.get(2023) or yrs.get(2018)
        name, fam = latest.name, latest.family_root
        lat, lon = latest.latitude_map, latest.longitude_map

        def val(y):
            r = yrs.get(y)
            if r is None or pd.isna(r.speakers_estimate) or float(r.speakers_estimate) <= 0:
                return None
            return float(r.speakers_estimate)

        s2018, s2023, s2024 = val(2018), val(2023), val(2024)

        # status + rate from the latest observed state (same rules as scenario)
        if latest.risk_group == "lost":
            status, rate = "lost", None
        elif s2024 is None and s2023 is None and s2018 is None:
            status, rate = "unknown", None
        else:
            status = "active"
            anchor_val = s2024 or s2023 or s2018
            rate = active_rate(latest.risk_group, latest.risk_detail_group, anchor_val, p)

        def emit(year, speakers, risk, stype):
            rows.append({"iso_code": iso, "name": name, "year": year,
                         "speakers": None if speakers is None else int(round(speakers)),
                         "risk": risk, "series_type": stype,
                         "family_root": fam, "latitude_map": lat, "longitude_map": lon})

        # ---- backcast 2000-2017 (anchor on 2018 if we have it) ----
        if status == "active" and s2018 is not None:
            for y in range(BACK_START, 2018):
                s = s2018 * (1 + rate) ** (y - 2018)
                if s <= p.extinct_threshold:
                    emit(y, None, "lost", "backcast")
                else:
                    emit(y, s, "alive" if rate > 0 else "at_risk", "backcast")
        elif status == "lost":
            for y in range(BACK_START, 2018):
                emit(y, None, "lost", "backcast")

        # ---- observed + interpolated 2018-2024 ----
        for y in range(2018, 2025):
            if y in SNAPS and yrs.get(y) is not None:
                r = yrs[y]
                sv = val(y)
                emit(y, sv, r.risk_group if sv is not None else "unknown", "observed")
            elif 2019 <= y <= 2022 and s2018 is not None and s2023 is not None:
                emit(y, geom_interp(s2018, 2018, s2023, 2023, y), latest.risk_group, "interpolated")
            else:
                emit(y, None, "unknown", "interpolated")

        # ---- scenario 2025-2050 (forward from 2024 value) ----
        anchor_fwd = s2024 or s2023 or s2018
        if status == "active" and anchor_fwd is not None:
            s = anchor_fwd
            for y in range(2025, SCEN_END + 1):
                s = s * (1 + rate)
                if s <= p.extinct_threshold:
                    emit(y, None, "lost", "scenario")
                else:
                    emit(y, s, "alive" if rate > 0 else "at_risk", "scenario")
        else:
            for y in range(2025, SCEN_END + 1):
                emit(y, None, "lost" if status == "lost" else "unknown", "scenario")

    df = pd.DataFrame(rows)

    # ---- benchmark overlay (real ground truth) ----
    try:
        bm = pd.read_csv(p.benchmarks)
        bmrows = [{"iso_code": b.iso_code, "name": b.name, "year": int(b.year),
                   "speakers": int(b.real_speakers), "risk": "benchmark",
                   "series_type": "benchmark", "family_root": None,
                   "latitude_map": None, "longitude_map": None}
                  for b in bm.itertuples(index=False)]
        df = pd.concat([df, pd.DataFrame(bmrows)], ignore_index=True)
    except FileNotFoundError:
        print(f"(no {p.benchmarks} found, skipping benchmark overlay)")

    return df.sort_values(["iso_code", "year", "series_type"]).reset_index(drop=True)


DB_COLS = ["iso_code", "name", "year", "speakers", "risk", "series_type",
           "family_root", "latitude_map", "longitude_map"]


def write_to_mysql(df, args, table="language_timeline"):
    import mysql.connector
    conn = mysql.connector.connect(host=args.host, user=args.user,
                                   password=args.password, database=args.database)
    cur = conn.cursor()
    cur.execute(f"DROP TABLE IF EXISTS {table}")
    cur.execute(f"""
        CREATE TABLE {table} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            iso_code VARCHAR(255), name VARCHAR(255), year INT,
            speakers BIGINT NULL, risk VARCHAR(48), series_type VARCHAR(24),
            family_root VARCHAR(255), latitude_map DOUBLE NULL, longitude_map DOUBLE NULL,
            INDEX idx_iso (iso_code), INDEX idx_year (year), INDEX idx_type (series_type)
        )
    """)
    ph = ",".join(["%s"] * len(DB_COLS))
    sql = f"INSERT INTO {table} ({','.join(DB_COLS)}) VALUES ({ph})"

    # safety net: cap any malformed over-long iso_code so the insert can't fail.
    # Real ISO 639-3 codes are <=3 chars; anything long is a data-quality issue
    # at the source worth cleaning later (see the diagnostic query in chat).
    iso_len = df["iso_code"].astype(str).str.len()
    over = int((iso_len > 255).sum())
    if over:
        bad = df.loc[iso_len > 12, "iso_code"].astype(str).str.slice(0, 40).unique()[:5]
        print(f"WARNING: {over} rows have iso_code longer than 255 chars; capping for storage.")
        print(f"         sample odd iso_code values: {list(bad)}")
        df = df.copy()
        df["iso_code"] = df["iso_code"].astype(str).str.slice(0, 255)

    def clean(v):
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        if isinstance(v, np.integer):
            return int(v)
        if isinstance(v, np.floating):
            return float(v)
        return v

    data = [tuple(clean(v) for v in rec) for rec in df[DB_COLS].itertuples(index=False, name=None)]
    cur.executemany(sql, data)
    conn.commit()
    cur.close()
    conn.close()
    print(f"wrote {len(data)} rows -> MySQL table `{table}`")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--mysql", action="store_true")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--user", default="root")
    ap.add_argument("--password", default="")
    ap.add_argument("--database", default="languages_production")
    ap.add_argument("--out", default="lastecho_timeline.csv")
    ap.add_argument("--mysql-out", action="store_true")
    ap.add_argument("--table", default="language_timeline")
    ap.add_argument("--benchmarks", default="benchmarks.csv")
    ap.add_argument("--decline-critical", type=float, default=0.06)
    ap.add_argument("--decline-endangered", type=float, default=0.03)
    ap.add_argument("--decline-vulnerable", type=float, default=0.015)
    ap.add_argument("--growth-base", type=float, default=0.008)
    ap.add_argument("--growth-size-coef", type=float, default=0.006)
    ap.add_argument("--large-threshold", type=float, default=1_000_000)
    ap.add_argument("--extinct-threshold", type=float, default=10)
    args = ap.parse_args()

    core = L.one_per_iso_year(L.load_core_year(args))
    df = build(core, args)
    df.to_csv(args.out, index=False)
    print(f"timeline: {len(df)} rows, years {df['year'].min()}-{df['year'].max()}, "
          f"{df['iso_code'].nunique()} languages")
    print(df["series_type"].value_counts().to_string())
    if args.mysql_out:
        write_to_mysql(df, args, table=args.table)


if __name__ == "__main__":
    main()
