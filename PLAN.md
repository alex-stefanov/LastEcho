# LastEcho — Concept

> A triage system that forecasts which endangered languages will fall through the
> documentation window — and when — so the world can record them before it's too late.

---

## The problem

A language dies roughly every two weeks. Each one is an entire world of knowledge — songs,
medicine, law, star-maps, ways of seeing — vanishing at once. When the last speaker dies
**undocumented**, that knowledge is gone forever. When they die **documented**, it survives,
and can even be revived.

The real problem isn't that languages die — it's that they die **unrecorded and unranked**.
With limited linguists and limited funding, nobody has a good system for deciding *which
languages to record first, and how urgent each one is*. There is no triage.

---

## The idea

**LastEcho is that triage system.**

We do not claim to save languages — that's driven by forces no tool can touch. We solve the
tractable problem: **forecasting, from the historical record, which languages are about to
fall through the documentation window, and ranking them so the field records them first.**
Grief turned into a rescue queue.

---

## The thesis

Ranking endangered languages by *urgency alone* wastes effort on languages already lost or
already well-documented. The true emergency is a language **about to die that nobody has ever
written down** — and the question that matters is *will the record be made in time?*

LastEcho forecasts that by crossing two histories:

- **How endangered a language is, and which way it's trending.**
- **Whether it has ever been documented, and how that documentation has grown — or failed to.**

The cross of those two is the triage signal: the languages most in danger whose documentation
window is closing fastest, with the thinnest record to fall back on.

---

## Why this is forecastable — the data behind it

This is the heart of why LastEcho is real and not just a dashboard. We aren't displaying a
single stale snapshot — we are using **the past states of the world's languages to train a
model that projects forward to a chosen future year.** Two historical signals make that
possible, and they are honestly different in depth.

**1. Documentation history — deep, decades long.**
Glottolog records, for nearly every language, the most extensive description that has ever
existed *and how that has changed over time* — a wordlist in one decade, a grammar sketch
later, a full grammar later still, or nothing at all, ever. Because descriptions are dated by
their sources, this trajectory reaches back decades. This is a genuine, long time series, and
it is the trainable spine of the model: given how a language's documentation has grown, and
its circumstances, will the record be completed before the window closes?

**2. Endangerment history — shallower, reconstructed, honest about it.**
Glottolog does not track endangerment year by year. But it publishes dated, archived
**versioned releases** — roughly annual snapshots from about 2021 to 2026 (versions 4.5
through 5.3), each a frozen record of every language's endangerment status at that moment. By
comparing a language's status across these releases, we reconstruct an endangerment
trajectory — a panel of several yearly points. This is the more ambitious, exploratory signal,
and we carry two honest caveats: it is **short** (a handful of years is thin for forecasting
decline that unfolds over decades), and some changes between versions reflect **reassessment
or better sources rather than real-world decline.** Naming this openly is what makes the
project rigorous rather than naïve.

**The combination is the project.** A long, rich documentation history plus a short,
reconstructed endangerment history, trained together to forecast the moment a language crosses
from *endangered but still documentable* to *lost without a record* — and to put a year on it.
That is "what will happen in year X," grounded in real past states, with uncertainty shown
honestly rather than hidden behind false precision.

---

## What you can do with it ("then what")

Not just information — a forecast and a worklist.

- **A projection per language** — not a false-precise countdown, but an honest forecast with
  a range: where this language is heading, and roughly when its window closes.
- **A documentation worklist** — what already exists, what's missing ("no dictionary, no
  audio, never written down"), and therefore what to record first.
- **A living priority queue** — the ranked list of what to save first, reshaped live as you
  decide what matters most.
- **A "what if we recorded the top N?" view** — turn the forecast into a budget: here's what's
  still lost, here's what's saved if the field acts now.
- **A connection to help** — for each language, who funds and archives documentation in that
  region, so the worklist points somewhere real.

---

## Who it's for

One tool, two doors:

- **Everyone** — the globe. A gut-punch that converts people who never thought about language
  death into people who care.
- **The documentation field** — linguists, archives, and funders who actually decide where
  scarce effort goes. The forecast and the priority queue are their worklist.

---

## The UI — the Earth

The interface **is the planet.**

A rotating globe in space, the whole Earth as the canvas. Every living language is a point of
light on its surface. The lights are not uniform — they are **colored by vitality**, sorting
the world's languages into three clear groups so the state of the planet reads at a glance:

- **Alive** — languages still being passed to children, in steady health. Shown in calm,
  living color (e.g. green/blue).
- **At risk** — languages losing ground: shrinking, aging, no longer reaching the young. Shown
  in a warning color (e.g. amber/orange).
- **Lost** — languages whose last speakers are gone. Shown as cold, extinguished points (e.g.
  grey/dark), so the dark spots on the globe are visible as absence.

Spin the Earth and the crisis becomes geographic and visceral: dense constellations of amber
and grey cluster over the world's endangerment hotspots — the highlands of Papua New Guinea,
the Amazon, Northern Australia, the Caucasus, the Pacific Northwest. You don't read that these
places are losing their languages; you *see* it, written across the globe.

**Filter (top-right).** A control panel in the top-right corner lets the user toggle the three
groups on and off — show only the lost, only the at-risk, only the living, or any combination.
Isolating the "lost" layer turns the globe into a map of what's already gone; isolating
"at-risk" shows exactly where the next decade's losses will fall. The filter turns the same
globe into several different stories.

**Timeline (bottom-center).** A horizontal scrubber across the bottom of the screen moves the
whole globe through time. Drag it back and watch the lights shift group by group across the
decades — living languages sliding into at-risk, at-risk going dark — then push it past today
into the **forecast**, where the model projects which lights go out next, and when.

> Note on cost: scrubbing the timeline triggers **no** live model calls. Each language's
> status for every year — past and forecast — is **computed once, ahead of time**, and loaded
> with the globe. Dragging the scrubber only re-reads already-computed values and recolors the
> dots, so it stays instant and cheap no matter how fast the user scrubs. The model is
> consulted at build time, never during interaction. (The only live model use is the separate
> "score my own language" tool, where a user enters new data.)

**Click a language → its full story.** Selecting any point opens that language's detail view:

- its **group and forecast** — alive / at-risk / lost, where it's heading, and roughly when the
  window closes, shown with honest uncertainty,
- **speakers and trend** — how many remain and which way the numbers move,
- what's been **recorded and what never has** — the documentation worklist,
- its **family tree** — the language shown in its genealogical context, with its branch and
  relatives mapped out; if it's the **last of its family**, the whole lineage is shown
  withering around it, making the stakes of this single loss legible,
- and its **rank** in the world's priority queue: "the single most urgent language on Earth to
  record right now."

The emotional arc is the whole pitch: a planet of colored light, sorted into the living, the
fading, and the lost — with a way to see what's coming and choose what we save before the next
light goes out.

---

## The five additions that close the loop

The globe shows the crisis. These five features turn it into a tool that responds to it —
each one feeding the next, nothing floating.

---

### 1. Real Glottolog data (foundation)

Replace the procedurally-generated mock languages with real data from Glottolog — real
names, real coordinates, real endangerment levels, real documentation history. Without this,
every other feature is a demo. With it, the tool is credible to the exact audience it's for.
Even a subset (the ~500 most endangered languages) is enough to land.

---

### 2. The Rescue Queue (the product)

A persistent right panel showing the ranked list of languages most urgent to document right
now — with three live weight sliders:

- **Urgency** — how soon the documentation window closes
- **Doc gap** — how thin the existing record is
- **Uniqueness** — last-of-its-family weighting

Dragging a slider reshuffles the queue in real time. A linguist and a funder can look at the
same list, disagree about weights, and watch the priorities change. This is the thesis made
interactive: not "here is the crisis" but "here is what to do about it, and here is how your
values shape the answer."

---

### 3. Extinction cascade (the data science made visible)

When the timeline advances and a language dot goes dark, the urgency scores of its language
family relatives ripple upward in the Rescue Queue — in real time, visibly. The queue
reorders as extinction events propagate through the phylogenetic tree.

This makes the family-tree data functional rather than decorative. It is also the survival
model's output made visceral: you watch the loss of one language raise the stakes for every
language that shares its lineage.

---

### 4. Budget optimizer (turns ranking into a decision)

A funder inputs a constraint: "10 linguist-years / $400k." The system returns the optimal
portfolio of languages to document given those constraints — a knapsack optimization over
triage scores and estimated documentation cost (derivable from doc gap + region + family
complexity).

No existing tool answers the question funders actually have: *not which language is most
urgent, but which combination of languages to fund given finite resources.* This is the
upgrade from worklist to decision support.

---

### 5. "What if we act?" toggle (closes the loop)

Mark any language in the Rescue Queue as "being documented now." Its dot changes color on
the globe. Its window extends. Its urgency score falls. The queue reshuffles. Relatives'
scores adjust via the extinction cascade.

The tool no longer just shows what's at risk — it lets you simulate the impact of choosing
to act, before committing. Grief turned into a rescue queue turned into a decision with
visible consequences.

---

## Beyond language — the wider vision

Each point of light isn't only grammar. It's the only copy of songs, ceremonies, medicine,
navigation, and law carried in that tongue. When a language goes dark, all of it goes with it.

The natural next chapter is **cultural traditions** — scoring intangible heritage loss the
same way, so the globe shows not just dying languages but dying knowledge of every kind. A
vision for where LastEcho goes, once the core triage works.

---

## The one-line pitch

> A planet of fading light — every dot a language, the dim ones with years not decades.
> Trained on the real history of the world's languages, LastEcho forecasts which lights go out
> next, and ranks which to record before they do. Not a cure. A triage list. Grief turned into
> a rescue queue.
