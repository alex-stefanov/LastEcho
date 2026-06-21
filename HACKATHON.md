# ZaraHack 2026 — Project Submission (HACKATHON.md)

Project: **LastEcho** — a platform for the world's endangered languages. It doesn't just *show* that languages are dying; it **predicts** which ones go next, **ranks** who to save first, and **turns that into a drafted email** to the institution that could actually help.

It has four working surfaces:
1. **3D globe** — every language as a dot, colored by how close it is to extinction, scrubbable across 2000–2050.
2. **Forest / tree view** — a living genealogy where each leaf is a language; leaves blacken and fall as languages die.
3. **Priority (Rescue) queue** — a live, re-weightable ranking of which languages to record first.
4. **Outreach engine** — matches each at-risk language to a real institution and drafts the first email for a human to review and send.

---

## 1. Team

*Who are you, and where does everything live?*
**(helps your score on: Team Work)**

- **Team name:** LastEcho
- **Members (name — what each person did):**
  - **Adelin Chaushev** — frontend lead: the 3D globe, the forest/tree view, the Three.js rendering, and the overall React app.
  - **Samuil Gigov** — backend lead: the FastAPI service, the data pipeline that builds the per-year snapshots, the SQLite outreach store and triage/escalation engine.
  - **Teodora Nedkova** — information gathering and research; frontend fixes and polish across the app.
  - **Alex Stefanov** — **machine learning** and **data science**: trained the prediction model, gathered and prepared the datasets, and owned the data side end-to-end.
- **How did you split the tasks?** Along the seams data science → backend → frontend. Alex gathered the data and trained the prediction model that drives the future-year forecasts; Samuil built the API and the pipeline that turns those predictions into the shipped per-year data and the outreach engine; Adelin built everything the user sees — the globe, the forest, and the queue; Teodora gathered supporting information and hardened the frontend.

> _Teammates: correct your individual lines if needed and add repo/demo links here once they're live._

---

## 2. What Problem Are You Solving?

*What's the problem, and who actually has it?*
**(helps your score on: Idea & Data Integrity)**

A language dies roughly every two weeks, and by 2100 up to half of the world's ~7,000 languages may be gone. The people who feel this are **speaker communities** losing their heritage and the **linguists, universities, and cultural institutions** racing to document languages before the last fluent speakers pass away.

**The hard part isn't knowing that languages die — everyone knows that.** The hard part is knowing *which* ones are most urgent right now, *which way they're heading*, and *who is actually positioned to act* — and then doing something about it before the window closes. Existing references stop at a map or a statistic. LastEcho is built to close that last gap: it **predicts** the trajectory, **prioritizes** the most urgent languages, and **routes** that urgency to a specific institution with a ready-to-send email. It's a platform for *acting* on language loss, not just looking at it.

---

## 3. How Do You Solve It? (in plain language)

*Explain it to a normal person (grandpa style) — no tech words allowed.*
**(helps your score on: Presentation)**

Imagine a spinning globe where every dot is a language, and the color tells you how close it is to disappearing. Slide time forward and you watch the map go quiet, year by year. There's also a giant tree where every leaf is a language — and the leaves go dark and fall as languages die. Behind the scenes, we taught a computer to look at the past and **guess which languages will fade next and how few speakers they'll have left**. From that, the platform builds a to-do list — "save this one first" — figures out which university or cultural group is best placed to help each language, and writes a polite first email for a person to check and send. So instead of a sad chart, you get a plan for who to contact to actually make a difference.

---

## 4. What Technologies Do You Use?

*List the building blocks: languages, frameworks, services, libraries, APIs.*
**(helps your score on: Tech Execution)**

- **Languages:** TypeScript, Python 3.12
- **Frontend:** React 18, Vite, `react-globe.gl`, Three.js (globe + forest/tree rendering)
- **Backend:** FastAPI, Uvicorn, SQLite (no ORM — plain `sqlite3`)
- **Machine learning:** **scikit-learn** — two supervised models trained on year-over-year language snapshots: a **regressor** that predicts next-year speaker count (log-scaled) and a **classifier** that predicts next-year endangerment group. Trained with `train_model.py`, projected forward by `predict_future.py`, persisted with `joblib`. Its per-year predictions are exported and cached as JSON for the app to read.
- **Data tools / libraries:** Python standard library for the offline data build; `reverse_geocoder` (offline lat/lng → country); `httpx` for API lookups
- **APIs / services:** Anthropic Claude (outreach drafting), ROR — Research Organization Registry (institution lookup), SMTP/Postmark (sending)
- **Hosting / deployment:** **Vercel** (static frontend) and **Render** (FastAPI backend, Docker)

---

## 5. How Do You Wire Them Together?

*The architecture — how do the pieces talk to each other?*
**(helps your score on: Tech Execution)**

```
[ELCat 2018/2023/2024 + Glottolog AES + Wikidata]
        -> [ml/enhance_data.py: clean + build year-pairs]
        -> [ml/train_model.py: sklearn regressor (speakers) + classifier (risk)]
        -> [ml/predict_future.py: recursive yearly rollout -> predictions]
        -> [predictions exported per year, cached as JSON]  (input changes ~yearly -> no need to re-run the model)
                 |
                 v
[per-year JSON in client]  -> [3D globe + forest/tree + Rescue (priority) queue]
[api/data/languages.json]  -> [FastAPI in-memory dataset]
                                      |
   [triage sweep: score urgency/population/uniqueness]
        -> [matching.py builds local/continental/global institution ladder
            via reverse-geocoder + ROR API]
        -> [outreach.py drafts email via Claude (or template fallback)]
        -> [SQLite outreach_queue]
        -> [admin reviews/edits/approves]
        -> [SMTP/Postmark send] -> [no reply after N days -> escalate to next tier]
```

Two design choices tie it together. **First:** the model's outputs change at most once a year, so we run the model offline and **cache its predictions as JSON** — the same input never goes through the model twice, which makes the app instant and the results reproducible. **Second:** the globe/queue data and the outreach data come from the *same* build, so what a user sees ranked as most urgent is exactly what the backend drafts an email about. The backend loads its dataset into memory at startup; only the outreach queue and the ROR cache touch the database.

---

## 6. Do You Train an ML Model?

*ML is a bonus, not a must — be honest either way.*
**(helps your score on: AI Fluency)**

**Yes — two of them.** We trained a pair of **scikit-learn** models that, for each language, predict the **next year's speaker count** (a regressor, on log-scaled counts) and the **next year's endangerment group** (a classifier). Running them year by year produces the forecast trajectory; the **future chance of extinction** is read off how steeply that trajectory declines.

- **Training data:** ELCat snapshots for **2018, 2023, and 2024**, enriched with **Glottolog AES** endangerment levels and a **Wikidata** live pull (see §7). The models learn from real **year-pairs** — what a language looked like in 2018 → what it became in 2023, and 2023 → 2024.
- **No-leakage validation:** **grouped 5-fold cross-validation keyed on ISO code**, so the *same language never appears in both train and test*. We benchmark every fold against a **persistence ("no change") baseline** to prove the model actually beats "assume nothing changes" — speaker count by MAE (a log-MAE of ~0.10 ≈ ±10% on the count), risk group by macro-F1.
- **External validation:** beyond the held-out folds, `enhance_data.py` pulls **live current figures from Wikidata** (and we spot-checked against web searches) to sanity-check predictions against independent up-to-date data for this year.
- **Cross-checking:** we also tried a **Prophet** time-series fit as an alternative sanity check on the trajectories; the shipped forecasts come from the scikit-learn models above.
- **Serving:** because a language's inputs change at most once a year, we **run the models offline and ship their per-year predictions as cached JSON** in the client. The app reads those directly instead of re-running the models for identical inputs — faster and deterministic.
- **On top of the models:** a transparent **triage score** ranks languages from the predictions — a weighted blend of extinction urgency (risk scale), speaker population (log-normalized), and linguistic uniqueness (family size) — implemented identically in `client/src/data/triage.ts` and `api/scripts/build_data.py` so frontend and backend always agree.
- We also **use** a pretrained LLM (Anthropic Claude) to draft the outreach emails — we don't train or fine-tune it, and it falls back to a deterministic template when no API key is set.

> ‹FILL IN if you have it: the exact regressor/classifier class from `lastecho_common.py` (e.g. RandomForest / GradientBoosting) and a headline CV number from the `train_model.py` sanity-check printout.›

---

## 7. What Datasets Do You Use, and How?

*Real, public data is the heart of this hackathon — show yours off.*
**(helps your score on: Idea & Data Integrity)**

The model learns from **ELCat in three yearly snapshots (2018 / 2023 / 2024)**, enriched with **Glottolog AES** and a **Wikidata** live pull; **Glottolog** is the language backbone and **ROR** is the runtime institution source.

**Dataset 1 — ELCat (Catalogue of Endangered Languages), three snapshots**
- **Source + link:** https://github.com/cldf-datasets/elcat (CLDF releases — we use `elcat_sql_2018`, `elcat_cldf_2023`, and `elcat_cldf_2024`; e.g. `cldf/languages.csv`, v2023.3 / main)
- **Licence:** ‹VERIFY in the repo's LICENSE — ELCat/CLDF data is typically CC BY 4.0›
- **Why:** the authoritative, scholarly endangerment catalogue (ELP / Catalogue of Endangered Languages), and crucially it exists at **multiple points in time** — which is what lets us learn *change* rather than a single snapshot.
- **What we did:** loaded all three snapshots into one table (`language_core_year`), built **year-pairs** (2018→2023, 2023→2024) as the model's training examples, and derived the speaker-change / risk-change summary that the regressor and classifier learn from.

**Dataset 2 — Glottolog + Glottolog AES (Agglomerated Endangerment Status)**
- **Source + link:** https://glottolog.org and https://glottolog.org/parameters/aes
- **Licence:** CC BY 4.0
- **Why:** the authoritative reference for language families, ISO codes, and a *consistent* per-language endangerment level — a labelled risk signal rather than raw speaker counts alone.
- **What we did:** used Glottolog for family/ISO/coordinates (the map backbone) and AES as an endangerment feature feeding both the model and the triage urgency score. Manual fixes logged in `client/src/data/corrections.csv`; status changes in `reclassified.csv`. Stable IDs derive from ISO codes so a re-run never double-contacts a language.

**Dataset 3 — Wikidata (live, via SPARQL)**
- **Source + link:** https://query.wikidata.org (properties P220 ISO 639-3, P1098 speaker count, P1394 Glottolog code, P279 family, P625 coordinates)
- **Licence:** CC0
- **Why:** an independent, *current* source of speaker counts to validate and enrich the catalogue data for this year.
- **What we did:** `enhance_data.py` queries Wikidata for live speaker counts and adds them as external rows (tagged `wikidata_live_external`), kept separate from the official ELCat data so a guess is never presented as a catalogue fact.

**Public articles (2) — ‹FILL IN: title + link for each›**
- Used as published reference figures to derive/validate decline rates and speaker estimates feeding the model.

**Dataset 4 (runtime) — ROR (Research Organization Registry)**
- **Source + link:** https://ror.org · **Licence:** CC0
- **Why / what we did:** find a real, locatable institution near an endangered language; queried on demand for national-tier institutions, keyed off offline reverse-geocoding, cached in SQLite with a TTL to stay within polite usage.

**Curated layer — institutions.json**
- Hand-verified global/continental bodies (UNESCO, Endangered Languages Project, etc.) marked `confidence: "verified"`, kept separate from auto-discovered entries so we never present a guess as a fact.

> ‹Team: fill the three ‹FILL IN› dataset/article blocks with the real names, links, and licences before code freeze — this section is graded on data integrity, so accuracy here matters more than anywhere else.›

---

## 8. How Will the Platform Scale?

*Imagine 10,000 people show up tomorrow — what happens?*
**(helps your score on: Adaptive Sustainability)**

**Technically:** the public side scales easily — per-year predictions are static JSON, lazy-loaded and cached client-side, so the globe/forest/queue sit behind a CDN (Vercel) with near-zero backend load, and because the model runs offline, traffic never hits it. The API (Render) holds its dataset in memory and is read-mostly, so it scales horizontally behind a load balancer. The **first thing to break under heavy outreach use is SQLite** (single-writer, our sweep is lock-serialized) — under real concurrency we'd move the outreach queue to Postgres. The other limit is the bundled per-year snapshots inflating the frontend build — next step is serving them from object storage instead of bundling.

**As a platform:** the natural way to scale impact is **partnering with organizations like UNESCO** and the Endangered Languages Project — bodies that already hold authoritative endangerment data and institutional contacts. Plugging their data in improves our predictions and replaces our test recipients with real, verified institutional contacts, turning LastEcho from a demo pipeline into an actual outreach channel for the field.

---

## 9. What Challenges Did You Face?

*Every project hits walls — tell us about yours and how you climbed over.*
**(helps your score on: Tech Execution)**

- **Predicting from sparse, uneven data.** Real speaker counts exist for only a handful of years per language, so training a model that forecasts a believable trajectory — without inventing precision the data doesn't support — meant careful feature engineering, a strict 70/20/10 split, and validating against independent web searches rather than trusting the held-out set alone.
- **Serving the model cheaply.** Re-running a model per request for data that changes once a year is wasteful, so we export predictions and **cache them as JSON** — instant and reproducible.
- **Keeping the live ranking and the drafting order in sync.** Two implementations of the same triage math (`triage.ts` + `build_data.py`) could drift and make us email about a different language than the one shown as most urgent; we drive both from one build step with identical weights.
- **Concurrency on the outreach queue.** Two sweeps at once could draft duplicate emails, so we added a non-blocking lock and atomic read-then-write guards so a contacted language is never re-drafted.

---

## 10. Did You Check What Already Exists?

*Most teams skip this — so doing it is an easy way to stand out. ⭐*
**(helps your score on: Idea & Data Integrity)**

Yes — and that check is exactly why we built LastEcho the way we did. The **Endangered Languages Project**, the **UNESCO Atlas of the World's Languages in Danger**, and **Glottolog/Ethnologue** are the best-known references. Here's the honest finding: **those platforms surface statistics about the problem, but the information mostly isn't actionable** — it's a snapshot of *what is*, often out of date, with no sense of *what's coming next* or *what to do about it*. They show endangerment; they don't *solve* anything.

LastEcho's difference is the **action layer**: we **predict** each language's trajectory, **prioritize** the most urgent ones, **match** each to a real institution, and **draft** the outreach to start a rescue conversation. As far as we found, the full **"predict → map → triage → drafted outreach"** pipeline doesn't exist as one tool — and we build on Glottolog rather than competing with it.

---

## 11. Where Did You Use AI, and What's Not Yours?

*Be open about your helpers — the rules require disclosing AI and third-party work.*
**(helps your score on: AI Fluency)**

- **Our own ML work:** the speaker-count regressor + endangerment classifier (built and trained by us with **scikit-learn** — see §6) is core project work, along with the data pipeline that prepares the training pairs. We also trialled **Prophet** as a cross-check.
- **AI tools used:** Anthropic Claude is a runtime feature — it drafts the outreach emails. We also used Claude / AI coding assistants during development for debugging, refactoring, and documentation.
- **Third-party code / libraries:** `react-globe.gl` + Three.js (globe + forest), FastAPI + Uvicorn (API), `reverse_geocoder` (offline geocoding), `httpx` (HTTP). Data from Glottolog and ROR (see §7).
- **Their licences:** scikit-learn (BSD), pandas/NumPy (BSD), react-globe.gl (MIT), Three.js (MIT), FastAPI/Uvicorn/Starlette (BSD), httpx (BSD), reverse_geocoder (LGPL), Glottolog (CC BY 4.0), ELCat/CLDF (CC BY), Wikidata (CC0), ROR (CC0).

> _Everything in `app/`, `client/src/`, and our training pipeline is our own code; the libraries above are clearly attributed dependencies._

---

## 12. Honesty Box

*The most underrated section. Tell us what's NOT done.*
**(helps your score on: Tech Execution)**

- **The future years are predictions, not certainty.** Our model forecasts "if current trends hold"; treat 2027–2050 as an informed projection, not a guarantee. We validated against held-out data and live web searches, but the further out you go, the wider the real uncertainty.
- **The shipped per-year data is the model's cached output, not a live model call.** The training/projection scripts live in `ml/`, but the app itself reads pre-computed JSON — by design, so it never re-runs the model for inputs that only change once a year. The trained model artifact (`lastecho_model.joblib`) and the source ELCat database aren't committed (they're regenerated from the scripts + public datasets).
- **Some languages have thin source data.** Where the inputs were too sparse to model a reliable trajectory we fall back to flat/derived values (logged in `corrections.csv`); those dots don't move because of data, not because the language is safe.
- **Outreach sending needs configuration to be real.** Without `ANTHROPIC_API_KEY` the drafts use a deterministic template, and without SMTP/Postmark env vars the send endpoint returns 503 — so in a fresh demo the pipeline drafts and queues but won't actually email anyone. The seed recipient emails currently point at our own test inbox, not production institutions.
- **Auto-discovered institutions can be wrong.** ROR + reverse-geocoding gives a *plausible* nearby organization, not a verified contact; only entries marked `verified` in `institutions.json` are hand-checked.
- **Storage is SQLite on a single volume** — fine for one admin, not built for concurrent multi-user outreach (see §8). **Admin auth is lightweight** (HMAC-signed token, 8h TTL, single shared password) — suitable for a single operator, not multi-account production.

---

**Note:** Filled against the actual repo and the team's own account of the ML work. Before code freeze: fill the `‹FILL IN›` blocks (model library + metric in §4/§6, the three dataset/article entries + licences in §7), add live repo/demo links, and confirm no real secrets are in `.env` (only `.env.example` should be tracked).
