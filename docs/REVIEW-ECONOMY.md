# Economy tab — design review against the new north star

**North star (2026-09-29):** *understand and predict when the countries or
AORs I track are engaging in economic warfare* — using economic leverage
(energy, trade, finance, export controls) or attacking the economic system
itself (Iran targeting commercial shipping in Hormuz).

The current tab is a **mobility-economics board**: fuel cost, chokepoint
interdiction, U.S. regulatory actions, an "Economic Access Read", and a
sanctions/overflight news filter. That framing is *what economics does to my
access*. The new north star is *who is doing what to whom, and is it
escalating* — an **I&W problem**, not a dashboard problem. Most of the
sensors already exist; the organising unit is wrong.

Mockup: `docs/mockups/economy.html` → `docs/economy-redesign.png`.

## What is already right

| Piece | Keep because |
|---|---|
| `ChokepointBoard` graded reads (act › threat › analysis + georeferenced events) | This *is* the economic-warfare grammar for the shipping instrument. |
| AIS transit counts vs each strait's own baseline | The only sensor that reports what ships DO, not what people say. |
| Federal Register actions (OFAC / BIS / USTR) | The U.S. side of the move/counter-move sequence, as records not news. |
| Energy prices (Brent, WTI, gas) | The market's corroboration of a leverage play. |
| I&W chokepoint indicator on AOI boards | Already fuses the strait read into the warning pipeline. |

## What is missing for the new north star

1. **The unit is the instrument, not the actor.** Nothing says "Iran" as a
   row. The tab has a Hormuz row, an OFAC row, a Brent number — the reader
   does the join. The north star's question starts with the actor.
2. **No modality grading outside shipping.** Energy leverage, sanctions,
   export controls and finance are reported as news matches (`ACCESS_NEWS`
   regex) — a threat and an act score the same, the failure the chokepoint
   board fixed for shipping.
3. **No baseline, so no anomaly.** Iran seizing a tanker is a standing
   pattern some years and a break in others. Without a per-actor trailing
   baseline the tab cannot say "more than usual", which is the whole of
   *predict*.
4. **No sequence.** Moves and counter-moves are the signature of economic
   warfare (designation → seizure → premium spike → counter-designation).
   The tab shows them in four separate cards with no time axis.
5. **Only the U.S. side of regulatory action.** Foreign counter-measures
   (EU/UK sanctions, Chinese export-control notices, Iranian/Russian
   retaliation) arrive only if a news feed mentions them.
6. **No structural "could".** Leverage is a capacity before it is an act.
   Nothing records what each actor holds over the AOR (Hormuz throughput,
   critical minerals, overflight, gas) or what we hold over them.

## Proposed design (the mockup, top to bottom)

1. **Actor tiles** — one per tracked actor (from Mission Profile AOIs +
   watched countries; non-state actors like the Houthis curated). Each
   carries an I&W level (calm/watch/warning/alert), the anomaly vs a 30-day
   baseline, a trajectory arrow, and **instrument chips** lit only when that
   instrument has a graded signal: ⚓ shipping · ⛽ energy · ⊘ sanctions /
   export controls · ⇄ trade · ¤ finance · ✈ overflight. Same rules as the
   I&W board: colour is earned, learning mode caps at Watch, drivers are
   named.
2. **Coercion board** — actor → target → instrument → **grade** (reported
   act / declared threat / analysis only) → evidence (headline, source, age)
   → **corroboration** (AIS delta, price move, war-risk premium) →
   **affects** (which basing / sealift / fuel line of yours). This
   generalises `readActivity` from shipping to every instrument.
3. **Chokepoint strip** — the existing board compressed to one row of six
   tiles with a 7-day AIS sparkline each. Detail stays one click away.
4. **Leverage map** — per actor, two bars: what they can threaten (with a
   scale note, e.g. "~20 % of world oil") and what we hold over them.
   Curated, sourced, refreshed quarterly. Explicitly labelled *structural,
   not warning* so it never lights up.
5. **Moves & counter-moves timeline** — 30 days, four dot kinds (US action ·
   adversary action/threat · shipping signal · market move). Sequence is
   the predictive signal: a counter-move within days of a designation is a
   pattern the reader can learn.
6. **Economic warfare read** — the AI read reframed per AOR with the I&W
   discipline: a level call, a **falsifier**, and a **decision linkage**
   (fuel-cost assumptions, routing, crew-rest planning).

## How to build it (order, with what each needs)

| Step | Effort | Reuses | New |
|---|---|---|---|
| ✅ A. `lib/economicWarfare.ts` (PURE): instrument taxonomy + phrase grammar per instrument, graded by the existing `gradeModality`; actor attribution from the watched-country list + curated non-state actors | M | `chokepointSignals.readInterdiction` pattern | phrase lists per instrument |
| ✅ B. Actor assembler (server, 10-min cache): joins chokepoint reads, Federal Register rows, energy moves, GDELT/own-source news → per-actor observations → the **existing `lib/warning.ts` engine** for score/anomaly/level | M | `warning.ts`, `warningStore` daily rollup (new problem ids `econ-<actor>`) | `econ_daily` rows via the same lazy pattern |
| ✅ C. Coercion board + actor tiles UI | M | `ChokepointBoard`, `WarningBoard` styling | `EconomicWarfareBoard.tsx` |
| ✅ D. Timeline | S | Federal Register dates, chokepoint event ages, energy series | one SVG strip |
| ✅ E. Leverage map | S | — | curated JSON in `lib/leverage.ts` with source notes |
| ✅ F. Foreign counter-measure feed | M–L | — | **honest gap**: EU consolidated sanctions list is a keyless XML/CSV (data.europa.eu); UK OFSI publishes CSV; PRC MOFCOM notices have no API (would be a browser capture, same as LiveUAMap). Start with EU + UK CSVs, diff daily. |
| ✅ G. Read reframe | S | `/api/markets/brief` | prompt + `{level, falsifier, decisionLinkage}` shape |

**Status (2026-09-29): A–G shipped.** A–C: `lib/economicWarfare.ts` (grammar +
actor register + state ladder, tested), `lib/economicWarfareAssess.ts`
(assembler on the I&W engine, `warning_daily` ids `econ-<actor>`),
`components/markets/EconomicWarfareBoard.tsx` at the top of the tab.
D: `lib/economicTimeline.ts` (30-day dots in five lanes + retaliation/
counter sequences, tested) rendered as an SVG strip. E: `lib/leverage.ts`
(curated, sourced, `asOf`-stamped; folded panel that never colours). F:
`lib/foreignSanctionsParse.ts` (EU FSF + UK OFSI CSV parsers, tested on
synthetic rows) + `lib/foreignSanctions.ts` (24-h cache, `?diag=1` from
prod) feeding the counter-pressure indicator, the coercion board and the
EU/UK timeline lane — PRC MOFCOM remains the honest gap. G: `/api/markets/
brief` now returns `{read, actors[{level, call, falsifier, decisionLinkage}],
fuelLogistics, watchItems}` with the deterministic board as its evidence.
The chokepoint strip (mockup item 3) is now one row of tiles with a single
detail panel. PRC MOFCOM notices — the gap named under F — arrive by browser
capture (`tools/x-auto-capture/mofcom.js` → `/api/capture/notices`) and are
credited to the China actor as its own official record.

A–C deliver the north star's *understand*; B's baseline plus D's sequence
deliver *predict*. E and F are the structural and foreign halves that make
the board honest about what it cannot see.

## What not to do

- Do not score by mention count anywhere on this tab; the chokepoint board
  earned its credibility by grading, and a mention counter next to it would
  undo that.
- Do not let the leverage map light up. It is capacity, and a capacity that
  glows red every day is the Christmas-tree failure.
- Do not fold this into the OSINT I&W boards' six indicators. It is a
  separate problem family with its own sensors; it should *feed* those
  boards (as the chokepoint indicator already does), not replace them.
