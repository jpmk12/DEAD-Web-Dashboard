# Cloning the Base SITREP feature

A standalone guide to lifting the per-airfield **commander's situation
report** out of DEAD's Dashboard and standing it up in another Node.js /
Next.js application. It is written for someone who has never opened this
repository: everything the feature needs — sources, contracts, tables,
routes, pure logic, UI, and the disciplines that make its colours
trustworthy — is described here, with the file paths to copy.

Where this guide says "copy", the file is self-contained enough to move with
its imports resolved; where it says "port", the shape is described so you can
rewrite it against your own framework. Line counts are given so you can
budget the work (about 4,800 lines in total, roughly half of it pure logic
with unit tests).

---

## 1. What the feature is

For one to four configured airfields (ICAO codes), the SITREP answers, on one
pane, the questions a mobility squadron commander asks every morning:

| Card | Question | Answered from |
|---|---|---|
| **Status strip** | Four LEDs: Weather · Ops · Threats · Infrastructure. Green / amber / red / **UNKNOWN**. | Everything below, rolled up by pure functions |
| **Mission impact** | Is the airfield FMC / PMC / NMC? What is the LIMFAC? What are the CCIRs? What does leadership need to decide? | Derived from the assembled signals plus commander-entered LIMFACs |
| **Commander's Read** | A three-bullet BLUF, watch items, asks. | One small model call over the assembled payload, with a deterministic fallback |
| **Weather** | METAR now, TAF as a 24-hour category bar, NWS alerts, feels-like / humidity / gusts, 3-day outlook, sunrise / sunset / moon | NWS Aviation Weather Center, NWS alerts, Open-Meteo, in-house astronomy |
| **Ops** | Active NOTAMs grouped by runway / navaid / hours / airspace / bird; field-closed detection; a 48-hour closure timeline with weather-conflict call-outs; runway crosswinds; runway capability (C-17 / C-130 / light); center (ARTCC) enroute NOTAMs; system fuel NOTAMs | DoD DAIP NOTAM service, OurAirports runways, the METAR wind |
| **Threats** | Force-protection composite and axes, disasters within 500 km, local news filtered to an impact vocabulary | Your own force-protection assessor, GDACS / USGS / ReliefWeb, GDELT |
| **Infrastructure** | Internet connectivity, FAA NAS programs nearby, USGS gauge stages, power / comms reporting from news | IODA, FAA NAS status, USGS water services, GDELT |
| **History** | Last seven days of LEDs and "worse than yesterday" markers | A small daily table |
| **Multi-base tiles** | One tile per base with its four LEDs and the driving line, for a strip and for the morning brief | A deterministic per-base summary over the same payload |
| **Export** | A single self-contained HTML file — no JavaScript, no external resources — that prints and travels by e-mail | A pure string renderer over the payload |

The design rule that makes it useful rather than decorative: **colour is
earned, and UNKNOWN is not clear.** A source that could not be reached
renders as UNKNOWN with the reason, never as an implied green. Every rule
that turns data into a colour lives in a pure, unit-tested function, and the
only model call in the feature is the Commander's Read, which reads the
already-assembled payload and falls back to a deterministic read when the
model is off or fails.

---

## 2. Architecture in one picture

```
  Preferences (sitrep_bases JSON)            ┐
       │  GET/POST /api/sitrep/bases         │ configuration
       ▼                                     ┘
  lib/sitrep.ts  assembleSitrep(base)        ┐
       │  one Promise.all over ~12 sources   │ server-only assembler
       │  10-minute cache per base           │ (never throws; every source
       │  writes today's LEDs to history     │  degrades to UNKNOWN)
       ▼                                     ┘
  SitrepPayload  ───────────────┬───────────────┬──────────────────┐
       │                        │               │                  │
  lib/limfac.ts            sitrepSummary()   /api/sitrep/read   lib/sitrepExport.ts
  deriveMissionImpact      (tiles, brief)    (Commander's Read) renderSitrepHtml
       │                                          │
       └──── merged into payload.mission ─────────┘
                        │
  components/osint/SitrepPanel.tsx  +  SitrepMissionImpact.tsx
```

Three layers, each with a strict responsibility:

1. **Fetchers** (server-only, `lib/*.ts` marked so): talk to a source, apply a
   timeout, return `{ live, configured, ... }` and never throw.
2. **Pure logic** (client-safe, no imports of `node:*`, `fetch` or the DB):
   parse, classify, roll up. Unit-tested against captured fixtures.
3. **Assembler + routes**: compose fetchers, run the pure logic, cache,
   persist history, serve JSON.

The pure layer is what you should port most faithfully. The fetchers you
will likely rewrite for your own timeout / caching conventions.

---

## 3. Sources and the contract facts you will not find in their docs

All keyless and HTTPS unless noted. Each was pinned from a live capture; the
non-obvious facts are the ones that cost a day the first time.

| Source | Endpoint | Used for | Contract facts |
|---|---|---|---|
| **NWS Aviation Weather Center** | `https://aviationweather.gov/api/data/metar?ids=KWRI&format=json` and `/taf?ids=…&format=json` | METAR (flight category, wind incl. direction), TAF periods | `format=json` gives structured wind direction (raw text did not). The batch endpoint accepts at most **12 ICAOs** per call. Flight category derived from ceiling + visibility: VFR / MVFR / IFR / LIFR. |
| **NWS alerts** | `https://api.weather.gov/alerts/active?point=lat,lon` | Point alerts at the base | Needs a `User-Agent`. Severity vocabulary is Extreme / Severe / Moderate / Minor; keep it separate from your own green-amber-red. |
| **Open-Meteo** | `https://api.open-meteo.com/v1/forecast?latitude=&longitude=&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=3&timezone=auto` plus the current-conditions variables | 3-day outlook, feels-like / humidity / gusts, global fallback when NWS has nothing (OCONUS) | Worldwide, no key. |
| **DoD DAIP NOTAMs** | `POST https://www.daip.jcs.mil/daip/mobile/query` with JSON body `{ "type": "LOCATION", "locations": ["KWRI"] }` | Per-base NOTAMs. Same endpoint with `type: "FIR_ARTCC"` and `locations: ["ZNY"]` for center NOTAMs; `type: "FUEL_NOTAMS"` for system fuel NOTAMs; `type: "GPS_WAAS"` for GPS/RAIM. | **Every query class goes through this one endpoint**; only `type` differs and every response has the same envelope: `{ group: [ { name, notams: [ { code, name, list: [ { idshow, text, rawtext, alertType } ] } ] } ] }`. The mobile SPA's `nfir` / `artcc` URLs are HTML fragments, not data — `GET …/nfir` 404s. `rawtext` is canonical ICAO format (carries the `B)` / `C)` validity times and `E)` body). **List items carry no lat/long.** The TLS chain is DoD-signed: you must trust the **DoD root CA bundle** for the request (bundle it in the repo; the system CA store will not verify it). If the bundle is missing, report `configured:false` — that is UNKNOWN, not "no NOTAMs". |
| **OurAirports** | `https://davidmegginson.github.io/ourairports-data/airports.csv` and `…/runways.csv` | ICAO → name / coords / country for the base picker; longest open runway + surface; per-runway-end true headings for crosswinds | Plain CSV, ~5,000 large/medium fields after filtering. Cache 24 h. Runway classing is planning-grade: C-17 ≥ 7,000 ft hard, C-130 ≥ 3,500 ft, else light. |
| **GDELT DOC 2.0** | `https://api.gdeltproject.org/api/v2/doc/doc?query=…&mode=artlist&format=json&timespan=…` | Local news around the base, then filtered by an impact vocabulary | **One request per 5 seconds** or you get 429. Do not add a second GDELT call per base — the infrastructure card reuses the local-news result. |
| **IODA** (Georgia Tech) | `https://api.ioda.inetintel.cc.gatech.edu/v2/entities/query?entityType=region&search=New%20Jersey` then `/v2/signals/raw/{entityType}/{code}?from=&until=` | Internet connectivity degradation | **`from` / `until` must be epoch seconds** — relative strings like `now-1d` are silently zeroed. Skip the model series (`*-sarima`, `*-norm`); use the raw sources (bgp, ping-slash24, merit-nt, gtr). US bases resolve to the state region parsed from `base.place`; elsewhere to the country. |
| **FAA NAS status** | `https://nasstatus.faa.gov/api/airport-status-information` (XML) | Ground stops, ground delays, closures, arrival/departure delays nationally; "nearby" = within 250 km | One national fetch cached 5 minutes and shared across bases. Regex-parsed by `Delay_type` sections. FAA uses 3-letter LIDs — map to ICAO with a `K` prefix for the distance lookup. US only; report `nas: null` OCONUS. |
| **USGS water services** | `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=…&parameterCd=00065&siteStatus=active` | Gauge stage levels near the base (informational) | `-999999` is the no-data sentinel → null. Flood POSTURE comes from NWS alerts, not from this. |
| **Disasters** | GDACS RSS, USGS earthquake GeoJSON, ReliefWeb API | Events within 500 km | Any global disaster feed you already have. |
| **Force protection** | your own assessor | Threat LED and the axes | The SITREP passes one location and reads the composite + per-axis severities. If you have no assessor, render the Threats card as UNKNOWN. |

The only non-HTTPS dependency is your database. Nothing here needs an API
key except the model call, which is optional.

---

## 4. File inventory

Sizes are lines in this repository. "Pure" means client-safe, dependency-free
and covered by unit tests; port those first and keep them pure.

### Pure logic (port faithfully)

| File | Lines | What it holds |
|---|---|---|
| `lib/sitrepSignals.ts` | 496 | NOTAM grouping + limiting/field-closed detection; the `IMPACT_TERMS` news filter; `tafTimeline` (24-hour category bar, TEMPO/PROB folded by worst); runway wind components + crosswind flags; **closure windows** (`parseNotamSchedule`, `scheduleOccurrences`, `closureWindows`, `windowConflicts`); the LED rollups `wxLed` / `opsLed` / `threatLed`. |
| `lib/infraSignals.ts` | 254 | Parsers for IODA entities and signals, USGS gauges, the FAA NAS XML; `internetLed`, `nasLed`, `splitInfraNews`, `infraLed`. |
| `lib/limfac.ts` | 346 | `deriveMissionImpact` (seven airfield functions → FMC/PMC/NMC/UNKNOWN, the LIMFAC register, CCIR flags) and `fallbackCommanderRead` (the deterministic BLUF). |
| `lib/astro.ts` | 101 | NOAA-equation sun times (civil dawn/dusk, sunrise/sunset) and synodic moon illumination. Minute precision; polar day/night returns null rather than a fake time. |
| `lib/sitrepExport.ts` | 343 | `renderSitrepHtml(payload, read)` — the zero-JS standalone HTML, every dynamic string escaped. |
| `lib/metar.ts` (decoders) | — | `decodeMetar` / `decodeTaf` over the AWC JSON. Any METAR/TAF decoder will do if it yields flight category, wind dir/speed/gust, and TAF periods with from/to and category. |

### Server fetchers (rewrite to your conventions)

| File | Lines | What it holds |
|---|---|---|
| `lib/notams.ts` | 302 | The DAIP door: DoD CA bundle loading, `fetchDaipQuery(payload)` (raw `https.request` with the CA trusted per request), `parseDaipNotams`, NOTAM categorisation, `B)`/`C)` time parsing, `notamTimeState`. |
| `lib/airspace.ts` | 217 | `getCenterNotams(artcc)`, `getFuelNotams()`, a 10-minute in-process cache keyed by `type:loc` (load-bearing for politeness — the map layer fans out one call per FIR). |
| `lib/aviationWx.ts` | 116 | `getFlightCategories(icaos)` (chunked to 12), `getTafOutlook(icaos, horizonH)`, `CAT_RANK`. |
| `lib/ourAirports.ts` | 225 | Lazy 24-hour CSV loads, `airportByIdent`, `airfieldCapabilities`, `airfieldRunways`. |
| `lib/resolveAirfield.ts` | 43 | ICAO → `{ icao, label, lat, lon, country, place }` via curated lists then OurAirports. |
| `lib/infra.ts` | 202 | `getInfraSources(base)` → IODA + USGS + FAA NAS, each `withTimeout`, each fail-safe. |
| `lib/sitrepHistory.ts` | 72 | `recordSitrepDay` (upsert keeping the WORST LED per axis per UTC day), `getSitrepHistory(icao, 7)`. |
| `lib/limfacStore.ts` | 115 | CRUD over `sitrep_limfacs`. |
| `lib/sitrep.ts` | 392 | **The assembler** — `assembleSitrep(base)`, `sitrepSummary(payload)`, `resetSitrepCache()`. |

### Routes

| Route | Lines | Contract |
|---|---|---|
| `app/api/sitrep/bases/route.ts` | 62 | `GET` → `{ bases }`. `POST { op: "add", icao, artcc? }` / `{ op: "remove", icao }` / `{ op: "artcc", icao, artcc }` → `{ bases }`. Max 4 bases. Add resolves the ICAO server-side. |
| `app/api/sitrep/route.ts` | — | `GET ?icao=` → the full `SitrepPayload` for one configured base. |
| `app/api/sitrep/summary/route.ts` | 38 | `GET` → `{ bases: SitrepSummary[] }` for every configured base; a failed assembly becomes an all-UNKNOWN stub, never a missing tile. |
| `app/api/sitrep/read/route.ts` | 167 | `POST { icao }` → `{ bluf[3], watch[≤3], asks[≤3], ai, cached? }`. 15-minute cache per base + status fingerprint. Model bounded by a hard deadline; deterministic fallback on any failure. |
| `app/api/sitrep/limfac/route.ts` | 88 | `GET ?icao=` → `{ limfacs }`. `POST { icao, fn, capability, driver, impact, mitigation?, ask?, ccir?, fromISO?, toISO? }` creates; `POST { op: "status", id, status }` / `{ op: "extend", id }` updates; `DELETE ?id=`. Every write calls `resetSitrepCache()`. |
| `app/api/sitrep/infra-diag/route.ts` | 72 | Owner-only. Runs the real IODA / NAS / USGS fetches and returns status + snippet per source, so a blank card shows its cause. |

### UI

| File | Lines | What it holds |
|---|---|---|
| `components/osint/SitrepPanel.tsx` | 895 | Base tiles (click selects, double-click removes), add-base input (`KWRI ZNY` sets the center in one line), status strip, the mission block, Weather / Ops / Threats / Infrastructure cards, history strip, closure timeline, "Save to Docs", "Export HTML". |
| `components/osint/SitrepMissionImpact.tsx` | 227 | MC state → CCIR → Commander's Read → capability matrix → LIMFAC register with add / resolve form. |

### Tests and fixtures

`tests/sitrepSignals.test.ts`, `tests/infraSignals.test.ts`,
`tests/limfac.test.ts`, `tests/astro.test.ts`, `tests/sitrepExport.test.ts`,
`tests/notams.test.ts`, and `tests/fixtures/daip/*.json` (real captured DAIP
responses). Bring the fixtures — they are the only executable record of the
DAIP contract.

---

## 5. Data model

Three pieces of persisted state. All DDL is `CREATE TABLE IF NOT EXISTS` run
at first connection; there is no migration tool.

```sql
-- Configuration: the bases, stored on the shared preferences row as JSON.
-- Managed ONLY through /api/sitrep/bases so a general preferences save can
-- never wipe it (the preferences POST preserves this column when absent).
ALTER TABLE user_prefs ADD COLUMN sitrep_bases JSON NULL;
-- element shape:
-- { "icao": "KWRI", "label": "Joint Base McGuire-Dix-Lakehurst",
--   "lat": 40.0155, "lon": -74.5917, "country": "United States",
--   "place": "New Jersey", "artcc": "ZNY" }

-- Daily history: the WORST LED per axis per UTC day, written lazily by the
-- assembler on every run (fire-and-forget). Only days the app was opened exist.
CREATE TABLE IF NOT EXISTS sitrep_status_daily (
  day     VARCHAR(10) NOT NULL,   -- YYYY-MM-DD UTC
  icao    VARCHAR(4)  NOT NULL,
  wx      VARCHAR(1)  NOT NULL,   -- g | a | r | u
  ops     VARCHAR(1)  NOT NULL,
  threat  VARCHAR(1)  NOT NULL,
  PRIMARY KEY (day, icao)
) ENGINE=InnoDB;

-- Commander-entered LIMFACs: shared per airfield, attributed by e-mail.
-- Auto-derived LIMFACs are NOT stored (recomputed on every assembly).
CREATE TABLE IF NOT EXISTS sitrep_limfacs (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  icao        VARCHAR(4)   NOT NULL,
  fn          VARCHAR(32)  NOT NULL,   -- launch_recovery | all_weather | throughput | fuel | arff | c2_comms | force_protection
  capability  VARCHAR(8)   NOT NULL,   -- fmc | pmc | nmc | unknown
  driver      VARCHAR(300) NOT NULL,
  impact      VARCHAR(500) NOT NULL,
  mitigation  VARCHAR(500) NULL,
  ask         VARCHAR(500) NULL,
  ccir        TINYINT(1)   NOT NULL DEFAULT 0,
  from_iso    VARCHAR(32)  NULL,
  to_iso      VARCHAR(32)  NULL,
  status      VARCHAR(12)  NOT NULL DEFAULT 'new',  -- new | ongoing | improving | worsening | resolved
  entered_by  VARCHAR(255) NULL,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  INDEX idx_limfac_icao (icao, status)
) ENGINE=InnoDB;
```

Everything else (the assembled payload, the Commander's Read, the DAIP and
CSV fetches) lives in in-process caches with TTLs: 10 minutes per base for the
payload, 15 minutes for the read, 10 minutes for DAIP center/fuel queries,
5 minutes for the national NAS fetch, 24 hours for the OurAirports CSVs.

---

## 6. The payload

`SitrepPayload` is the one shape every consumer reads. Reproduce it exactly
and the UI, export, summary and read port without change.

```ts
interface SitrepPayload {
  base: SitrepBase;
  generatedAt: string;                                   // ISO
  status: { wx: Led; ops: Led; threat: Led; infra: Led }; // Led = "g" | "a" | "r" | "u"
  weather: {
    live: boolean;                    // AWC reachable
    now: AviationWx | null;           // flightCategory, windKt, gustKt, visMi, ceilingFt
    metarRaw: string | null;
    tafWorst: { worst: FlightCategory; fromISO: string } | null;
    tafSegments: TafSegment[];        // the 24-hour bar
    alerts: { event; severity; lifeThreatening; headline }[];
    current: CurrentConditions | null; // Open-Meteo feels-like etc.
    outlook: { date; hiF; loF; precipPct; windMph }[];  // 3 days
    windDirDeg: number | null; windVariable: boolean;
  };
  astro: AstroData;                   // civilDawnZ, sunriseZ, sunsetZ, civilDuskZ, moon { illumPct, phaseName }
  ops: {
    configured: boolean;              // DoD CA present
    live: boolean;                    // DAIP answered
    notamCount: number;
    groups: NotamGroup[];             // runway | navaid | hours | airspace | bird | other, each item { text, amber, start?, end? }
    limiting: boolean; fieldClosed: boolean;
    capability: { lengthFt; surface; cls: "C-17" | "C-130" | "light" } | null;
    center: { code; live; count; items: { text; amber }[] } | null;
    runwayWinds: { ident; headingDegT; headKt; crossKt; gustCrossKt; flag: "g" | "a" | "r" }[];
    fuel: { live: boolean; items: string[] } | null;
  };
  history: { day; wx; ops; threat }[];   // ≤7, oldest first, today included
  infra: {
    internet: { live; entity: string | null; led: Led; series: { label; dropPct }[] };
    water: { live; gauges: [...] } | null;
    nas: { live; counts: { groundStops; groundDelays; closures }; nearby: { airport; km; kind; reason; detail? }[] } | null;
    powerNews: NewsHit[]; waterNews: NewsHit[]; commsNews: NewsHit[];
  };
  threats: {
    fp: { composite: "green" | "amber" | "red" | "unknown"; topDriver: string; axes: { key; severity; summary }[] } | null;
    disasters: { title; type; severity; km }[];   // ≤5 within 500 km
    news: NewsHit[];                                // impact-filtered, ≤6
    newsScanned: number;
  };
  mission: {
    state: "fmc" | "pmc" | "nmc" | "unknown";
    functions: { key; label; capability; driver; window; limfacIds; derived? }[];
    limfacs: { id; fn; fnLabel; capability; source: "auto" | "manual"; status; driver; impact; mitigation?; ask?; ccir; window }[];
    ccir: { key; text }[];
  };
}
```

`SitrepSummary` (for tiles and the morning brief) is `{ icao, label, status,
driver, line, worse }` — `driver` is the worst axis speaking for itself,
`line` is a one-to-two-sentence deterministic read, `worse` lists axes worse
than the previous OBSERVED day.

---

## 7. The rules that make the colours trustworthy

These are the parts to port most carefully. Each one exists because its
absence produced a wrong colour that a commander would have acted on.

1. **UNKNOWN ≠ clear.** `opsLed` returns `u` when DAIP is unconfigured or
   unreachable; `wxLed` returns `u` when there is neither METAR nor TAF nor
   alerts; `threatLed` returns `u` when the assessor is absent. The tile,
   the brief line, the export and the read all print "UNKNOWN" and the
   reason. A dead feed never becomes green by default.

2. **A NOTAM's `B)`/`C)` times bound how long the NOTICE is valid, not when
   the condition is in effect.** Construction closures routinely read
   "SUN TUE WED 1400-1800, MON 1400-1700" inside a two-month validity span.
   `parseNotamSchedule` / `scheduleOccurrences` expand the published
   day/hour schedule into one bar PER OCCURRENCE; no occurrence inside the
   48-hour horizon means NO bar (the NOTAM still shows in the text list).
   Painting the validity span instead drew a solid 48-hour CLOSED bar and,
   through the mission-impact derivation, a permanent single-runway PMC and a
   CCIR for two months. When day tokens are present but the times do not
   parse, the window is flagged `indeterminate`, renders as a dashed
   "SCHED — see NOTAM" outline, and is excluded from weather-conflict checks.

3. **Only field-closed and the NAVAID × forecast-IFR fusion auto-produce
   NMC.** Everything else caps at PMC. A dead feed makes the function
   UNKNOWN, never FMC. The derivation is deliberately conservative because
   the mission block is what gets briefed up the chain.

4. **The history compares against the previous OBSERVED day.** The daily
   table is written only on days the app ran, so "worse than yesterday" must
   look at the previous row, not the previous calendar date, or a weekend
   gap reads as a recovery.

5. **The worst LED of the day is what history keeps.** A base amber at 0900Z
   stays amber for that day even if the 1500Z refresh is green
   (`recordSitrepDay` upserts with a per-axis max).

6. **Power and comms have no sensor.** They are derived from the impact-
   filtered local news by `splitInfraNews`. News can raise the
   infrastructure LED to amber, never red; with no sensor reporting, the LED
   is UNKNOWN even if news exists.

7. **RED on internet connectivity needs corroboration.** Two IODA sources
   ≥ 80 % drop, or one ≥ 95 %; a single source ≥ 50 % is amber.

8. **The Commander's Read never blanks.** AI off, no key, model timeout,
   unparseable JSON — every path returns `fallbackCommanderRead(mission)`
   with `ai: false` and a `reason`. The model is given the payload lines
   with UNKNOWN marked as such and is told to say "unknown", never to
   assume clear or FMC.

9. **Everything in the export is escaped.** NOTAM text and news headlines
   are external content. `renderSitrepHtml` runs every dynamic string
   through `esc()`; the tests assert no `<script` and no `http` `src`/`href`
   survive. The file carries a "SNAPSHOT AS OF …Z — NOT LIVE" stamp.

10. **Crosswind chips are advisory.** Amber at ≥ 20 kt cross or ≥ 25 kt gust
    cross, red at ≥ 30; variable wind produces no rows. Never labelled as
    limits.

11. **Runway capability is planning-grade.** The thresholds (7,000 ft hard
    for a C-17, 3,500 ft for a C-130) are advisory and say so on the card;
    they are not assault minimums.

---

## 8. Porting steps

Work in this order; each step is testable on its own.

1. **Database.** Add the `sitrep_bases` column and the two tables (§5).
   Decide where your "configured bases" live if you have no preferences
   row — a one-row settings table is enough.

2. **Base picker.** Port `resolveAirfield` over the OurAirports `airports.csv`
   (or your own airfield list) and the `/api/sitrep/bases` route. You can now
   add `KWRI` and get back `{ icao, label, lat, lon, country, place }`.

3. **Weather leg.** Port `aviationWx.ts` (+ your METAR/TAF decoder),
   `tafTimeline`, `wxLed`, the NWS alert aggregation, the Open-Meteo outlook
   and `astro.ts`. Run the tests. The Weather card and the weather LED now
   work with nothing else.

4. **NOTAM leg.** Bundle the DoD root CA (copy `lib/certs/dodCa.ts`). Port `notams.ts` (the raw
   `https.request` with `ca` set per request; `fetchDaipQuery`;
   `parseDaipNotams`), then `groupNotams`, the closure-window functions and
   `opsLed`. Test against the captured fixtures BEFORE touching the network.
   Then `airspace.ts` for center and fuel NOTAMs. If you are outside a
   network that can reach DAIP, the card must show UNKNOWN with
   "DAIP unreachable", not empty.

5. **Runways.** Port `airfieldRunways` / `airfieldCapabilities` over
   `runways.csv` and `runwayWinds`.

6. **Threats leg.** Wire your force-protection assessor (or return `fp: null`
   → UNKNOWN), your disaster feed filtered to 500 km, and GDELT local news
   through `filterImpactNews`.

7. **Infrastructure leg.** Port `infraSignals.ts` (pure) and `infra.ts`. Add
   the owner-only diag route first — it is how you will find out that IODA
   wants epoch seconds.

8. **Assembler.** Port `assembleSitrep` as one `Promise.all` with every
   source `.catch`-ed to its UNKNOWN shape, a 10-minute cache keyed by
   `icao|artcc`, `recordSitrepDay` fire-and-forget, and `payload.mission =
   deriveMissionImpact(payload, manualLimfacs)` after the payload exists.

9. **Mission layer.** Port `limfac.ts`, `limfacStore.ts`, the LIMFAC route.
   Every LIMFAC write resets the assembler cache.

10. **Summary + read.** `sitrepSummary` and the summary route (tiles, brief).
    The read route with `claude-haiku-4-5`, `max_tokens: 500`,
    `maxRetries: 0`, a 12-second SDK timeout and a 14-second hard deadline —
    it must return inside your gateway's timeout with the fallback if needed.

11. **UI.** Port the two components or rebuild against the payload. Keep
    the base tiles double-click-to-remove, the inline ARTCC setter and the
    "assembly failed — UNKNOWN" stub tile.

12. **Export.** Port `renderSitrepHtml` and its tests last; it only reads
    the payload.

---

## 9. Configuration and environment

| Item | Where | Notes |
|---|---|---|
| DoD root CA bundle | `lib/certs/dodCa.ts` (the PEM as an exported string), loaded by `dodCaBundle()`; operator override via env `DOD_CA_PEM` (inline PEM) or `DOD_CA_PATH` (file) | Without it, DAIP is `configured:false` → Ops UNKNOWN. Never disable TLS verification instead. |
| `ANTHROPIC_API_KEY` | env | Optional. Absent → the Commander's Read is the deterministic fallback with `ai:false`. |
| Database credentials | env (`DB_HOST` … `DB_PASSWORD`) | mysql2, parameterised queries, short-lived connections. |
| Feature gate for the read | your AI-controls preference | The read checks it and falls back when off. |
| Outbound network | HTTPS 443 to the hosts in §3 | `www.daip.jcs.mil` needs the DoD chain; everything else uses public CAs. |

Timeouts used in this repository: 10 s per weather/NWS/Open-Meteo call, 12 s
for DAIP, 8–10 s for IODA / NAS / USGS, 12 s + 14 s deadline for the model.
The assembler never awaits anything unbounded.

---

## 10. Pitfalls, in the order people hit them

- **DAIP over a corporate or cloud egress proxy.** Many proxies cannot
  verify the DoD chain and the request dies at the TLS handshake with no
  useful error. Probe from outside the proxy first (this repo carries a
  PowerShell probe, `daip-probe.ps1`). In the app, that failure must render
  as UNKNOWN.
- **A 502 from the read route.** A single non-streaming model call that
  outlasts the platform gateway's timeout surfaces as an HTML 502 the client
  cannot parse. Bound the model call hard and return the fallback.
- **AWC's 12-ICAO batch cap.** Chunk. The error is a silent empty array.
- **`format=json` on the METAR endpoint.** The raw-text endpoint gives no
  structured wind direction; you need it for crosswinds.
- **GDELT rate limit.** One call per 5 s. If you add a second GDELT query per
  base (for infrastructure, for a different vocabulary) the first one starts
  429-ing.
- **IODA relative times.** `from=now-1d` is accepted and silently becomes
  `from=0`. Send epoch seconds.
- **NOTAM validity vs schedule.** See §7 rule 2. The real NOTAM that taught
  this is in the fixtures (`A0467/26`).
- **Hidden-mount Leaflet / React.** Not SITREP-specific, but if you mount
  the pane hidden, dispatch a `resize` when it is revealed.
- **The base list being wiped by a preferences save.** Keep the bases in
  their own column and make the general preferences write preserve it when
  the field is absent from the payload.
- **Caching an empty read.** Do not cache a fallback read as if it were the
  model's; the fingerprint cache only stores `ai:true` results.

---

## 11. What the feature deliberately does not do

- It does not poll on a schedule. Assembly is lazy on request and cached
  10 minutes; the tiles poll every 5 minutes only while the page is open.
- It does not store auto-derived LIMFACs; only the commander's entries are
  persisted.
- It does not expose a live public link. A tokenised read-only viewer was
  designed and declined because it punches through the auth wall; the
  export is a static snapshot by design.
- It does not send the payload to a model except for the Commander's Read,
  and never sends crew names or anything personal — the payload contains
  only airfield, weather, NOTAM, threat and infrastructure data.
