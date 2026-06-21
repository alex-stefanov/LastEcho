# LastEcho — ML / data-science pipeline

This folder holds the offline data-science pipeline that produces LastEcho's per-language,
per-year endangerment forecasts. The web app does **not** call these at runtime — it reads the
pre-computed JSON snapshots in `client/src/data/timeline_by_year/`. These scripts are how those
snapshots (and the ranked `languages.json`) are generated and regenerated.

## What the model does

Two supervised **scikit-learn** models, trained on real year-over-year change:

- a **regressor** → predicts next year's speaker count (on a `log1p` scale), and
- a **classifier** → predicts next year's endangerment group.

Running them one year at a time (recursive rollout) gives each language a forecast trajectory.
The "future chance of extinction" shown in the app is read off how steeply that trajectory falls.

## Data sources

| Source | Role |
|--------|------|
| **ELCat** (Catalogue of Endangered Languages), snapshots `elcat_sql_2018`, `elcat_cldf_2023`, `elcat_cldf_2024` | Training data — the multi-year snapshots that let the model learn *change* |
| **Glottolog + Glottolog AES** | Language family / ISO / coordinates + a consistent endangerment level |
| **Wikidata** (live SPARQL) | Independent, current speaker counts for validation/enrichment |

ELCat CLDF data: https://github.com/cldf-datasets/elcat · Glottolog AES: https://glottolog.org/parameters/aes

## Scripts

| Script | What it does |
|--------|--------------|
| `enhance_data.py` | Loads the ELCat snapshots into the `language_core_year` table, derives `risk_detail_group` / `data_gap_type`, builds the one-row-per-ISO view and a 2018→2024 change summary, and (optionally) pulls live speaker counts from **Wikidata** as external rows. |
| `train_model.py` | Builds 2018→2023 and 2023→2024 training **pairs**, runs a leak-free **GroupKFold (5-fold, grouped by ISO code)** sanity check against a persistence baseline (MAE for speakers, macro-F1 for risk), then fits the regressor + classifier on all pairs and saves `lastecho_model.joblib`. |
| `predict_future.py` | Loads the saved model and rolls every language forward from 2024, one year at a time, writing per-year predictions (`speakers_predicted`, `risk_predicted`, plus a flat-persistence comparison column). |
| `build_timeline.py` | Fills one continuous yearly series per language (2000–2050) tagged by trust: `observed` (real snapshots), `interpolated`, `backcast`, `scenario` (forward projection), `benchmark`. Missing-speaker languages stay `unknown` — never invented into a number. |

## How validation works (so it's honest)

`train_model.py` reports model error **against a "no-change" persistence baseline** every run, using
**grouped** cross-validation so the same language never appears in both train and test. A `log1p` MAE
of ~0.10 corresponds to roughly ±10% on the speaker count. We also trialled a **Prophet** time-series
fit as a cross-check; the shipped forecasts come from the scikit-learn models here.

## Notes / not committed

- `lastecho_common.py` (shared helpers: `FEATURE_COLS`, `make_regressor()`, `make_classifier()`,
  `load_core_year()`, `build_pairs()`) and `scenario_project.py` are required by these scripts but
  are **not** included here — add them before running.
- The trained artifact `lastecho_model.joblib` and the source MySQL database are regenerated from the
  scripts + the public datasets above; they are not version-controlled.
- The scripts take DB credentials as CLI args — **do not commit real passwords.**

## Forecasts are projections, not certainty

The future years are an "if current trends hold" projection validated against held-out data and live
Wikidata figures — not a guaranteed prediction. The further out, the wider the real uncertainty.
