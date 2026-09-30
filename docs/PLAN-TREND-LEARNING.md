# PLAN — Trend learning: record, baseline, verify

**Status:** proposed 2026-09-30 and **BUILT the same day, all six phases**
(commits "Trend learning A" … "F"). Companion to `docs/REVIEW.md` §3 (the
learning layer) and the four surfaces that shipped from it (chronicity,
reactivation, convergence, decision log). The CLAUDE.md section "Trend
learning (record → baseline → verify)" is the maintenance record; this
file is the design. Every series starts empty on deploy — see §9 for the
cold-start floors.

## 0. The finding, in one paragraph

The app writes eleven daily series and reads almost every one of them for
a single day: today against a trailing mean, or today against yesterday.
It also makes three forward claims every day (the 7-day demand horizon,
the TAF-derived weather axis, the I&W trajectory) and scores none of them.
Every item below has the same shape, **record → baseline → verify**, and
every one is a pure join over data the app already collects: no model
call, no new fetch, no new dependency. Thirteen opportunities were found;
this plan builds all of them in six phases, each of which ships on its
own.

## 1. What exists (the audit)

| Series | Written by | Read along the series? |
|---|---|---|
| `warning_daily` (raw score, anomaly, level, AOR mobility peak per board) | `warningAssess` | Trailing mean + 10-day anomaly trajectory. **Composite only** — indicator states are discarded daily. |
| `sensor_daily` (`pnt:`, `ransom:` per board) | `warningAssess` | Trailing mean only. Flat, not weekday-aware. |
| `force_posture_daily` | `forceProtection` | Chronicity (14 observed days) + OE delta. Good. |
| `sitrep_status_daily` (wx/ops/threat LED) | `sitrep` | 7-day strip + worse-than-yesterday. Infra and spectrum LEDs, flight category, NOTAM count **not recorded**. |
| `chokepoint_transits_daily` | `chokepointAis` | Classifies today vs a 30-day mean. No slope, no lead test. |
| `signal_daily_counts` (180 d) | six recorders | 7-vs-7 velocity only. No long-window highs, no pairs. |
| `surface_opens` | palette hooks | Palette rank boost only. |
| `warning_decisions` | analyst | Hit rate + per-indicator calibration. Good. |
| `household_bills` | Household digest | Cadence, creep, silence watch. Good. |
| `thread_sessions`/`threads` | Threads | Label trajectory sparkline. Good. |
| `crew_state` | crew | **Overwritten in place** — no history at all. |
| `sitrep_limfacs` | crew + auto | Timestamps present, never read as a series; auto LIMFACs not stored. |
| Demand horizon outlooks | `demandAssemble` | **Never recorded.** |
| TAF worst category | `sitrep` | **Never recorded**, so never verified. |
| Energy closes | `energyPrices` | 1-month series refetched; no own baseline. |
| Space weather, KEV, IODA | spectrum sources | Not recorded. |

The observed-days rule from `chronicity.ts` governs all of it: rows exist
only on days the app was opened (or, for I&W, polled by the capture
extension). Every ratio below is "of observed days", never of calendar
days.

## 2. Disciplines that hold across every phase

1. **Trend reads annotate; only the I&W engine sets a level.** The two
   exceptions that change scoring (the weekday-aware mobility baseline in
   Phase A and the transit lead-read in Phase C) are calibration rules in
   `warningRules.ts`, pure and tested, like every existing one.
2. **Learning floors before any claim.** Below `MIN_OBSERVED` a series
   says how little it has. Below `MIN_SCORED_FOR_RATE` (5, the decision
   log's floor) a verification shows a tally, never a percentage.
3. **A dead sensor writes nothing.** `recordSensorDay(key, day, null)` is
   a no-op. A missing day is a gap, not a zero.
4. **The day policy is explicit per key.** Counts and severities keep the
   day's PEAK (the `mobility_count` rule). States and prices keep the
   day's LAST value (crew availability at 0900 that changes by 1500 is
   not "the day's peak availability"). The store takes a `policy`
   argument; the caller never chooses by accident.
5. **Every trend row states its evidence and window** ("IFR 6 of 22
   observed days · Sep") — the rule from the watchlist recommendations.
6. **The app scores its own deterministic forecasts, never the analyst's
   calls.** "The app never scores for you" protects the decision log. The
   demand horizon and the TAF are the app's claims, and auto-scoring them
   is how it learns.
7. **Verification is three-valued.** Right / wrong / **ambiguous** when
   the proxy that would decide it was dead or absent. Ambiguous stays
   visible and is never counted either way.
8. **Privacy boundaries unchanged.** No email-derived terms enter any
   trend table. Attention gaps (Phase F) are per-user rows, read only for
   the user who made them.
9. **No model call, no new npm dependency, no cron.** Additive tables via
   `CREATE TABLE IF NOT EXISTS`; new columns via `COLUMN_MIGRATIONS`.
   `grep -c esbuild package-lock.json` stays `0`.

## 3. Phase A — Foundation: series maths, store v2, the heartbeat

Everything else reads through this, so it goes first.

### A1. `lib/series.ts` (PURE, tested)
Small numeric toolkit over `{ day, value }[]`, observed-days aware:
- `slope(series, window)` — least-squares over the last N observed points,
  null below 4 points.
- `runLength(series, predicate)` — consecutive observed days satisfying
  a predicate, from the newest back.
- `highWater(series, today, windowDays)` — is today's value the highest
  in the trailing window; returns the prior high and its day.
- `weekdayBaseline(series, today)` — mean of prior values on the same
  UTC weekday; null below 4 samples (four weeks of that weekday).
- `shareOfObserved(series, predicate, windowDays)` — "6 of 22 observed
  days", the chronicity ratio generalised.
- `precedes(leadSeries, eventDays, maxLagDays)` — for each event day,
  did the lead series cross its threshold within the prior lag window;
  returns hits / events / median lead days. Null below 3 events.
- `verdict(hits, total, minScored)` — tally below the floor, rate above.

### A2. `sensorStore.ts` v2
- `recordSensorDay(key, day, value, policy: "peak" | "last")` — `peak`
  keeps `GREATEST` (today's behaviour), `last` overwrites.
- `getSensorSeries(key, today, days)` — the raw `{ day, value }[]`,
  oldest first, for `lib/series.ts`.
- `getSensorBaseline` gains `{ weekday: true }` which returns the
  same-weekday mean when ≥4 samples exist and falls back to the flat mean
  (and says which it used) otherwise.
- Key namespace registered in one place (`lib/sensorKeys.ts`, pure):
  `mob:<icao>`, `tanker:<icao>`, `fc:<icao>`, `taf:<icao>`,
  `notam:<icao>`, `rwyclose:<icao>`, `xwind:<icao>`, `limfac:<icao>:<fn>`,
  `cpact:<chokepoint>`, `swx:G|R|S`, `kev:<vendor>`, `outage:<country>`,
  `px:<symbol>`. A key not in the register is refused — the namespace is
  the documentation.

### A3. Weekday-aware mobility surge (item 5)
`warningRules.mobilityObservedHigh` takes the weekday baseline when the
store has one for that board (`warningStore.getMobilityBaseline` gains the
same option). Rule unchanged otherwise (×1.4, floor mean+2, static 25
fallback). Provenance names which baseline was used ("vs Tuesday normal
18"). Test: a Monday count that is ×1.5 the flat mean but ×1.1 the Monday
mean is NOT a surge.

### A4. The daily heartbeat (`lib/dailyHeartbeat.ts`)
The capture extension already hits `/api/alerts/check` every 15 minutes
whether or not the dashboard is open, and that route already runs
`computeAlerts` → force protection + I&W (so `warning_daily` and
`force_posture_daily` accrue on unopened days). Demand horizon, SITREP,
crew, energy and spectrum do NOT run from it, so their series would have
gaps on every day the dashboard stays closed. `touchDailySeries()` is
called from the alerts route after `dispatchPush`, **once per 6 h per
process**, in the background, each gather bounded by `withTimeout` and
individually fail-safe: `getDemandHorizon()`, `sitrepSummary` for each
configured base, `listCrewRows()`, `getEnergyQuotes()`,
`getSpectrumSummary({ maxWaitMs })`. Every one is already cached and
deterministic — the heartbeat spends no model tokens and adds no fetch
that a page open would not make. The recorders below are called from
inside those assemblers, so the heartbeat needs no knowledge of what is
recorded.

**Effort:** one session. **Tests:** `series.test.ts` (every function on
synthetic series incl. gaps), `sensorStore` policy, weekday rule.

## 4. Phase B — Forecast verification

### B1. Demand horizon: record and score (item 1)
- Table `demand_horizon_daily (day, aor, direction, score, confidence,
  drivers JSON, PRIMARY KEY (day, aor))`, written at the end of
  `demandAssemble.assemble()` with the LAST policy (the day's final
  outlook is the forecast of record).
- `lib/demandVerify.ts` (PURE, tested): `observedDemand(aor, window)`
  builds the proxy for the 7 days AFTER the forecast day from series the
  app already keeps — mobility day-peak vs the board's baseline
  (`warning_daily.mobility_count` for boards in that AOR), posture
  escalations (`force_posture_daily` level-ups), new ordered departures
  (advisory pubDate inside the window), red near-base disasters. Proxy
  rose / held / fell by pre-registered thresholds. `scoreOutlook` →
  right / wrong / ambiguous; ambiguous whenever the mobility proxy was
  dead for >3 of the 7 days.
- Per-driver attribution: a right/wrong call credits every driver that
  was on the outlook, so after `MIN_SCORED_FOR_RATE` scored outlooks the
  app can say "disaster drivers 7/8, I&W drivers 3/7" — which sensor
  families predict demand. Reported like `calibrateIndicators`: proposals
  only, nothing re-weights itself.
- Surfaces: `DemandHorizonCard` footer "skill: 9 of 12 scored right
  (last 30 d) · ambiguous 2"; OE brief export gets the same line; the
  assistant's OE snapshot states skill when it has one.

### B2. TAF verification per base (item 2)
- At each SITREP assembly: `taf:<icao>` = worst forecast category
  ordinal (VFR 0 · MVFR 1 · IFR 2 · LIFR 3) for the next 18 h, PEAK;
  `fc:<icao>` = observed METAR category ordinal, PEAK. Both keyed to the
  UTC day.
- `lib/tafVerify.ts` (PURE, tested): over observed days where both exist,
  bucket forecast vs observed → over-forecast (TAF worse than observed),
  under-forecast (observed worse than TAF — the dangerous one), hit.
  Below 10 paired days: tally.
- Limitation stated on the card: verification is day-worst vs day-worst,
  and the observed side needs the app or the heartbeat to have run after
  the forecast hour. An under-forecast rate above 20% is surfaced on the
  Weather card and in `deriveMissionImpact` as a note on all-weather
  capability ("TAF under-forecasts here"), never as a capability change.

**Effort:** one session. **Depends on:** A1, A2, A4.

## 5. Phase C — I&W depth

### C1. Per-indicator daily history (item 3)
- Table `indicator_daily (problem_id, indicator_id, day, state, score,
  confidence, live TINYINT, PRIMARY KEY (problem_id, indicator_id, day))`
  written from `warningAssess` beside `recordWarningDay`, one row per
  `assessment.indicators[]`, LAST policy. `live` from `sensorHealth` so a
  dormant-because-dead day is distinguishable from dormant-because-quiet.
- `warningStore.getIndicatorHistory(problemId, days)`.
- `lib/leadIndicators.ts` (PURE, tested): for each board level-up in
  `warning_daily`, which indicators changed state upward in the prior
  `LEAD_WINDOW` (5 observed days) → per-indicator lead count and median
  lead days via `series.precedes`. Below 3 level-ups: tally.
- Surfaces: `WarningBoard` gets a 14-day state sparkline per indicator
  row (ordinal dormant<watching<active<confirmed, dead days hollow) and a
  run-length chip ("watching · 9 obs days"); a "Lead indicators" line
  under the drivers once earned; `DecisionLog` calibration reads it as
  corroboration, not as a re-weight.

### C2. Per-hub mobility counts (item 4)
- In `warningSensors` §3, beside the AOR total: `mob:<icao>` and
  `tanker:<icao>` per hub in `geo.hubs` (PEAK, null when the ADS-B feed
  was dead). AOR total keeps feeding the divergence indicator.
- Surfaces: the SITREP Ops card gets a "lift at this field" row when the
  base is a hub (today vs weekday normal, `series.highWater` over 30 d);
  Crisis-map hub popups get the same line; the divergence provenance
  names the hub that carries the surge.

### C3. Chokepoint transits: slope and the lead test (item 9)
- `cpact:<id>` = 1 on days the graded read holds a reported act (PEAK) —
  the act history that does not exist today.
- `ChokepointBoard` tile gets a 14-day transit sparkline
  (`getChokepointTransits` already reads 30 days) and a slope chip.
- `lib/chokepointLead.ts` (PURE): `series.precedes(transitSuppressed,
  actDays, 3)` → "suppressed transits preceded 4 of 5 acts, median lead
  1 d". Feeds `warningRules.chokepointState` only as CONFIDENCE (the
  rule already lifts one step on suppressed; this says how much to trust
  the lift), never as a state change.

**Effort:** two sessions. **Depends on:** A.

## 6. Phase D — Base and team tempo

### D1. Per-base operating tempo (item 7)
- `notam:<icao>` (active NOTAM count, PEAK), `rwyclose:<icao>` (1 when
  any runway-closure window occurred that day), `xwind:<icao>` (max
  crosswind kt, PEAK). `fc:<icao>` comes from B2.
- `sitrep_status_daily` gains nullable `infra` and `spectrum` columns via
  `COLUMN_MIGRATIONS` — the earlier "deliberately not recorded" decision
  is reversed here because the history strip can now show five LEDs
  without changing its width, and the OE delta already reads per-LED
  series.
- `lib/baseTempo.ts` (PURE, tested): month-over-month IFR days, NOTAM
  count slope (`series.slope` over 30 d), runway-closure share of
  observed days, crosswind days.
- Surfaces: SITREP history strip grows a "tempo" line ("IFR 6/22 obs
  days · NOTAMs rising · RWY closed 4/22"); Export HTML gets the same
  block; the Bases tile on Glance is unchanged (level, not trend).

### D2. Crew state history (item 6)
- Table `crew_state_daily (day, qual, total, crew_rest, on_mission,
  dnif, other, PRIMARY KEY (day, qual))`, LAST policy, written on every
  `upsertCrewRow` and by the heartbeat. Counts only, no names — same
  rule as the live table.
- `lib/crewTrend.ts` (PURE): availability series per qual and squadron-
  wide, `runLength` of weekly decline, and a join with
  `demand_horizon_daily`: "demand rose against thin crews 6 of the last
  30 observed days".
- Surfaces: the Crews strip in `DemandHorizonCard` gets a 30-day
  availability sparkline and the mismatch-history line;
  `CrewStateEditor` shows the series under the table; OE brief export.

### D3. LIMFAC recurrence and time-to-resolve (item 8)
- `limfac:<icao>:<fn>` = 1 on days the function reads PMC or NMC from
  `deriveMissionImpact` (auto or manual), PEAK — the auto LIMFACs finally
  have a memory without being stored as rows.
- `classifyChronicity` (already pure) runs over that series per
  function → CHRONIC / RECURRING / NEW chip on the capability matrix,
  same vocabulary as Force posture.
- `lib/limfacTrend.ts` (PURE): time-to-resolve from `created_at` →
  resolved `updated_at` over `listLimfacs(icao, true)`, median per
  capability; below 3 resolved: tally. Rendered under the LIMFAC
  register ("fuel LIMFACs resolve in ~4 d here").

**Effort:** two sessions. **Depends on:** A, B2 (for `fc:`), B1 (for the
crew×demand join).

## 7. Phase E — The wider series

### E1. Spectrum inputs (item 11)
- `swx:G`, `swx:R`, `swx:S` = the day's peak observed scale (from
  `getNoaaScales`, PEAK); `kev:<vendor>` = KEVs with `dateAdded` that day
  for each declared edge vendor (PEAK); `outage:<country>` = max IODA
  alert level for each tracked country (PEAK).
- Surfaces: the Glance Spectrum tile carries a trajectory glyph from
  `series.slope` on the driving series; `SpaceWeatherCard` gets "G≥1 on
  N of 30 observed days"; the SITREP Spectrum card shows KEV cadence per
  vendor vs its 90-day mean. The I&W space-weather guard is unchanged —
  environment still never raises a level.

### E2. Energy baseline and lag (item 12)
- `px:<symbol>` = close, LAST, for Brent/WTI/natgas/gold, written from
  `getEnergyQuotes()`.
- Corroboration line on the energy strip: "Brent +12% vs 90-day mean" —
  it stays corroboration on coercion-board rows, never attributed to an
  actor (REVIEW-ECONOMY rule).
- `series.precedes(cpact:hormuz | cpact:bab-el-mandeb, brentMove≥3%, 3)`
  on the economic timeline: "strait acts preceded 3 of 4 Brent moves".

### E3. Trend terms: long windows and pairs (item 10)
- `trends.termHighWater(term, 90)` over the existing table: today's 7-day
  sum vs the max prior 7-day sum in 90 days → "90-day high" chip on the
  Sources-pane trend list and one line in the brief prompt (capped at
  two terms so the brief does not become a chart).
- Table `signal_pair_daily (date, a, b, count, PRIMARY KEY (date, a, b))`,
  recorded beside `recordDailySignals` for `watch×topic` and
  `region×topic` pairs only (≤15 pairs per item, 90-day retention, same
  `signal_seen` dedupe). `newPairs()` (PURE): pairs seen ≥3 times this
  week and never in the prior 60 days → "Hormuz + tanker rising together
  for the first time in 60 d". Feeds `ConvergenceCard` as a new signal
  kind (`pair`), so a fresh co-occurrence counts as one distinct kind in
  a convergence row — it never inflates a row on its own.

**Effort:** one session. **Depends on:** A.

## 8. Phase F — Attention versus signal (item 13)

- `lib/attentionGaps.ts` (PURE, tested): joins `listOpens(email)` against
  the level series the OE delta already builds (`buildOeSeries`) —
  boards, posture entries, SITREP bases. A gap is a subject whose series
  WORSENED (level up or LED worse) within the last 14 observed days and
  whose last open by this user is older than that change, or absent.
  Improvements never produce a gap (they are openings, not omissions).
  Cap 3 rows, worst-first; a subject the user opened after the change
  drops out on its own.
- Surface: one muted line inside `OeDeltaCard`, per user ("Not looked at
  since it worsened: Iran board (3 d) · KADW (5 d)"), each a palette-style
  jump. Never a push notification, never in the OE brief export (it is
  about the reader, not the environment).

**Effort:** half a session. **Depends on:** nothing new — `surface_opens`
and `buildOeSeries` exist.

## 9. Build order and dependencies

```
A  foundation ─┬─ B  forecast verification ─┬─ D  base + team tempo
               ├─ C  I&W depth               │
               ├─ E  wider series            │
               └─ F  attention (any time)    │
```

Order as listed: **A → B → C → D → E → F**, about seven sessions. Each
phase ends with the standard loop (tsc → vitest → `node build.js` →
esbuild grep → CLAUDE.md note → commit → push both branches). A phase
that slips does not block the ones beside it except where marked.

Cold-start reality: every new series starts empty. Weekday baselines need
four weeks; verification needs `MIN_SCORED_FOR_RATE` scored outlooks;
lead-indicator reads need three level-ups. The surfaces show tallies and
"learning" until then — the same posture the I&W board took on day one.

## 10. Where it lands, by surface

| Surface | What it gains |
|---|---|
| Glance `DemandHorizonCard` | skill line, per-driver hit rates, Crews sparkline + mismatch history |
| Glance `OeDeltaCard` | attention gaps (per user) |
| Glance Spectrum tile | trajectory glyph |
| Watch › I&W `WarningBoard` | per-indicator sparklines, run-length, lead indicators |
| Watch › SITREP | tempo line on the history strip, lift-at-field row, LIMFAC chronicity + time-to-resolve, TAF skill note, KEV cadence |
| Economy `ChokepointBoard` | transit sparkline, slope, lead test |
| Economy energy strip / timeline | 90-day baseline line, strait→price lag |
| Weather `SpaceWeatherCard` | G-scale share of observed days |
| Sources pane trends | 90-day-high chips, new pairs |
| Convergence | `pair` signal kind |
| OE brief export / assistant OE snapshot | demand skill, crew history, base tempo |
| Preferences › Crew editor | availability series |

## 11. What not to do

- Do not let any trend read set an I&W level, a posture severity or a
  SITREP LED. Annotate, corroborate, calibrate — the engines decide.
- Do not auto-score the analyst's decision-log calls. The app scores its
  OWN forecasts only.
- Do not build a "Trends" tab. Every read lands on the surface that owns
  the subject; a separate analytics screen is where trend reads go to be
  ignored.
- Do not chart what has not earned a claim. A sparkline with three points
  is decoration; the floors above decide when a series is shown.
- Do not add a cron, a snapshot file in the repo, or a scheduled model
  call. The heartbeat rides the poll that already exists.
- Do not record email-derived terms, family data, or names anywhere in
  these tables.
- Do not average across calendar days. Observed days, always.
