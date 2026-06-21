"""
LastEcho — train_model.py
Trains the forecasting models on all available snapshot pairs and saves them.

Usage:
    python train_model.py --mysql --host localhost --user root \
        --password PW --database languages_production
    python train_model.py --csv language_core_year.csv

Output: lastecho_model.joblib   (load this in predict_future.py)
"""

import argparse
import numpy as np
import joblib

from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error, f1_score

import lastecho_common as L


def quick_honesty_check(pairs):
    """One grouped-CV pass so you know whether the model beats 'no change'.
    Grouped by iso_code => a language never sits in both train and test."""
    X = pairs[L.FEATURE_COLS]
    y_reg = pairs["y_log_speakers"].values
    y_clf = pairs["y_risk_group"].values
    groups = pairs["iso_code"].values
    gkf = GroupKFold(n_splits=5)

    m_mae, p_mae, m_f1, p_f1 = [], [], [], []
    for tr, te in gkf.split(X, y_reg, groups):
        reg = L.make_regressor().fit(X.iloc[tr], y_reg[tr])
        m_mae.append(mean_absolute_error(y_reg[te], reg.predict(X.iloc[te])))
        p_mae.append(mean_absolute_error(y_reg[te], pairs["persist_log_speakers"].values[te]))
        clf = L.make_classifier().fit(X.iloc[tr], y_clf[tr])
        m_f1.append(f1_score(y_clf[te], clf.predict(X.iloc[te]), average="macro", zero_division=0))
        p_f1.append(f1_score(y_clf[te], pairs["persist_risk_group"].values[te],
                             average="macro", zero_division=0))

    print("\n--- sanity check (grouped 5-fold CV) ---")
    print(f"speakers  MAE  model {np.mean(m_mae):.3f}  vs  persistence {np.mean(p_mae):.3f}"
          f"   ({'beats baseline' if np.mean(m_mae) < np.mean(p_mae) else 'no gain over baseline'})")
    print(f"risk      F1   model {np.mean(m_f1):.3f}  vs  persistence {np.mean(p_f1):.3f}")
    print("(log1p MAE ~0.10 corresponds to roughly +/-10% on the speaker count)\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--mysql", action="store_true")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--user", default="root")
    ap.add_argument("--password", default="")
    ap.add_argument("--database", default="languages_production")
    ap.add_argument("--out", default="lastecho_model.joblib")
    args = ap.parse_args()

    core = L.one_per_iso_year(L.load_core_year(args))
    pairs = L.build_pairs(core)
    print(f"built {len(pairs)} training pairs from {pairs['iso_code'].nunique()} languages")
    print(pairs["pair"].value_counts().to_string())

    quick_honesty_check(pairs)

    # final fit on ALL pairs (both 2018->2023 and 2023->2024)
    X = pairs[L.FEATURE_COLS]
    reg = L.make_regressor().fit(X, pairs["y_log_speakers"].values)
    clf = L.make_classifier().fit(X, pairs["y_risk_group"].values)

    joblib.dump(
        {"regressor": reg, "classifier": clf,
         "feature_cols": L.FEATURE_COLS,
         "trained_on": list(pairs["pair"].unique())},
        args.out)
    print(f"saved model -> {args.out}")


if __name__ == "__main__":
    main()
