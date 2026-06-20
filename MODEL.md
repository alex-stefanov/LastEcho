# LastEcho — Methodology

> How LastEcho forecasts which languages fall through the documentation window, and when.
> This document states the modeling approach, validation, and honest limitations. It is the
> Data Science companion to the concept in PLAN.md.

---

## 1. What we are predicting

The core prediction target is **time until a language's documentation window closes** — the
year by which, if no record is made, the language is likely to be lost *without* adequate
documentation.

A language is "saved" in the sense that matters here not when it stops dying, but when it has
been recorded well enough to survive the death of its last speaker. So the model forecasts two
linked things:

1. **Endangerment trajectory** — where a language's vitality is heading, projected forward to a
   chosen year.
2. **Documentation trajectory** — whether and when its record (grammar, dictionary, audio) is
   likely to be completed.

The window closes when endangerment outruns documentation: the speakers go before the record
is made. The model's headline output per language is a projected **status by year** (alive /
at-risk / lost) plus a **time-to-window-closure** estimate, each with an uncertainty range.

This is a **time-to-event (survival)** problem, not a plain classification problem, because the
event (window closure) lies in the future for most languages and is *censored* — most languages
haven't reached it yet. Survival framing handles that censoring correctly, which is the
honest, technically correct choice and a point worth making to judges.

---

## 2. The two signals and the models on each

### Axis A — Documentation trajectory (the deep, trainable spine)

Glottolog records, for nearly every language, the most extensive description that has ever
existed and how it changed over time, dated by its sources — a real time series reaching back
decades.

- **Model:** a **discrete-time survival model** for "time until adequate documentation,"
  treating each language-year as an observation and estimating the hazard of the documentation
  level advancing. A **Cox proportional-hazards** model is the transparent baseline here; a
  **random survival forest** is the stronger non-linear alternative if time allows.
- **Why survival, not regression:** most languages never reach "fully documented," so the data
  is censored. Survival models use censored cases correctly instead of throwing them away.

### Axis B — Endangerment trajectory (the shallow, reconstructed signal)

Glottolog does not track endangerment over time, but it publishes dated, archived versioned
releases (roughly annual, ~2021–2026, versions 4.5–5.3). Diffing a language's endangerment
status across releases reconstructs a short panel — several yearly points per language.

- **Model:** an **ordinal trend / panel model** over the reconstructed status sequence —
  estimating the probability of moving down the 6-level endangerment scale per year. Because
  the panel is short, this is deliberately simple (ordinal logistic / Markov-style transition
  probabilities between adjacent levels), not an over-parameterized model that would overfit a
  handful of time points.

### Combining them

The two axes are joined into the window-closure forecast: endangerment trajectory says how fast
speakers are vanishing; documentation trajectory says how fast (if at all) the record is being
built. Where the first outruns the second, the window closes — and the model dates it.

---

## 3. Features

Engineered per language, from real Glottolog fields plus geography:

- **Endangerment level** (current) and its **reconstructed trend** across releases.
- **Documentation level** (current best description) and its **historical growth rate**.
- **Uniqueness / genealogy** — is it an isolate or the last branch of its family; family size
  and depth (from the classification tree).
- **Geographic / contact pressure** — engineered from coordinates: number of dominant
  languages nearby, distance to the nearest major language, density of other endangered
  languages in the region. Language shift is contagious and geographic, so spatial context is a
  genuine predictor, not decoration.
- **Speaker demographics where available** — counts and, critically, whether children still
  learn it (intergenerational transmission is the single strongest known predictor of language
  death; included wherever the source data carries it).

---

## 4. The triage score (turning forecast into a ranked worklist)

The forecast feeds a transparent, explainable triage score that produces the priority queue:

```
urgency      — how soon the window closes (sooner = higher)
doc_gap      — how thin the existing record is (thinner = higher)
uniqueness   — last-of-its-kind weighting (isolate / last branch = higher)

triage       = weighted combination, weights exposed as live sliders in the UI
```

Keeping the final ranking step transparent (a weighted, inspectable combination on top of the
model's forecast) is intentional: it lets a linguist see *why* a language is ranked where it is,
and lets the user re-weight by what they value. Black-box ranking would be less trustworthy to
the exact audience this is for.

---

## 5. Validation — how we show it works

This is the section a Data Science judge will look for. The plan:

- **Backtest against held-out years (the headline test).** Train on the earlier reconstructed
  snapshots (e.g. ~2021–2024), then predict the later ones (2025–2026) and check the forecast
  against what Glottolog actually recorded. This is a real out-of-sample test of "does the model
  predict the future state," using the version history as ground truth.
- **Survival-model evaluation.** Report a **concordance index (C-index)** for the
  time-to-event models — the standard measure of whether predicted risk ordering matches actual
  outcome ordering. Show calibration of the predicted timelines, not just ranking.
- **Baseline comparison (non-negotiable).** Compare every model against a **naive baseline** —
  "status stays exactly as it is" (persistence) and a simple "linear extrapolation of past
  trend." The model only earns its place if it beats persistence. Stating this up front signals
  we're measuring added signal, not just producing numbers.
- **Ablation.** Show how much the spatial-pressure features and the documentation-trend
  features each contribute, to demonstrate the feature engineering matters.

---

## 6. Honest limitations (stated as rigor, not apology)

A Data Science track rewards knowing the limits of your data. Ours, plainly:

- **The endangerment panel is short.** A handful of annual snapshots is thin for forecasting
  decline that unfolds over decades. We present endangerment-trajectory forecasting as the
  **exploratory** arm and lean the strongest claims on the deeper documentation axis.
- **Version changes mix real decline with reassessment.** When a language's status shifts
  between Glottolog releases, it may reflect a corrected or better-sourced assessment rather than
  real-world change. We cannot fully separate the two; we flag forecasts whose signal rests
  heavily on this and widen their uncertainty accordingly.
- **Documentation status is reliable only for spoken first-language and sign languages**, per
  Glottolog itself — so the triage is scoped to those, which is the correct scope anyway.
- **Speaker-demographic data is uneven.** Where intergenerational-transmission data is missing,
  the model leans on the signals that are present and reports wider uncertainty.
- **We forecast a documentation window, not a death date.** We never claim to know the year a
  language "dies." The honest target is when its window to be *recorded* likely closes, with a
  range — false precision is avoided on purpose.

---

## 7. Why this is a Data Science project, not a dashboard

The deliverable is not a visualization of existing labels. It is: a **survival model** trained
on a **reconstructed historical panel**, with **engineered spatial and trajectory features**,
**validated by backtesting against held-out years** and **benchmarked against naive baselines**,
producing a **calibrated, uncertainty-aware forecast** that drives an **explainable triage
ranking**. The globe is how the result is communicated; the model is the project.
