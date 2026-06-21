# ZaraHack 2026 — Project Submission (HACKATHON.md)

Project: **LastEcho** — an interactive globe for endangered-language data, plus an automated outreach pipeline that turns "this language is dying" into "here is a drafted email to the institution that could save it."

---

## 1. Team

*Who are you, and where does everything live?*
**(helps your score on: Team Work)**

- **Team name:** LastEcho
- **Members (name — what each person did):**
  - **Adelin Chaushev** — backend (FastAPI, triage sweep, SQLite store, deployment) & repo lead
  - **Samuil Gigov** — frontend (React, 3D globe, Rescue Queue, admin panel)
  - **Teodora Nedkova** — data pipeline (Glottolog processing, corrections/reclassification, projections)
  - **Alex Stefanov** — institution matching, outreach drafting, integrations
- **How did you split the tasks? Who did what?:** We split along the data → backend → frontend seams. Teodora built the offline data build that turns the raw Glottolog snapshot into per-year vitality projections; Adelin built the API and the triage/outreach engine that consumes it; Samuil built the public globe + admin UI on top of the API; Alex owned the institution ladder and the Claude-drafted emails that tie the two halves together.

> _Teammates: please correct your individual task lines above if needed, and add repo/demo links here once they're live._

---

## 2. What Problem Are You Solving?

*What's the problem, and who actually has it?*
**(helps your score on: Idea & Data Integrity)**

A language dies roughly every two weeks, and by 2100 up to half of the world's ~7,000 languages may be gone. The people who feel this most are **speaker communities** losing their heritage and the **linguists, universities, and cultural institutions** racing to document languages before the last fluent speakers pass away. The hard part isn't knowing languages are dying — it's knowing *which* ones are most urgent right now and *who* is positioned to act. LastEcho ranks the most at-risk languages from real data and routes that urgency to the specific institutions that can help.

---

## 3. How Do You Solve It? (in plain language)

*Explain it to a normal person (grandpa style) — no tech words allowed.*
**(helps your score on: Presentation)**

Imagine a spinning globe where every dot is a language, and the color tells you how close it is to disappearing. You can slide time forward to watch the map go quiet, year by year. Behind the scenes, our system looks at the most endangered languages, figures out which university or cultural group is best placed to help each one, and writes a polite first email for a human to check and send. So instead of a sad chart, you get a to-do list of who to contact to actually make a difference.

---

## 4. What Technologies Do You Use?

*List the building blocks: languages, frameworks, services, libraries, APIs.*
**(helps your score on: Tech Execution)**

- **Languages:** TypeScript, Python 3.12
- **Frontend:** React 18, Vite, `react-globe.gl`, Three.js
- **Backend:** FastAPI, Uvicorn, SQLite (no ORM — plain `sqlite3`)
- **Data tools / libraries:** Python standard library for the offline data build; `reverse_geocoder` (offline lat/lng → country); `httpx` for API lookups
- **APIs / services:** Anthropic Claude (outreach drafting), ROR — Research Organization Registry (institution lookup), SMTP/Postmark (sending)
- **Hosting / deployment:** Docker, Fly.io with a persistent volume for the SQLite database

---

## 5. How Do You Wire Them Together?

*The architecture — how do the pieces talk to each other?*
**(helps your score on: Tech Execution)**

```
[Glottolog snapshot] -> [build_data.py: clean + project + triage-rank]
        -> [per-year JSON bundled in frontend]  -> [3D globe + Rescue Queue]
        -> [api/data/languages.json]            -> [FastAPI in-memory]
                                                       |
   [triage sweep: score urgency/population/uniqueness] |
        -> [matching.py builds local/continental/global institution ladder
            via reverse-geocoder + ROR API]
        -> [outreach.py drafts email via Claude (or template fallback)]
        -> [SQLite outreach_queue]
        -> [admin reviews/edits/approves]
        -> [SMTP send] -> [no reply after N days -> escalate to next tier]
```

The globe data and the outreach data come from the *same* build step, so what a user sees ranked on the Rescue Queue is exactly what the backend drafts emails about. The backend loads its dataset into memory at startup; only the outreach queue and the ROR cache touch the database.

---

## 6. Do You Train an ML Model?

*ML is a bonus, not a must — be honest either way.*
**(helps your score on: AI Fluency)**

**No ML — here's what we built instead:** a transparent, deterministic **projection + triage model** plus an **LLM in the loop** for language generation.

- The **projections** (2000–2050) extrapolate each language's speaker count from observed decline rates in the source data — an explainable rate model, not a black box. Where no reliable rate exists we project flat and record the reason (see `corrections.csv`).
- The **triage score** is a weighted blend of three normalized signals — extinction urgency (Glottolog 8-level risk scale), speaker population (log-normalized), and linguistic uniqueness (family size) — implemented identically in `client/src/data/triage.ts` and `api/scripts/build_data.py` so frontend and backend agree.
- We **use** a pretrained model (Anthropic Claude) to draft outreach emails, but we do not train or fine-tune it; it always falls back to a deterministic template if no API key is set.

We deliberately chose an auditable model over a trained one because outreach decisions need to be explainable to the institutions we contact.

---

## 7. What Datasets Do You Use, and How?

*Real, public data is the heart of this hackathon — show yours off.*
**(helps your score on: Idea & Data Integrity)**

**Dataset 1 — Glottolog**
- **Source + link:** https://glottolog.org (catalogue of the world's languages + vitality/risk classification)
- **Licence:** CC BY 4.0
- **Why this data:** It's the authoritative, openly-licensed reference for language families, ISO codes, and endangerment status — the backbone of any honest extinction map.
- **What we did to it:** Built per-year snapshots (2000–2050), mapped the 8-level risk scale to vitality groups, and projected speaker counts forward from observed rates. We logged every manual fix in `client/src/data/corrections.csv` (e.g. flat-projecting languages with no observed rate) and every status change in `reclassified.csv` (e.g. demoting under-evidenced "watch" entries to "unknown" rather than overstating risk). Stable IDs derive from ISO codes so a re-run never double-contacts a language.

**Dataset 2 — ROR (Research Organization Registry)**
- **Source + link:** https://ror.org (open registry of research organizations)
- **Licence:** CC0
- **Why this data:** To find a real, locatable institution near an endangered language rather than guessing.
- **What we did to it:** Query it on demand for national-tier institutions, keyed off offline reverse-geocoding of language coordinates, and cache results in SQLite with a TTL to stay within polite usage.

**Curated layer — institutions.json**
- Hand-verified global/continental bodies (UNESCO, Endangered Languages Project, etc.) marked `confidence: "verified"`, kept separate from auto-discovered entries so we never present a guess as a fact.

---

## 8. How Will the Platform Scale?

*Imagine 10,000 people show up tomorrow — what happens?*
**(helps your score on: Adaptive Sustainability)**

The public globe scales well: per-year data is static JSON, lazy-loaded and cached client-side, so it can sit behind a CDN with near-zero backend load. The API holds the dataset in memory and is read-mostly, so it scales horizontally behind a load balancer. **The first thing to break under heavy admin/outreach use would be SQLite** — it's a single-writer file and our sweep is serialized with a lock; under real concurrency we'd move the outreach queue to Postgres. The other limit is the ~99 MB of bundled per-year snapshots inflating the frontend build — next step would be to serve those from object storage / an API endpoint instead of bundling them.

---

## 9. What Challenges Did You Face?

*Every project hits walls — tell us about yours and how you climbed over.*
**(helps your score on: Tech Execution)**

The biggest one was **keeping the frontend's live triage ranking and the backend's drafting order in sync** — two implementations of the same scoring math drifting apart would mean we'd email about a different language than the one shown as most urgent. We solved it by porting the exact weights and signal functions from `triage.ts` into `build_data.py` and driving both from one build step. The second was **concurrency on the outreach queue**: two sweeps running at once could draft duplicate emails, so we added a non-blocking lock and read-then-write guards so a contacted language is never re-drafted.

---

## 10. Did You Check What Already Exists?

*Most teams skip this — so doing it is an easy way to stand out. ⭐*
**(helps your score on: Idea & Data Integrity)**

Yes. The **Endangered Languages Project** and **UNESCO Atlas of the World's Languages in Danger** are the best-known references, and **Glottolog/Ethnologue** provide the underlying classification — we build on Glottolog rather than competing with it. Those existing tools are excellent *catalogues* and *maps*, but they stop at "here is the data." Our twist is the **action layer**: we don't just visualize endangerment, we rank it, match each language to a real institution, and draft the outreach to actually start a rescue conversation. As far as we found, the "map → triage → drafted outreach" pipeline doesn't exist as one tool.

---

## 11. Where Did You Use AI, and What's Not Yours?

*Be open about your helpers — the rules require disclosing AI and third-party work.*
**(helps your score on: AI Fluency)**

- **AI tools used (and for what):** Anthropic Claude is a runtime feature — it drafts the outreach emails. We also used Claude / AI coding assistants during development for debugging, refactoring, and documentation.
- **Third-party code / templates / tutorials you reused:** `react-globe.gl` + Three.js (globe rendering), FastAPI + Uvicorn (API), `reverse_geocoder` (offline geocoding), `httpx` (HTTP). Data from Glottolog and ROR (see §7).
- **Their licences:** react-globe.gl (MIT), Three.js (MIT), FastAPI/Uvicorn/Starlette (BSD), httpx (BSD), reverse_geocoder (LGPL), Glottolog (CC BY 4.0), ROR (CC0).

> _Everything in `app/` and `client/src/` is our own code; the libraries above are clearly attributed dependencies._

---

## 12. Honesty Box

*The most underrated section. Tell us what's NOT done.*
**(helps your score on: Tech Execution)**

- **The 2000–2050 projections are an extrapolation, not a forecast.** They're a transparent rate model over real Glottolog data, not validated predictions of the future — treat the future years as a "if current trends hold" illustration, not certainty.
- **Many languages are projected flat** where the source had no reliable decline rate (logged in `corrections.csv`); those dots don't move over time by design, not because they're safe.
- **Outreach sending needs configuration to be real.** Without `ANTHROPIC_API_KEY` the drafts use a deterministic template, and without SMTP env vars the send endpoint returns 503 — so in a fresh demo the pipeline drafts and queues but won't actually email anyone.
- **Auto-discovered (national-tier) institutions can be wrong.** ROR + reverse-geocoding gives a *plausible* nearby organization, not a verified contact; only entries marked `verified` in `institutions.json` are hand-checked, and many auto-matched ones lack a real email.
- **Storage is SQLite on a single volume.** Fine for one admin; not built for concurrent multi-user outreach (see §8).
- **Admin auth is lightweight** — an HMAC-signed token with an 8h TTL and a single shared password, suitable for a demo/single operator, not multi-account production use.

---

**Note:** This file was filled in against the actual repo, but please re-verify the team task split and add live repo/demo links before the code freeze, and confirm no real secrets are in your `.env` (the repo only tracks `.env.example`).
