"""
LastEcho — predict_future.py
Loads the trained model and projects every language forward from 2024, one year
at a time (recursive rollout at gap = 1 year, the horizon the model actually saw).

Each step: predict next-year speakers (regressor) and next-year risk group
(classifier), then feed those predictions back in as the new "current" state.

Output columns per language per future year:
    iso_code, name, year, speakers_predicted, risk_predicted,
    speakers_persistence (2024 value held flat, for comparison),
    family_root, latitude_map, longitude_map

These are model projections, not measured values. The persistence column is
included so a chart can show the model's trajectory against a flat "no change"
line.

Usage:
    python predict_future.py --mysql --host localhost --user root \
        --password PW --database languages_production --years 10
    python predict_future.py --csv language_core_year.csv --years 10
"""

import argparse
import numpy as np
import pandas as pd
import joblib

import lastecho_common as L

BASE_YEAR = 2024
ASSUMED_SOURCE = "elcat_cldf_2024"   # methodology we assume continues forward

DB_COLS = ["iso_code", "name", "year", "speakers_predicted", "risk_predicted",
           "speakers_persistence", "family_root", "latitude_map", "longitude_map"]


def write_to_mysql(preds, args, table="language_predictions"):
    """Drop + recreate `table` and load all predictions into it.
    Recreating each run keeps it idempotent for a prototype."""
    import mysql.connector
    conn = mysql.connector.connect(host=args.host, user=args.user,
                                   password=args.password, database=args.database)
    cur = conn.cursor()
    cur.execute(f"DROP TABLE IF EXISTS {table}")
    cur.execute(f"""
        CREATE TABLE {table} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            iso_code VARCHAR(16),
            name VARCHAR(255),
            year INT,
            speakers_predicted BIGINT NULL,
            risk_predicted VARCHAR(48),
            speakers_persistence BIGINT NULL,
            family_root VARCHAR(255),
            latitude_map DOUBLE NULL,
            longitude_map DOUBLE NULL,
            INDEX idx_iso (iso_code),
            INDEX idx_year (year)
        )
    """)
    placeholders = ",".join(["%s"] * len(DB_COLS))
    sql = f"INSERT INTO {table} ({','.join(DB_COLS)}) VALUES ({placeholders})"

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

    rows = [tuple(clean(v) for v in rec)
            for rec in preds[DB_COLS].itertuples(index=False, name=None)]
    cur.executemany(sql, rows)
    conn.commit()
    cur.close()
    conn.close()
    print(f"wrote {len(rows)} rows -> MySQL table `{table}`")


def build_start_state(core: pd.DataFrame) -> pd.DataFrame:
    """The 2024 snapshot, one row per language, with feature columns ready."""
    cur = core[core["snapshot_year"] == BASE_YEAR].copy()
    cur = cur.dropna(subset=["iso_code"]).drop_duplicates("iso_code")
    cur["log_speakers_t"] = np.log1p(cur["speakers_estimate"].clip(lower=0))
    cur["gap_years"] = 1
    cur["source_dataset"] = ASSUMED_SOURCE
    # speakers held flat from 2024, for the comparison column
    cur["speakers_2024"] = cur["speakers_estimate"]
    return cur


def roll_forward(cur: pd.DataFrame, reg, clf, n_years: int) -> pd.DataFrame:
    records = []
    state = cur.copy()
    for step in range(1, n_years + 1):
        year = BASE_YEAR + step
        X = state[L.FEATURE_COLS]

        log_next = reg.predict(X)
        speakers_next = pd.Series(np.expm1(log_next)).clip(lower=0).round().astype("Int64")
        risk_next = clf.predict(X)

        records.append(pd.DataFrame({
            "iso_code": state["iso_code"].values,
            "name": state["name"].values,
            "year": year,
            "speakers_predicted": speakers_next.values,
            "risk_predicted": risk_next,
            "speakers_persistence": pd.Series(state["speakers_2024"].values).round().astype("Int64"),
            "family_root": state["family_root"].values,
            "latitude_map": state["latitude_map"].values,
            "longitude_map": state["longitude_map"].values,
        }))

        # feed predictions back in as next "current" state
        state = state.copy()
        state["log_speakers_t"] = log_next
        state["risk_group"] = risk_next
        # static features (family, coords, gaps) stay as-is; gap stays 1
    return pd.concat(records, ignore_index=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--mysql", action="store_true")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--user", default="root")
    ap.add_argument("--password", default="")
    ap.add_argument("--database", default="languages_production")
    ap.add_argument("--model", default="lastecho_model.joblib")
    ap.add_argument("--years", type=int, default=10)
    ap.add_argument("--out", default="lastecho_predictions.csv")
    ap.add_argument("--mysql-out", action="store_true",
                    help="also write predictions into a MySQL table")
    ap.add_argument("--table", default="language_predictions")
    args = ap.parse_args()

    bundle = joblib.load(args.model)
    reg, clf = bundle["regressor"], bundle["classifier"]

    core = L.one_per_iso_year(L.load_core_year(args))
    cur = build_start_state(core)
    print(f"projecting {len(cur)} languages forward {args.years} years from {BASE_YEAR}")

    preds = roll_forward(cur, reg, clf, args.years)
    preds.to_csv(args.out, index=False)
    print(f"wrote {len(preds)} rows -> {args.out}")

    if args.mysql_out:
        write_to_mysql(preds, args, table=args.table)

    # small console preview: predicted global speaker total per year
    summary = preds.groupby("year")["speakers_predicted"].sum()
    print("\npredicted total recorded speakers by year:")
    print(summary.to_string())


if __name__ == "__main__":
    main()
