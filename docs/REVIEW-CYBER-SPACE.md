# Cyber and space threat warning — review and recommendations

**Ask (2026-09-30):** the tabs carry little space and cyber threat warning.
Examine every tab and find where cyber and space indicators could be
incorporated. Recommendations and mockups only — no code in this pass.

Mockup: `docs/mockups/cyber-space.html` → `docs/cyber-space.png` (desktop)
and `docs/cyber-space-phone.png`; standalone copy at `docs/cyber-space.html`.

## 1. What the app already has (the audit)

The two domains are not absent; they are scattered, unbaselined, and never
framed as *warning*. Every touchpoint found, by tab:

| Tab / surface | Space | Cyber |
|---|---|---|
| **Glance** status row | none | none |
| **OSINT › Watch › I&W** | `airspace_gps_disruption` on the hand-built CENTCOM board reads GPSJam; the **templated AOI boards read airspace only** — GPS was dropped in the template (a gap, not a decision) | none |
| **OSINT › Watch › SITREP** | GPS/RAIM via the force-protection axis; NOTAM `GPS_WAAS` plumbed but not surfaced | IODA internet connectivity → Infra LED → LIMFAC "C2 / Comms"; power/comms from news only |
| **OSINT › Watch › Crisis map** | GPS layer (GPSJam H3 cells); Overflight | none |
| **OSINT › Regional** | none in the dossier | none in the dossier |
| **OSINT › Feeds / Sources** | — | "Cyber-conflict" is a suggested Telegram source (CyberKnow); nothing reads it as a sensor |
| **Force posture** (`forceProtection`) | axis `gps` "GPS / Comms": GPSJam observed + RAIM NOTAMs, UNKNOWN discipline | none (the axis name says "Comms" but nothing cyber feeds it) |
| **Economy** actor board | `overflight` instrument | none — cyber is the one coercive instrument the grammar lacks |
| **Weather** | `SpaceWeatherCard`: NOAA SWPC Kp, G/R/S scales, X-ray flare — presented as a curiosity, with no ops impact, no forecast, and no path into any LED, board, alert or brief | — |
| **News** | `space` category (SpaceNews, NASASpaceflight) | no `cyber` category |
| **Alerts / push** | none | none |
| **Morning brief / OE brief / assistant context** | nothing unless an I&W board carries it | nothing |
| **Mission Profile** | no way to declare what the force depends on (polar/HF routes, SATCOM, edge vendors) | same |

Two structural findings fall out of the table:

1. **Space weather is the only space sensor that exists, and it is in the
   wrong frame.** Kp and flare class matter to a mobility crew as *HF on the
   polar route, GPS approach integrity, SATCOM scintillation over the Gulf at
   dusk, and radiation dose at altitude* — none of which the card says. It
   also matters to attribution: a G3 storm explains degraded GPS that would
   otherwise read as jamming.
2. **Cyber has no sensor at all**, and yet the app already holds the best
   proxy for a national-scale cyber event (IODA connectivity, wired to one
   base region) and the machinery to grade adversary action from text (the
   economic-warfare grammar). The gap is joining them, not finding data.

## 2. Doctrine frame (why these indicators and not others)

Same rules as the I&W board (`lib/warningTaxonomy.ts`): every indicator is
built from OPEN sources, carries a pre-registered falsifier, and is scored as
an anomaly against its own baseline. Colour is earned. Three domain-specific
disciplines are added:

- **Nature is not an adversary.** Space weather degrades the same systems an
  adversary would target, but it is *environment*, not warning. It never
  raises an I&W level. It sits on the SITREP and Weather surfaces as an
  ops-impact LED, and it appears on the warning side only as a **guard** —
  a PNT anomaly during a geomagnetic storm is attributed to the storm first.
- **Observed over reported.** GPSJam cells, IODA outage alerts, KEV entries,
  CelesTrak catalogue changes and CISA state-attributed advisories are
  observations or primary records. News about a cyberattack is graded text
  (act › threat › analysis) exactly as the economy grammar does, and
  own-source-only still caps at Watch.
- **Passive only.** Every source below is a published feed or a browser
  capture. Nothing here scans, probes, or touches a network the app does
  not own. That boundary is the feature.

## 3. Proposed indicator register

Ids are proposals. Weights follow the taxonomy's scale (0.5–0.9).

### 3.1 On every AOI I&W board (templated, like the six that exist)

| Id | What it observes | Sources | Baseline | Falsifier | Decision linkage |
|---|---|---|---|---|---|
| `pnt_denial` (space/EW) | GPS interference density inside the AOI bbox and at its hubs; GPS/WAAS system NOTAMs naming AOI FIRs; RAIM outages at AOI hubs | GPSJam daily CSV (have); DAIP `GPS_WAAS` (have, unsurfaced); RAIM NOTAMs (have) | AOI's own trailing 30-day elevated-cell count, stored per problem like `mobility_count` | Cell count within baseline for 5 consecutive days and no GPS/WAAS NOTAM over the AOI | GPS-approach and RNP planning, ILS alternates, EW awareness on the route; the divergence sensor's twin for the spectrum |
| `cyber_pressure` | (a) national connectivity outage alerts for AOI countries; (b) ransomware victims headquartered in AOI countries, and in transport/logistics/defense sectors globally; (c) graded cyber news attributed BY the AOI actor (act › threat › analysis, by/against); (d) CISA/JCDC advisories that name a state actor | IODA `/v2/outages/alerts` (keyless, contract family already pinned); ransomware.live API (keyless); GDELT actor query with a cyber vocabulary; CISA advisories RSS | Per-AOI trailing counts for (a) and (b); (c) and (d) are recency-relative like the escalation indicator | No outage alert, victims within baseline, no state-attributed advisory and no corroborated cyber act in 14 days | Reachback and unclass-network assumptions at the wing; host-nation airport/ATC IT dependence; fuel and ground-handling contractors (the Colonial Pipeline case) |
| `space_activity` (only when the AOI actor is a space power: China, Russia, Iran, North Korea) | Launches by the actor in the last 14 days vs its cadence; reentries; conjunction warnings involving U.S. payloads; launch-hazard NOTAMs/NAVAREAs closing airspace or sea lanes | CelesTrak SATCAT and last-30-days GP (keyless, daily); CelesTrak SOCRATES (keyless); Launch Library 2 upcoming launches with pad coordinates (keyless, rate-limited); DAIP TFR/ARTCC classes | Actor's own launch cadence, 90-day trailing | Launch count within cadence and no conjunction warning involving a U.S. asset in 14 days | SATCOM/ISR availability assumptions; hazard areas that close a route (a Jiuquan or Plesetsk window closes airspace the same way a TFR does) |

The existing `airspace_gps_disruption` keeps its id (history continuity)
but becomes airspace-only on the templated boards; the CENTCOM board's GPS
half moves to `pnt_denial`.

### 3.2 Wing-level, not per AOI (SITREP and Glance)

| Id | What it observes | Sources | Falsifier | Where |
|---|---|---|---|---|
| `spectrum_env` | Space-weather ops impact: HF absorption (R-scale, polar-cap absorption from S-scale), GPS integrity (G-scale, ionospheric scintillation band for equatorial bases at dusk), SATCOM, radiation at altitude for polar crews; 3-day outlook | NOAA SWPC `noaa-scales.json` (current + 3-day predicted), `alerts.json`, Kp, X-ray (have two of four) | Scales at R0/G0/S0 for the outlook window | SITREP "Spectrum" card; Weather tab (reframed card); Threat board row at R3/G3/S3+; alerts |
| `edge_exposure` | New Known-Exploited-Vulnerability entries for the **vendors the user declares** (the wing's edge devices and the products its host nation's airport runs) | CISA KEV JSON (keyless, daily) | No KEV entry for a declared vendor in 14 days | SITREP "Spectrum" card → LIMFAC C2/Comms driver; Glance tile |

`edge_exposure` is the one indicator that needs a declaration (§6). Without
a vendor list it reads UNKNOWN, never green — the same rule as expected
documents on the Family tab.

### 3.3 One new instrument on the Economy actor board

`⌁ cyber` joins the six instruments. Grammar classes: **disruptive** (wiper,
destructive attack, outage attributed), **ransom / criminal** (ransomware,
extortion, data theft against critical infrastructure), **espionage /
pre-positioning** (the Volt Typhoon pattern — CISA's own word), **DDoS /
hacktivist**. A CISA or JCDC advisory that names a state actor is a `by`
act with the standing of a Federal Register document; ransomware.live
victims in the target country are corroboration, never attribution.
Direction rules and own-source caps are unchanged.

## 4. Where it lands, tab by tab (the mockup)

1. **Glance** — one **Spectrum** tile in the status row (worst of PNT, cyber,
   space-weather ops impact; UNKNOWN is its own tone). Click → Watch › I&W.
   The OE delta and the morning brief pick the new indicators up with no
   change, because they read `warning_daily`.
2. **OSINT › Watch › I&W** — `pnt_denial` and `cyber_pressure` rows on every
   AOI card; `space_activity` on the boards whose actor launches. Drivers
   name the observation ("GPSJam 14 elevated cells vs 6 baseline · IODA
   outage alert Iran · CISA AA26-xxx names IRGC-affiliated actors").
3. **OSINT › Watch › SITREP** — a **Spectrum** card beside Infrastructure:
   PNT at the field (cell level, RAIM), HF/SATCOM (R/G/S with plain-language
   impact and the 3-day outlook), KEV hits on declared vendors. Its LED
   feeds LIMFAC "C2 / Comms" and the HTML export.
4. **OSINT › Watch › Crisis map** — two layers, off by default: **Outages**
   (IODA country-level events shaded at centroid) and **Launches** (pads
   with T-minus and hazard note). The GPS layer stays.
5. **OSINT › Regional** — a **Digital & spectrum** card in the dossier:
   connectivity (IODA), GPS interference cells in-country, ransomware
   victims 30 d, advisories naming the country, latest graded cyber news.
6. **Economy** — the `⌁ cyber` chip on actor tiles and rows on the coercion
   board; `cyber` as a lane on the timeline is not needed (it is an actor
   move like any other).
7. **Weather** — `SpaceWeatherCard` reframed as **Space weather → ops**: four
   impact rows (HF polar, GPS, SATCOM, radiation) with the 3-day outlook, and
   a Threat-board row when a scale reaches 3.
8. **News** — a `cyber` category with default sources (CISA advisories, The
   Record, BleepingComputer, Krebs). Feeds only; the sensor reads the
   advisories directly.
9. **Alerts / push** — four predicates, stable ids: SWPC G3/R3/S3+; IODA
   severe outage in a tracked country; `cyber_pressure` or `pnt_denial` at
   warning+; KEV entry for a declared vendor.
10. **Preferences → Mission Profile** — a **Spectrum dependencies** block:
    polar/HF routes (yes/no), SATCOM in use (free text, never sent to a
    model), edge-vendor watchlist. Three fields, all optional; absent means
    UNKNOWN on the surfaces that need them.

## 5. Sources (keyless status and confidence)

| Source | Domain | Access | Confidence the contract holds | Note |
|---|---|---|---|---|
| NOAA SWPC `noaa-scales.json`, `alerts.json`, Kp, GOES X-ray | space | keyless | high (two already in use) | 3-day predicted scales are in `noaa-scales.json` |
| GPSJam daily H3 CSV | space/EW | keyless | high (in use) | daily, prior-day |
| DAIP `GPS_WAAS`, RAIM, TFR classes | space/EW | DoD CA (have) | high (in use) | |
| CelesTrak SATCAT, GP last-30-days, SOCRATES | space | keyless, be polite (daily cache) | medium-high | Space-Track needs an account; not needed |
| Launch Library 2 (The Space Devs) | space | keyless, ~15 req/h | high | pads carry lat/lon |
| IODA `/v2/outages/alerts`, `/v2/outages/events` | cyber | keyless | medium-high (v2 signals endpoint pinned in prod) | epoch-seconds rule applies |
| CISA KEV JSON | cyber | keyless | high | daily |
| CISA cybersecurity advisories RSS | cyber | keyless | high | state attribution in titles |
| ransomware.live `/v2/recentvictims` | cyber | keyless | medium (API versions move) | verify with a `?diag=1` from prod, as with EU/UK |
| RIPEstat BGP updates | cyber | keyless | medium | optional, hijack/leak corroboration |
| Cloudflare Radar | cyber | API token | — | optional, later |
| NetBlocks, hacktivist Telegram | cyber | browser capture (have the tool) | — | own-source, caps at Watch |

None of these can be verified from the build sandbox (egress). Each new
fetcher gets a `?diag=1` like the EU/UK lists, and the first production run
pins the contract.

## 6. What it needs from you (declarations, all optional)

- Whether the wing flies **polar or HF-dependent routes** (drives HF/S-scale
  relevance; otherwise those rows read "not declared").
- The **edge vendors** whose devices sit on the wing's networks or at its
  host airports (drives KEV). Names only; never sent to a model.
- Whether the **China and Russia AOIs** should carry `space_activity`
  (yes if they are primary AOIs; it is learning-mode for ~90 days).

## 7. Build order (when cleared)

| Step | Effort | Reuses | New |
|---|---|---|---|
| A. `pnt_denial` + `cyber_pressure` on the AOI boards; restore GPS to the template | M | gpsjam, DAIP GPS_WAAS, IODA client, GDELT actor query, economy grammar, `warning_daily` | `lib/cyberSignals.ts` (pure grammar + state ladder, tested), IODA outage-alerts fetch, ransomware.live fetch, CISA advisories fetch, a `sensor_daily` numeric-baseline table (generalises `mobility_count`) |
| B. SITREP Spectrum card + Weather ops reframe + Threat-board row | S | SWPC route, LIMFAC C2/Comms | `lib/spaceWeatherOps.ts` (pure impact mapping, tested), 3-day scales fetch |
| C. Glance Spectrum tile + four alert predicates | S | StatusRow, `lib/alerts.ts` | — |
| D. Regional "Digital & spectrum" card | S | dossier assembler | per-country IODA + victims + advisories join |
| E. Economy `⌁ cyber` instrument + CISA advisories as `by` acts | M | economy grammar, actor register | cyber classes, advisory parser |
| F. `space_activity` + Crisis-map Outages and Launches layers | M | CelesTrak/LL2 fetchers, map layer pattern | `lib/spaceCatalog.ts` (pure cadence/conjunction maths, tested) |
| G. Mission Profile "Spectrum dependencies" + `edge_exposure` (KEV × vendors) | S | Mission Profile editor, KEV fetch | vendor watchlist field |
| H. Optional: Cloudflare Radar (token), NetBlocks capture | S | capture extension | — |

A–C deliver warning; D–F deliver the situation room and the coercion view;
G is the wing-specific half. No new npm dependency anywhere (every source is
JSON, CSV or RSS the app already knows how to read); `grep -c esbuild
package-lock.json` stays 0.

## 8. What not to do

- **No tenth tab.** Cyber and space are cross-cutting; a "Cyber" tab would
  be a wall of feeds nobody opens, the same failure the Watch pane fixed.
- **Do not let space weather raise an I&W level.** It is environment. It
  earns an LED and an alert, and it guards attribution of PNT anomalies.
- **Do not ingest the NVD firehose.** Thousands of CVEs a month say nothing
  about this wing. KEV × declared vendors is the whole exposure signal.
- **Do not score by mention count**, and do not let own-source cyber chatter
  (hacktivist Telegram) confirm anything alone. Same caps as everywhere.
- **Nothing active.** No port checks, no reachability probes against host
  nation networks, no "is the base online" pings. Published feeds and
  browser captures only.
- **Do not store anything per person.** Vendor names and route declarations
  are team config in the Mission Profile, and they never enter a prompt.
