# CLAUDE.md — 72-hour airfield ops timeline (portable feature spec)

Drop this file into another project (as `CLAUDE.md`, or reference it from one)
to build the **72-hour ops timeline**: an hour-by-hour picture of what cold,
rain, ice, wind and published closures will do to operations at an airfield,
with the **limiting windows** merged underneath and a **scrub cursor** that
reads every lane at any Zulu hour. It was built and verified in DEAD's
Dashboard (`lib/opsTimeline.ts`, `components/osint/OpsTimeline.tsx`,
`tests/opsTimeline.test.ts`); this file is self-contained so the feature can
be rebuilt in a different codebase without that repo.

The user it serves: a planner analysing the next 2–3 days at one or more
fields, asking "when is this field limited, by what, and for how long?" —
not "what is the weather".

---

## 1. Rules that are not negotiable

These are the decisions that make the picture trustworthy. Every one has a
test in §10. Do not relax them for a prettier chart.

1. **A forecast is AMBER at most. RED is for what is observed** (METAR,
   a warning in effect). The one exception is the crosswind lane, which keeps
   its own advisory bands (red ≥ 30 kt crosswind or ≥ 35 kt gust crosswind),
   because those bands mean the same thing forecast or observed.
2. **UNKNOWN is a value, never clear.** A lane with no input (no runway
   headings, no model profile) reads UNKNOWN with the reason, on the bar row
   AND in the scrub readout. Nothing missing is ever drawn as green or blank.
   No TAF and no model at all → the whole timeline is `live: false` with an
   UNKNOWN summary.
3. **The TAF governs its window.** Inside the TAF's validity, the TAF's
   weather and category win; the model fills ONLY beyond it. A base period
   prevails until the next base period starts (a BECMG transition followed by
   a gap is still that period's weather — never fall back to the model inside
   the TAF). TEMPO / PROB periods fold in as the worse of base and overlay and
   are drawn **dashed**.
4. **Model reads are dashed and labelled "(model)".** Beyond the TAF the Sky
   lane is **visibility only** ("IFR vis", "vis ok") — the model gives no
   ceiling, so a "VFR" there is never a ceiling claim.
5. **The timeline never moves a status light / overall level.** It is a
   planning picture beside the status, not an input to it.
6. **Thresholds are planning guidance**, not a de-ice policy, an AFI, or a
   flight manual. Say so in the key.
7. **Never guess.** A NOTAM schedule that cannot be read is a dashed UNKNOWN
   "SCHED" bar that joins no window. When the TAF and the model disagree
   (TAF freezing rain, model air +6 °C), say they disagree and plan on the
   TAF — never print "freezing rain at 6 °C".
8. **All times Zulu.** Local time is shown only beside Zulu, from the field's
   own IANA zone; with no zone, Zulu alone.

---

## 2. Inputs (data contract)

All inputs are optional except `nowMs`, `lat`, `lon`. Missing inputs make
lanes UNKNOWN, never green.

```ts
interface TimelineInputs {
  nowMs: number;                 // the axis starts at the hour containing now
  lat: number; lon: number;      // for the light shading (sun altitude)
  elevationM: number | null;     // field elevation (model icing AGL maths)
  hours: ProfileHour[] | null;   // hourly model profile, UTC, ≥ 72 h
  taf: TafPeriod[] | null;       // decoded TAF periods
  tafGroups?: TafIcingGroup[] | null; // military TAF 6-groups (optional)
  runways: { leIdent: string; heIdent: string; leHeadingDegT: number | null; heHeadingDegT: number | null }[];
  horizonH?: number;             // default 72
}

interface ProfileHour {
  t: number;                     // epoch ms, top of the UTC hour
  tempC2m: number | null; dewC?: number | null; feelsC?: number | null;
  freezingLevelM: number | null; // MSL
  weatherCode: number | null;    // WMO code
  precipMm: number | null; snowCm?: number | null;
  windDir: number | null; windKt: number | null; gustKt: number | null;
  visM?: number | null;
  levels: { hPa: number; heightM: number; tempC: number; rh: number }[]; // pressure-level profile (heightM = geopotential height, MSL)
}

interface TafPeriod {
  from: string; to: string;      // ISO, UTC
  changeType: string;            // "" | "FM" | "BECMG" | "TEMPO" | "PROB30" | "PROB40 TEMPO" …
  flightCategory: "VFR" | "MVFR" | "IFR" | "LIFR";
  windDir?: number | null; windVariable?: boolean; windSpeedKt?: number | null; windGustKt?: number | null;
  wxRaw?: string;                // e.g. "-FZRA BR", "TSRA", "-SHSN"
}

interface TafIcingGroup {        // U.S. military TAF 6IchhhT: Ic 1–3 light · 4–6 moderate · 7–9 severe
  intensity: "trace" | "light" | "moderate" | "severe";
  type: string | null;           // "rime in cloud", "clear in precipitation", "mixed"
  baseFtAgl: number; topFtAgl: number | null;
  fromMs: number; toMs: number;  // the TAF period the group is written in
  change: string;                // "" | FM | BECMG | TEMPO | PROB…
  code: string;                  // "640305"
}

interface ClosureLike {          // NOTAM closure / outage windows, already expanded
  fromMs: number; toMs: number;
  kind: "closure" | "unserviceable" | "limited";
  label: string;                 // "RWY 05/23", "TWY A", "ILS RWY 23"
  text: string;                  // the NOTAM text
  indeterminate?: boolean;       // a schedule was published but could not be read
}
```

**Where the data came from in the reference build (all keyless):**

- **Model profile**: Open-Meteo
  `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&hourly=temperature_2m,freezing_level_height,weather_code,precipitation,wind_direction_10m,wind_speed_10m,wind_gusts_10m,cloud_cover,visibility,precipitation_probability,dew_point_2m,apparent_temperature,snowfall,temperature_{p}hPa,relative_humidity_{p}hPa,geopotential_height_{p}hPa&wind_speed_unit=kn&timezone=GMT&forecast_days=4`
  for p in 1000, 975, 950, 925, 900, 850, 800, 700, 600. The response's top
  `elevation` is the grid elevation. Parse stamps as UTC (`timezone=GMT` returns
  zone-less ISO — append `Z`).
- **TAF**: NWS Aviation Weather Center `https://aviationweather.gov/api/data/taf?ids=ICAO&format=json`
  (decode `fcsts[]` → periods; category from ceiling/visibility). Military icing
  groups are read from the RAW TAF text (AWC's JSON drops them).
- **Runways**: OurAirports `runways.csv` (`le_ident`, `he_ident`,
  `le_heading_degT`, `he_heading_degT`, keep open runways).
- **Closures**: NOTAMs with item B/C (validity) and D (schedule). **A NOTAM's
  B)/C) bound the NOTICE, not the condition** — expand a published day/hour
  schedule ("SUN TUE WED 1400-1800", "DAILY 0600-0800") into one window per
  occurrence; an unreadable schedule → `indeterminate`.
- **Field zone** (for local time): Open-Meteo `timezone=auto` returns the IANA zone.

---

## 3. The hour read

For each hour `t` of the horizon (start = floor(now to the hour)):

1. **Prevailing TAF base**: sort non-overlay periods by start; extend each
   base's `to` to the next base's `from` (or to the TAF's overall end). The
   base covering the hour's midpoint is the latest-starting one covering it.
2. **Overlays** (TEMPO / PROB*) overlapping the hour: take the worse
   category, the worse weather (rank below) and the higher gust; mark the
   hour `overlay` (dashed).
3. **Beyond the TAF**: category = `visCategory(model.visM)` (< 1 mi LIFR,
   < 3 IFR, ≤ 5 MVFR, else VFR — visibility only), weather = `wxFromWmo(code)`.
4. **Wind**: the TAF's when it states one, else the model's (rounded kt).
5. **Temperature, dew point, feels-like, precip, snowfall** always come from
   the model (the TAF has none). Keep the source of each fact so the text can
   say "(TAF)" or "(model)".

**Weather vocabulary and rank** (worst wins):
thunder 10 › freezing rain 9 › freezing drizzle 8 › ice pellets 7 = hail 7 ›
snow 6 › heavy rain 5 › rain 4 = showers 4 › drizzle 3 › freezing fog 2 ›
fog 1 › none 0.

- From TAF codes: `TS`→thunder, `FZRA`, `FZDZ`, `FZFG`, `PL`/`GS`→pellets,
  `GR`→hail, `SN`/`SG`→snow (not `BLSN`/`DRSN`), `+RA`→heavy rain,
  `SHRA`→showers, `RA`, `DZ`, `FG`/`MIFG`/`BCFG`/`PRFG`→fog; `NSW`→none;
  strip a `VC` prefix.
- From WMO: 95→thunder, 96/99→hail, 66/67→fzra, 56/57→fzdz, 71–77/85/86→snow,
  65/82→heavy rain, 80/81→showers, 61–64→rain, 51–55→drizzle, 48→fzfog, 45→fog.

---

## 4. The lanes

Each lane turns an hour into a cell `{tone, label, detail, dashed, src}` or
nothing; consecutive identical cells merge into a segment. Tones:
`r` red · `a` amber · `i` note (sky blue) · `g` fine · `u` UNKNOWN.

| Lane | Cell rules (first match wins) |
|---|---|
| **Sky** | flight category. Tone LIFR/IFR `a`, MVFR `i`, VFR `g`. Inside the TAF: "IFR (TAF)" (dashed when from TEMPO/PROB). Beyond: "IFR vis" / "vis ok", dashed, detail "by model visibility (ceiling not modelled)". Bars coloured by category (VFR green, MVFR blue, IFR red, LIFR magenta). |
| **Precip** | the weather chip (FZRA, SN, PL, +RA, TS…). Amber for thunder, fzra, fzdz, pellets, hail, snow, heavy rain; note for the rest. Fog belongs to Sky / Ground ice, not here. Model mm/h appended. |
| **Temperature** | not a bar lane: an inline SVG — air temperature line, dotted dew point, the hours ≤ 0 °C shaded, a dashed 0 °C line, and ↓0° / ↑0° markers at each crossing (hour where it goes from > 0 to ≤ 0 and back). Label column shows min / max. |
| **Ground ice** | freezing rain/drizzle → amber **DE/ANTI-ICE** ("holdover times are short in freezing precipitation"; if TAF source and model air > 2 °C → "the TAF and the model disagree, plan on the TAF"). Snow / pellets at ≤ 2 °C → amber **DE-ICE**. Freezing fog, or fog at ≤ 0 °C → amber **FZFG**. Rain/drizzle/showers at ≤ 0 °C → amber **GLAZE** (cold-soaked surfaces); at ≤ 2 °C → note "near 0°". Nothing falling, air ≤ 0 °C, temp − dew ≤ 2 °C → note **FROST** (never a window). |
| **Runway** | fzra/fzdz → amber **ICE** "braking poor". Pellets → amber **PL**. Snow at ≤ 2 °C → amber **SNOW** with model cm/h. Heavy rain / thunder, or model ≥ 4 mm/h, with air > 0 °C → amber **WATER** "hydroplaning risk". Nothing falling, air ≤ 0 °C, and within the previous 12 h it was > 0 °C with ≥ 0.2 mm or rain → amber **REFREEZE** "black ice risk". |
| **Icing aloft** | a military TAF icing group covering the hour with base ≤ 10,000 ft AGL wins: moderate/severe amber, light note, label "MOD ICE", detail "moderate rime in cloud 3,000–8,000 ft AGL (TAF group 640305)". Else the model profile: a pressure level 0 to −20 °C inside 0–10,000 ft AGL is **possible** at RH ≥ 85 %, **likely** at RH ≥ 95 % and ≥ −15 °C; band = the levels that earn the label; likely within 12 h → amber, otherwise note; detail "(model, planning-grade — conducive, not reported)". |
| **Crosswind** | the **best runway end** for the wind (least crosswind among ends with a headwind; then least gust crosswind; then most headwind; if no end has a headwind, the least crosswind overall). Components: `head = cos(Δ)·kt`, `cross = |sin(Δ)·kt|`, gust cross likewise, Δ = wind dir − runway heading. Bands: red cross ≥ 30 or gust cross ≥ 35; amber ≥ 20 / ≥ 25. On a contaminated runway (the Runway lane is not fine that hour) a cross ≥ 15 or gust cross ≥ 20 is raised to amber ("usable crosswind is lower"). Skip light winds (cross < 10 and gust cross < 15). Variable wind → no cell (no direction, no component). No headings → lane UNKNOWN. Label "18G32 R05". Say TAILWIND when head < 0. |
| **Ramp / crew** | thunder/hail → amber **LIGHTNING** (ramp/refuel holds). Gust ≥ 35 kt → amber **G35** (door, stair, stand, refuel limits). Wind chill ≤ −27 °C → amber "WC −30°" (frostbite in ~30 min); ≤ −18 °C → note. Feels-like ≥ 40 °C → amber HEAT; ≥ 32 °C → note. Wind chill = NWS/MSC formula (below). |
| **NOTAMs** | each closure window inside the horizon: closure / unserviceable amber, limited note, indeterminate `u` dashed "SCHED". Label "RWY 05/23 CLSD" with a **short** label "CLSD" / "U/S" / "LTD" for narrow bars. |

```ts
// NWS / MSC wind chill (°C); valid ≤ 10 °C and ≥ 4.8 km/h.
function windChillC(tempC: number, windKt: number): number {
  const v = windKt * 1.852;
  if (tempC > 10 || v < 4.8) return tempC;
  const p = Math.pow(v, 0.16);
  return Math.round((13.12 + 0.6215 * tempC - 11.37 * p + 0.3965 * tempC * p) * 10) / 10;
}
```

**Light shading** under all lanes, per hour, from the sun's altitude at the
hour's midpoint: day > −0.833°, civil > −6°, nautical > −12°, else night.

```ts
// Low-precision solar altitude (degrees) — good to ~0.1°, plenty for shading.
function sunAltitude(ms: number, latDeg: number, lonDeg: number): number {
  const rad = Math.PI / 180, d = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = (gmst * 15 + lonDeg) * rad - ra;
  const lat = latDeg * rad;
  return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)) / rad;
}
```

---

## 5. Limiting windows

Every amber or red segment across all lanes (NOTAMs included) is a "hit".

1. Sort hits by start; merge into a window while a hit starts at or before
   the window's current end (overlapping OR touching).
2. **One factor per lane per window** — that lane's worst segment by: red
   first, then `labelSeverity`, then longest. Append the lane's own spans
   ("[Thu 15Z–Fri 11Z, Sat 01Z–13Z]") only when they are not the whole window.
3. `labelSeverity` (freezing beats frozen beats wet; LIFR beats IFR):
   9 = ICE, DE/ANTI-ICE, LIFR, SEV ICE · 8 = PL, GLAZE, LIGHTNING, MOD ICE ·
   7 = SNOW, DE-ICE, IFR, LIFR VIS · 6 = REFREEZE, FZFG, IFR VIS, ICE likely,
   HEAT…, WC… · 5 = WATER, gusts (G…) · else 0. Match labels **exactly** —
   "ICE likely" must not match "ICE".
4. Order factors by what limits first: NOTAMs › Runway › Ground ice › Sky ›
   Crosswind › Icing aloft › Ramp › Precip. Drop Precip when any other factor
   explains the window (it repeats them).
5. Window tone = red if any factor is red, else amber.
6. Text: `"Thu 26 09Z–Fri 27 15Z — Runway: freezing rain (TAF) — ice on the
   runway, braking poor [Thu 15Z–Fri 11Z]; Ground ice: …"`. Range labels name
   the second day only when the window crosses midnight Zulu.

Summary line: "Next 72 h: N limiting windows — first <range>: <top 3 labels>",
or "no limiting window — …" naming what was checked and whether the model
answered.

---

## 6. Output

```ts
interface TlSeg { fromMs: number; toMs: number; tone: "r"|"a"|"i"|"g"|"u"; label: string; short?: string; detail: string; dashed?: boolean; src: "taf"|"model"|"mixed"; cat?: "VFR"|"MVFR"|"IFR"|"LIFR" }
interface TlLane { key: "sky"|"precip"|"deice"|"runway"|"icing"|"xwind"|"ramp"|"notam"; title: string; segs: TlSeg[]; unknown: string | null }
interface LimitWindow { fromMs: number; toMs: number; tone: "a"|"r"; factors: { lane: string; label: string; detail: string }[]; text: string }
interface OpsTimeline {
  live: boolean; startMs: number; hours: number; tafEndMs: number | null;
  light: { fromMs: number; toMs: number; state: "day"|"civil"|"nautical"|"night" }[];
  lanes: TlLane[];
  temps: { t: number; c: number|null; dew: number|null; feels: number|null; fzlFtAgl: number|null }[];
  temp: { minC: number|null; maxC: number|null; crossings: { t: number; dir: "down"|"up" }[] };
  windows: LimitWindow[]; summary: string; reason: string | null;
}
```

Keep the builder **pure** (no fetch, no clock reads except `nowMs`, no
storage) so it runs on the server and the client and is unit-testable. Fold
the NOTAM lane in with a separate pure step
(`windowsWithNotams(timeline, closures) → { lane, windows }`) so the closures
can be computed wherever the NOTAMs live.

---

## 7. The scrub cursor and hour readout

**The interaction the user asked for: "as I move my mouse or finger along the
timeline I want to see the Zulu time as I scrub through looking for issues."**

- A transparent layer over the lane tracks (not the label column) takes
  pointer events. Mouse move → cursor follows. Finger: pointerdown/move set the
  cursor; the layer has `touch-action: pan-y` so a vertical swipe still
  scrolls the page while a horizontal drag scrubs.
- The cursor is a 1-px hairline across every lane with a **flag above the
  axis**: `Fri 27 · 0515Z` (monospace, bold) and the field's local time beside
  it (`0615 CET`). Keep the flag inside the track at the edges
  (`translateX(0)` under 10 %, `-100%` over 90 %, else `-50%`).
- **Click / tap pins** the cursor (2-px, accent colour, flag recoloured);
  click again to release. A pinned mouse cursor ignores moves.
- **Keyboard** (the section is focusable): ← / → one hour; Shift + ← / →
  jump to the next / previous **change point** (every segment edge in any
  lane + every 0 °C crossing); Esc clears.
- **The readout sits under the lanes, not on the cursor** — a finger never
  covers it, and because it carries the words, a phone can fit all 72 h to
  its width (no sideways scroll). It shows:
  - the stamp `Fri 27 Nov · 0515Z` (large monospace);
  - local time · "in 17 h" / "3 h ago" · "the TAF governs this hour" or
    "beyond the TAF — model, planning-grade" · "pinned";
  - a pill: "Inside limiting window 1 · clears Fri 27 · 2100Z (16 h left)" or
    "Outside any window · next opens Sat 28 · 0100Z (in 9 h)";
  - one row per lane in display order (Sky, Precip, Temp, Ground ice, Runway,
    Icing aloft, Crosswind, Ramp / crew, NOTAMs) with that hour's sentence,
    coloured by tone. Temp row: "−1 °C · dew −2 · feels −7 · 0 °C at 1,800 ft
    AGL (model)". Nothing there → "nothing limiting" (muted); NOTAM lane →
    "no closure in effect"; UNKNOWN there → "UNKNOWN — <reason>" (italic).
    A lane UNKNOWN only beyond the TAF still reads inside it.
- The limiting window under the cursor is highlighted across all lanes.
  Clicking a window in the list highlights it and pins the cursor at its start.
- A green **now** line marks the present.
- Bars are not individually clickable (the readout replaces that). Bar labels
  are fitted to real pixels (ResizeObserver on the track): the full label if
  it fits (~5.4 px per character at 8 px type + 6), else `short`, else none.
  On a narrow track keep only the day names and 12Z on the axis.

Pure helper for the readout (testable, no DOM):

```ts
sliceAt(timeline, extraLanes /* [notamLane] */, windows, ms) → {
  ms, stamp, src: "taf"|"model",
  rows: { key, title, tone: "r"|"a"|"i"|"g"|"u"|"n", label, text }[],
  window: { index, tone, toMs, leftMs } | null,
  next: { index, fromMs, inMs } | null,
} | null   // null when the timeline is not live; ms clamps into the horizon
changePoints(timeline, extraLanes) → number[]  // sorted, inside the horizon
```

---

## 8. Layout and visual language

- Card titled "NEXT 72 H — OPS TIMELINE", a muted sub-line "all times Z ·
  model planning-grade · the TAF governs its window", a **key ▾** fold
  explaining colours, dashing, shading and thresholds, and the summary line in
  amber when there are windows.
- Rows: a ~86 px right-aligned label column, then the track. Lane rows 22 px;
  temperature row ~46 px. Axis on top: day names (bold) at 00Z, 6-hourly
  "06Z / 12Z / 18Z" ticks, a dashed "TAF ends" marker.
- Under all lanes: night / nautical / civil shading (indigo, deepest at
  night), faint 6-h gridlines, brighter day lines.
- Bars: 3-px radius, 1-px border, translucent fill; amber, red, sky-blue note,
  faint green fine, transparent dashed grey UNKNOWN. Dashed border = model or
  TEMPO/PROB.
- Below: the readout, then "LIMITING WINDOWS" — one row each: tone dot, Zulu
  range, duration, factor chips; expand to the factor sentences.
- Dark theme in the reference build (slate background, slate-100 text);
  keep the colour **meanings** whatever the theme.

**Placement that worked:** directly under the narrative assessment (the "what")
so the timeline gives the "when" on the first screen, ahead of the detailed
capability tables. A compact **72-h band** (5-px track, amber/red stretches,
faint 24/48-h ticks, windows in the tooltip, dashed when UNKNOWN) on every
airfield card/row lets the user compare fields without opening each.

---

## 9. Adapting it to a detailed mission planning app

The reference build anchors the axis on "now". A mission planner will want
more; these fit the same pure core:

- **Anchor on the mission, not the clock**: let `startMs` be the planned
  window (e.g. ETD − 12 h) and `horizonH` cover the sortie and its recovery.
  Keep the rules — the TAF still governs only its own validity.
- **Mission events on the axis**: ETD, ETA, refuel, hot-pit, crew show as
  labelled vertical markers through every lane; a readout row "Mission:
  0300Z ETD OJAQ" when the cursor is on one. A marker that falls inside a
  limiting window should say so ("ETD inside window 1 — runway ICE").
- **Several fields, one cursor**: departure, en-route alternates and
  destination stacked as separate timelines on a **shared axis with a
  synchronised cursor**, each readout showing the field's hour at the same
  Zulu instant (and the planned event times offset by the route).
- **Per-airframe thresholds**: crosswind, gust and contamination limits are
  inputs (the reference uses generic advisory bands). Keep them labelled as
  planning values unless they come from the user's own data.
- **Export**: the same pure output renders to a static, script-free HTML
  block (inline SVG temperature line, absolutely-positioned bars, the window
  list) for a briefing packet; escape every string — NOTAM and model text are
  external content.

---

## 10. Tests to write first

1. Weather words: "-FZRA BR"→fzra, "TSRA"→thunder, "+RA"→heavy rain,
   "BLSN"→none, "NSW"→none; WMO 67→fzra, 73→snow, 95→thunder.
2. Wind chill: (−20 °C, 25 kt) < −30; warm or calm air unchanged.
3. Freezing rain in the TAF → Precip, Ground ice and Runway amber; one window
   with factors ordered Runway › Ground ice › Sky.
4. **Nothing outside the crosswind lane is ever red**, even with a model hour
   of thunder, −30 °C, 55-kt gusts and 30 mm.
5. The TAF governs: model rain inside a dry TAF hour draws nothing; a BECMG
   gap is the prior period's weather.
6. Frost is a note and never a window; refreeze after rain then ≤ 0 °C.
7. Snow cm and standing water; glaze vs "near 0°".
8. Crosswind: contamination raises to amber; no runway headings → UNKNOWN.
9. Icing: a TAF group wins over the model; model "likely" amber only ≤ 12 h.
10. Sky beyond the TAF is "vis" only; no TAF + no model → `live: false`.
11. Windows merge overlapping/touching hits; one factor per lane; worst by
    `labelSeverity` ("ICE likely" ≠ "ICE").
12. NOTAM closure leads its window; an indeterminate schedule joins none;
    short label "CLSD".
13. TAF freezing rain over +6 °C model air says the sources disagree.
14. `sliceAt`: rows in display order, window + time to clear, next window,
    UNKNOWN said as UNKNOWN, clamps into the horizon, null when not live.
15. `changePoints`: every edge and crossing, sorted, inside the horizon.
16. Export: no `<script`, markup in a NOTAM escaped.

Verify in a real browser too: mouse scrub, a finger tap/drag at 390 px width,
keyboard stepping, and no horizontal page overflow.

## Overlap rules (learned in production, 2026-11-26)
- A lane can hold overlapping bars (NOTAMs). Pack them into rows (≤3) with a
  greedy interval packer; never draw two bars on one row. The readout lists
  every bar in effect at the cursor, one line each, worst first.
- Parking / apron / hardstand / shelter closures are a capacity note, never a
  limiting factor — otherwise a multi-day shelter NOTAM becomes a multi-day
  limiting window and the band stops being read.
- Never repeat a NOTAM's text in its own label; strip the NOTAM number from
  any label built from the text.
- Markers that sit closer than a label's width merge into one (±0°).
- Labels on the axis hide under the scrub cursor's flag.
- A band bounded by one level reads "near N ft", never "N–N ft".
