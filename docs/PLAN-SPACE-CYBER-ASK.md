# Plan — counterspace & cyber POSTURE as I&W, and "Ask the board"

_2026-10-22. Thinking-through for two requests: (1) "include space and cyber
posturing and I&W" with the Kosmos 2612 / ICEYE-X36 encounter as the
canonical example; (2) "ask my dashboard questions based on its collective
knowledge — how likely is conflict with Iran, what indicators show Russia
positioning for war". Analysis and recommendations; nothing here is built
yet. Builds on `docs/REVIEW-CYBER-SPACE.md` (steps A–G shipped 2026-09-30)._

---

## 1. The worked example, read as an indicator chain

Kosmos 2612 → ICEYE-X36 (reported 2026-10-17/19 by Space.com, Gizmodo,
Axios; tracking by LeoLabs and Marco Langbroek; the Space Force said the
Cosmos satellites were positioned close to "a Western commercial radar
satellite used by Ukraine"):

| When | What the catalogue showed | What a board should have read |
|---|---|---|
| April 2026 | Six spacecraft on one Russian launch (Kosmos 2612 among them) | `space_activity`: launch within cadence — **dormant**. Correct: a launch is not a signal. |
| May 2026 | Four of the six manoeuvre into an orbit **co-planar** with ICEYE-X36 | **watching** — a plane change towards a declared asset of interest is positioning. Nothing in the app could see this: it needs element-set history, not headlines. |
| 15–19 Oct | Kosmos 2612 closes to ~500 m (two days inside ~5 km), then departs | **active** — proximity to an asset of interest below a threshold. |
| 17–19 Oct | LeoLabs / Langbroek / Space Force / SWF comment | **confirmed** — a named tracking firm and an official statement corroborate. |

Three lessons the design has to carry:

1. **The signal lives in the catalogue, four months before the wire.** The
   app's space indicator reads launch cadence (LL2) and SOCRATES
   conjunctions (host unreachable). Neither sees a plane change. The data
   that would have shown May is public two-line element history.
2. **Posture is the standing programme; warning is the change.** Russia's
   inspector fleet (Nivelir / Burevestnik / Luch-Olymp lineages; the 2020
   approach to a classified U.S. satellite and the repeated USA 326
   approaches the article cites) is years old. "Russia has inspector
   satellites" is posture, not warning — exactly the Level-4-advisory lesson
   in `warningRules`. What earns colour is a **new target class** (a
   commercial ISR provider supporting Ukraine — coercion of operators), a
   **distance trend** (hundreds of km → 500 m), and **co-occurrence** with
   the board's other instruments (jamming surge, pre-positioning advisories,
   mobilisation).
3. **Attribution of intent is the model's temptation and must stay out of
   the deterministic layer.** "Electronic surveillance or EW" is expert
   speculation. The board records distance, duration, plane, target class,
   and who said what. The read (AI, on tap) may say what it might mean, with
   the falsifier beside it.

## 2. Counterspace posture — the indicator

One new indicator per board whose AOI holds a space power (Russia, China —
Iran and DPRK keep launch cadence only), **`counterspace_activity`**,
alongside the existing `space_activity` (which keeps launch cadence and
drops the dead SOCRATES half). Weight 0.55. Falsifier: _"No tracked
inspector within 50 km of a declared asset of interest for 30 days, no
manoeuvre by the inspector fleet beyond station-keeping tolerance, and no
counterspace act reported by a tracking firm or USSF in 14 days."_

### 2.1 Observations (sensor → observation, the usual pipeline)

| Observation | Source | Grade | Notes |
|---|---|---|---|
| **Manoeuvre** by a tracked inspector | Space-Track GP history (`class/gp_history`, free account, login) | act | Δa / Δi / ΔRAAN between successive element sets beyond a drag-and-noise envelope (pure, tested). A dead feed → UNKNOWN. |
| **Co-planar with an asset of interest** | same + SGP4 | threat-tier (positioning) | inclination within 0.5°, RAAN within 2°, altitude within 50 km of a declared asset. This is May. |
| **Proximity** to an asset of interest | same + SGP4 (satellite.js) | act | min range over 48 h below 50 km = active; below 5 km = active, high confidence; sustained (>24 h inside 50 km) flagged `shadowing`. |
| **Reported counterspace act** | GDELT + own sources through a **space grammar** (phrases: "close approach", "inspector satellite", "co-orbital", "rendezvous and proximity", "shadowing a satellite", "anti-satellite test", "direct-ascent", "satellite jamming", "nuclear anti-satellite", the names Luch / Olymp / Nivelir / "Kosmos 2") graded by the shared `gradeModality` | act › threat › analysis | own-source-only caps at watching, as everywhere. |
| **Official record** | USSF / USSPACECOM / 18 SDS statements (RSS or capture), the SWF and CSIS annual counterspace reports | act (wire-grade) / baseline | An official statement confirms; the annual reports set the POSTURE baseline text per actor ("standing programme since …") so the tile can say what is old. |
| **EW against space systems** | GPSJam (already), DAIP GPS NOTAMs (already), reported SATCOM/Starlink jamming through the grammar | corroboration | feeds `pnt_denial` today; a jamming surge co-occurring with a proximity op raises confidence on the counterspace row, never its own level. |
| **Launch cadence** (existing) | LL2 | watching at most | refine: LL2 `mission.type` / orbit distinguishes military payloads; a Nivelir-class co-manifest is itself a signal with lag. |

**State ladder** (`counterspaceState`, pure, tested, same shape as
`cyberState`): dormant → watching (manoeuvre by the fleet, or co-planar
with an asset of interest, or a declared threat) → active (proximity < 50
km, or a reported act by a named tracking firm) → confirmed (active +
official statement or a second independent tracker). **Guard**: a
proximity read against a non-declared asset reads at most watching — an
undeclared target is not the user's concern until declared, and Starlink-
class traffic is noise by design (existing rule kept).

### 2.2 Declarations (Mission Profile `spectrum`, additive)

- `assetsOfInterest[]` — NORAD ids with a label and class (`isr-commercial`
  · `isr-government` · `satcom-mil` · `pnt` · `ew`), seeded with a curated
  list (ICEYE, Maxar WorldView/Legion, Planet SkySat, BlackSky, Capella,
  Umbra; WGS, MUOS, AEHF where public; GPS III) — editable inline on the
  SITREP Spectrum card like edge vendors.
- `inspectorFleet[]` — curated per actor (Russia: Kosmos 2542/2543, 2558,
  2576, the 2026 six incl. 2612; Luch/Olymp-K 1 & 2 at GEO; China: SJ-17,
  SJ-21, SY-7, TJS series), refreshed quarterly like `leverage.ts`, with
  `asOf` and a source. A generic actor has no fleet and no row.

### 2.3 Data access — the honest part

- **Space-Track** needs a free account (`SPACETRACK_USER` /
  `SPACETRACK_PASS` env; cookie login like ACLED; ≤30 req/min, ≤300/h).
  **Unreachable from the sandbox** (connect refused), reachability from
  GoDaddy unknown → `?diag=1` first, same as UKMTO. One daily pull of
  `gp_history` for ~40 inspector ids + ~40 asset ids = two requests.
- **CelesTrak** already refuses the host's address range (SOCRATES). A GP
  query by NORAD id is the fallback door via the **capture extension**
  (public JSON, no login) if Space-Track is also refused.
- **Propagation**: `satellite.js` 7.x — pure JS with an inlined single-file
  wasm, **no install script, no esbuild** (verified: scripts are build /
  lint / test only; `npm install` runs none). Prune pairs by regime first
  (co-planar and altitude bands) so the 48-h SGP4 sweep is a handful of
  pairs at 30-s steps, run in the daily heartbeat, never on a request.
- **Series**: `sensor_daily` keys `rpo:<actor>` (count of inspector
  manoeuvres that day, peak), `prox:<actor>` (min range to any asset of
  interest, km, LAST), registered in `sensorKeys`. The 90-day manoeuvre
  cadence is the baseline; `prox:` gives the distance trend sparkline.

### 2.4 Surfaces

- The actor's **I&W board**: the row, with drivers like "Kosmos 2612 within
  0.5 km of ICEYE-X36 (isr-commercial) for 2 d · LeoLabs · USSF statement".
- **SITREP Spectrum card** and the **Glance Spectrum tile**: "Counterspace:
  Russia active — 1 inspector within 5 km of a declared asset" (the tile's
  worst-of already spans PNT / cyber / space).
- **Country room › spectrum** (Russia, China): a **Posture card** — the
  standing programme line from the annual reports (posture), then what
  changed (warning), then the fleet table (last manoeuvre, nearest asset,
  range, trend).
- **Crisis map**: no ground point for an orbit; the `Launches` layer stays.
  An orbital plot is a separate pane if ever — not a map layer.
- **OE delta / attention gaps / alerts**: the row rides the existing
  `indicator_daily` and `computeAlerts` predicates (`iw-<problem>-
  counterspace-active|confirmed`).

## 3. Cyber posture — what is missing from `cyber_pressure`

The grammar exists (disruptive › espionage/pre-positioning › ransom › DDoS;
CISA advisories naming the state; IODA; ransomware.live). Two dimensions
are missing for POSTURE:

1. **Target.** Acts are attributed BY the actor; nothing records AGAINST
   whom. Pre-positioning in a host nation's grid (Volt-Typhoon-style) or
   DDoS campaigns against the AOI's hosts (NoName057 against Baltic /
   Nordic governments) is posture against *this* AOI; ransomware in Brazil
   is not. Add `against` to the cyber read (the economy board's
   `attribute()` already does BY/AGAINST for sanctions) using the AOI's
   country list + "U.S." + the declared edge vendors.
2. **Class weighting for preparation.** Pre-positioning and ICS/OT
   targeting advisories are *preparation of the battlefield* and should
   outweigh ransom and DDoS in the posture read; today the class order
   exists but the weights are flat-ish. A **posture read** line per actor
   (pure): `demonstration` (public, repeated, low-cost — DDoS, defacement),
   `preparation` (pre-positioning, ICS, wiper reports), `sustained pressure`
   (espionage at steady cadence) — derived from class mix × recency ×
   target, never from counts alone.

Add to the same Posture card as counterspace, so the country room answers
"how is Russia postured in space and cyber" on one screen.

## 4. "Ask the board" — questions over the app's own picture

### 4.1 What exists

The floating assistant (`/api/chat`) already carries an OE snapshot:
posture rows, SITREP LEDs, boards with level / anomaly / trajectory /
drivers, alerts, the delta, calls due — capped at `OE_CONTEXT_MAX_CHARS`
(~600–900 tokens). So "what should I worry about" is answered from the
app's own surfaces today. "What indicators show Russia positioning" gets
the board's three drivers and nothing deeper.

### 4.2 What the two example questions need that the snapshot lacks

- **Indicator-level evidence**: every indicator's state, `why`, provenance,
  falsifier, 14-day history, lead-indicator findings — not the top three
  drivers.
- **The other boards about the same actor**: the economic-warfare tile and
  coercion moves (Iran: shipping / sanctions instruments), chokepoint reads
  with UKMTO entries, posture moves (force movement), demand horizon and
  its verified skill, spectrum (PNT / cyber / counterspace), SITREP LEDs at
  hubs in the AOI.
- **The analyst's own record**: decision-log calls on that board and their
  hit rate; the user's docs / logs / saved items / threads naming the actor
  (FULLTEXT already exists).
- **Doctrine on probability.** The app's whole discipline is anomaly and
  trajectory, not likelihood; the board never emits a percentage because it
  cannot verify one. Left alone, a model asked "how likely" will invent a
  number with false precision.

### 4.3 Design: `POST /api/ask` + an "Ask the board" mode

1. **Entity resolution (pure)**: the question → actors / countries / AORs /
   straits / boards, through the name tools that exist
   (`validateActorName`, `normalizeCountryName`, chokepoint keywords, board
   labels). "Iran" → the CENTCOM board, the Iran economy tile, Hormuz,
   Gulf hubs. Unresolved → the assistant answers as today and says what it
   could not place.
2. **Evidence pack (server, bounded, `pending` pattern)**: assembled from
   caches the app already keeps — no new fetch, no model call — in a fixed
   order: board(s) in full → posture + chronicity → SITREP LEDs for AOI
   hubs → economy tile + moves → chokepoint reads → spectrum / counterspace
   → posture moves → demand + skill → alerts → delta → decision log + hit
   rate → own docs / threads (top 5 by FULLTEXT). Every section labelled
   with its surface and snapshot time; UNAVAILABLE stated. Capped ~20k
   tokens; sections truncate from the bottom.
3. **One model call** (Sonnet by default, Opus on request; on tap only;
   cached 15 min per normalised question × evidence fingerprint; logged as
   `ask` in the ledger) with a **fixed answer contract**:
   - **BLUF** in the board's own vocabulary: level, trajectory, learning
     flag, what changed since the user's last look.
   - **Evidence by indicator**, dated and sourced, strongest first; each
     line names the surface it came from (door-in link).
   - **What is NOT observed**: dormant indicators and dead sensors, stated
     as absence of signal, never as calm.
   - **What would change the call**: the falsifiers and the thresholds the
     next level needs.
   - **Confidence**: source independence, own-source-only caps, learning
     mode.
   - **On "how likely"**: no bare percentage. The answer gives the
     doctrinal framing (the board's level is the app's judgement; a
     likelihood is a human call) and, if the user insists on one, a
     **banded** judgement tied to named indicator states with its caveat —
     and offers **to log it as a decision-log call** with a horizon (7 / 14
     / 30 d), so the user's own forecast gets scored like the app's. That
     closes the loop the decision log was built for.
4. **UI**: the floating assistant gains an "Ask the board" toggle (and the
   palette entry "Ask the board: …"); a question that names an actor plus a
   warning verb (likely / indicators / positioning / preparing / escalate)
   routes there automatically with a note. The answer renders with surface
   chips that open the room / board / tile.

### 4.4 Cost and limits stated up front

~15–25k input tokens per ask (~$0.05–0.10 on Sonnet), on tap only, cached.
The pack is only as good as the sensors: a Russia question with no Russia
AOI board returns the posture rows and news, and says the board does not
exist — and offers to declare the AOI. It never fabricates an indicator.

## 5. Decisions needed

1. **Counterspace**: build the indicator with Space-Track as primary
   (needs a free account; `?diag=1` from production first) and the
   extension capture of CelesTrak GP as the fallback? Or news-grammar
   only for now (cheap, but it would have seen October and not May)?
2. **Assets of interest**: seed the curated commercial-ISR + MILSATCOM
   list, editable inline, or declare them yourself first?
3. **Ask the board**: Sonnet default with Opus on request? Auto-route
   warning-shaped questions, or only on the explicit toggle?
4. **Cyber posture**: the `against` dimension + posture read as part of
   the same pass, or a later step?

## 6. Build order (if all four yes)

A. Pure: space grammar, manoeuvre / co-planar / proximity maths over
   element sets, `counterspaceState`, cyber `against` + posture read,
   question entity resolver, evidence-pack renderer, answer contract —
   all tested.
B. Server: Space-Track login + GP history (diag), satellite.js sweep in
   the heartbeat, `rpo:` / `prox:` series, `/api/spectrum` additions,
   `/api/ask` with the bounded pack.
C. Surfaces: board row, Spectrum card + tile, country-room Posture card,
   assistant mode + palette entry.
D. Verify, document, commit.
