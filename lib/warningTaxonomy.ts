// Warning-problem taxonomy — PURE DATA (the §9.5 provenance register lives here).
//
// Discipline (§6.1): every indicator is sourced from OPEN doctrine / open
// think-tank frameworks (ISW, CSIS, RAND, Grabo) — the structure of the board is
// deliberately public, never a mirror of any high-side problem set. Each
// indicator carries its open provenance so the taxonomy is defensible, and a
// pre-registered falsifier so it's a warning indicator, not a vibe.
//
// Sensors named in `sourceFeed` all already exist in this repo — this problem
// plugs live feeds into the pure engine (lib/warning.ts) with zero new deps.

import type { IndicatorDef, WarningProblemDef } from "./warning";
import { countryCentroid } from "./countryCentroids";
import { spacePowersIn } from "./spaceCatalog";
import { firsForCountry } from "./firData";
import { CHOKEPOINTS } from "./chokepoints";
import { ALL_AIRFIELDS } from "./airfields";

// ── Spectrum indicators (docs/REVIEW-CYBER-SPACE.md §3.1) ───────────────────
// The same three on every board, parameterised by the AOI's name; the space
// indicator exists only where the AOI's actor launches (China, Russia, Iran,
// North Korea) — a launch by anyone else is not warning for a mobility force.
// Space weather is deliberately NOT here: it is environment, and it GUARDS the
// PNT attribution (lib/spectrumRules.pntState) rather than raising a level.
export const PNT_ID = "pnt_denial";
export const CYBER_ID = "cyber_pressure";
export const SPACE_ID = "space_activity";

export function spectrumIndicators(problemId: string, aoiName: string, spacePowers: string[]): IndicatorDef[] {
  const out: IndicatorDef[] = [
    {
      id: PNT_ID, warningProblem: problemId,
      description: `GPS / PNT denial over ${aoiName}: interference-cell density inside the AOI versus its own baseline, hubs sitting inside an elevated cell, GPS/WAAS system NOTAMs and RAIM outages. Guarded by space weather — a G3+ storm is attributed first.`,
      sourceFeed: "gpsjam (ADS-B-derived H3 cells, daily) + DAIP GPS_WAAS NOTAMs + RAIM NOTAMs at hubs; NOAA SWPC G-scale as the attribution guard",
      weight: 0.6,
      falsifier: "Elevated-cell count within the AOI's own baseline for 5 consecutive days, no hub inside an elevated cell, and no GPS/WAAS NOTAM over the AOI.",
      provenance: "Open GPS-interference observation (gpsjam.org); DAIP/NOTAM open data; NOAA SWPC scales. Grabo 'electronic warfare / spectrum' indicator class.",
    },
    {
      id: CYBER_ID, warningProblem: problemId,
      description: `Cyber pressure by the ${aoiName} actor: CISA/JCDC advisories naming the state actor, graded cyber acts attributed BY the actor (disruptive › espionage/pre-positioning › ransom › DDoS; act › threat › analysis), national connectivity outage alerts in AOI countries, ransomware victims in-country or in transport/logistics/defence versus baseline.`,
      sourceFeed: "CISA advisories RSS + GDELT DOC actor query with the cyber grammar (corroborated by your X / newsletters / captured articles / OSINT feeds; own-source only caps at watch) + IODA outage alerts + ransomware.live",
      weight: 0.6,
      falsifier: "No state-attributed advisory, no corroborated cyber act BY the actor, no country-level outage alert and victims within baseline for 14 days.",
      provenance: "CISA/JCDC public advisories; IODA (Georgia Tech) open connectivity measurement; open ransomware tracking; CSIS/Atlantic Council cyber-statecraft reporting.",
    },
  ];
  if (spacePowers.length) {
    out.push({
      id: SPACE_ID, warningProblem: problemId,
      description: `Space activity by the ${aoiName} actor (${spacePowers.join("/")}): launches in the last 14 days against the actor's own 90-day cadence, and close conjunctions involving a U.S. military payload. Launch-hazard airspace closures arrive through the airspace indicator.`,
      sourceFeed: "Launch Library 2 (The Space Devs; provider country + pad) + CelesTrak SOCRATES conjunctions",
      weight: 0.45,
      falsifier: "Launch count within the actor's own cadence and no close conjunction involving a U.S. military payload in 14 days.",
      provenance: "Open launch and catalogue data (The Space Devs, CelesTrak); Secure World Foundation counterspace reporting.",
    });
  }
  return out;
}

// ── CENTCOM · Iran escalation ────────────────────────────────────────────────
// Thresholds are ANOMALY (delta-from-baseline) deltas, tuned conservative so the
// board is calm at rest and color is earned. Tune with real baseline history.
export const CENTCOM_IRAN: WarningProblemDef = {
  id: "centcom_iran",
  label: "CENTCOM · Iran escalation",
  scenario:
    "Escalation of Iran–US/partner hostilities toward sustained kinetic conflict or regional war affecting the Gulf, its airspace, and the Strait of Hormuz.",
  decisionLinkage:
    "A threshold crossing informs three decisions before the planning cycle: (1) force-protection posture at Gulf bases; " +
    "(2) NEO readiness / spin-up for Gulf embassy posts; (3) tanker & strategic-airlift surge and Strait-of-Hormuz routing.",
  thresholds: { watch: 0.15, warning: 0.35, alert: 0.6 },
  indicators: [
    {
      id: "conflict_intensity_gulf",
      warningProblem: "centcom_iran",
      description:
        "In-theater conflict-event intensity (strikes, battles, remote violence) across Iran and the Gulf littoral versus its trailing baseline.",
      sourceFeed: "conflictEvents (UCDP GED / ACLED / ReliefWeb)",
      weight: 0.9,
      falsifier:
        "30-day in-theater event count returns to within 1σ of its trailing-90-day baseline for two consecutive weeks.",
      provenance: "ISW Iran Updates event methodology; UCDP GED event-intensity framing.",
    },
    {
      id: "escalatory_strike_signal",
      warningProblem: "centcom_iran",
      description:
        "Escalatory strike / rhetoric news signal — airstrike, missile, invasion, mobilization phrasing geolocated to the CENTCOM AOR, corroborated across sources.",
      sourceFeed: "GDELT DOC, corroborated by your imported X + newsletters + OSINT feeds (own-source only caps at watch)",
      weight: 0.6,
      falsifier: "No escalation-phrase reporting corroborated by ≥2 independent sources in a rolling 72h window.",
      provenance: "CSIS/ISW open reporting cadence; Grabo 'communications & rhetoric' indicator class.",
    },
    {
      id: "mobility_divergence",
      warningProblem: "centcom_iran",
      description:
        "Airlift/tanker mobility posture toward the AOR versus implied demand — the divergence sensor. Off-diagonal is the product: demand with no lift = early-warning window; lift with no public trigger = anomaly.",
      sourceFeed: "aircraftMil (keyless ADS-B, mobility/tanker filter) × implied-demand map",
      weight: 0.8,
      falsifier:
        "Mil mobility (C-17/C-5/KC-*) density within 600 km of AOR hubs stays at or below baseline for 5 consecutive days while implied demand is elevated.",
      provenance: "Open mobility-posture-as-warning doctrine (RAND airlift-readiness studies); author domain expertise.",
    },
    {
      id: "neo_departure_posture",
      warningProblem: "centcom_iran",
      description:
        "State Department ordered/authorized-departure notices or a new Level-4 'Do Not Travel' for a Gulf state — the classic evacuation-of-nationals warning indicator.",
      sourceFeed: "forceProtection / NEO advisory feed (travel.state.gov)",
      weight: 0.9,
      falsifier: "No new ordered/authorized-departure notice and no Level-4 change for any Gulf state in the window.",
      provenance: "State Dept Travel Advisory system (open); Grabo 'evacuation of nationals' classic indicator.",
    },
    {
      id: "airspace_gps_disruption",
      warningProblem: "centcom_iran",
      description:
        "Gulf FIR/airspace closures and overflight NOTAMs — infrastructure-of-conflict precursors. (Keeps its legacy id for history; the GPS half moved to pnt_denial.)",
      sourceFeed: "airspace (DAIP FIR NOTAMs)",
      weight: 0.55,
      falsifier: "No new FIR closure / overflight NOTAM over the AOR.",
      provenance: "DAIP/NOTAM open data.",
    },
    ...spectrumIndicators("centcom_iran", "the Gulf", ["IRN"]),
    {
      id: "hormuz_interdiction_signal",
      warningProblem: "centcom_iran",
      description:
        "Strait of Hormuz interdiction signal — closure declarations, mining, tanker seizure or harassment reporting.",
      sourceFeed: "Graded Hormuz activity read (reported act > declared threat > analysis; UCDP/ACLED events in the approaches) — the Economy tab's chokepoint board — corroborated by your X/newsletters/OSINT feeds [+ AIS anomaly when keyed]",
      weight: 0.7,
      falsifier: "No Hormuz closure / seizure / mining reporting corroborated by ≥2 sources in a rolling 72h window.",
      provenance: "Open maritime-security reporting; historical Iran Hormuz-threat pattern.",
    },
  ],
};

// The fallback watch list — active when no Mission Profile AOI declares an I&W
// board. Server-side problem resolution lives in lib/warningProblems.ts.
export const WARNING_PROBLEMS: WarningProblemDef[] = [CENTCOM_IRAN];

export function warningProblemById(id: string): WarningProblemDef | undefined {
  return WARNING_PROBLEMS.find((p) => p.id === id);
}

// ── Problem geography — the sensor parameterization ─────────────────────────
// Everything the sensor layer needs to point the SAME six indicators at a
// different part of the world. CENTCOM_GEO carries the hand-tuned Gulf values
// the sensors shipped with; problemFromSeed() derives a geo for a Mission
// Profile AOI. PURE (client-safe).

export interface ProblemGeo {
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  countries: string[];
  /** `icao` names the hub for the per-hub lift series (sensor keys mob:/tanker:). */
  hubs: { lat: number; lon: number; icao?: string }[];
  firs: string[];
  terms: RegExp;                 // mention gate for free-text (X/newsletters/feeds)
  conflictIndicatorId: string;   // CENTCOM keeps its legacy indicator ids
  chokepoint: { id: string; indicatorId: string; name: string; searchTerm: string; terms: string[] } | null;
  /** ISO3 codes of the space powers among the AOI countries ([] → no
   *  space_activity indicator on this board). */
  spacePowers: string[];
}

export const CENTCOM_GEO: ProblemGeo = {
  bbox: { latMin: 12, latMax: 40, lonMin: 34, lonMax: 64 },
  countries: [
    "Iran", "Iraq", "Israel", "Yemen", "Saudi Arabia", "United Arab Emirates",
    "Qatar", "Bahrain", "Kuwait", "Oman", "Syria", "Lebanon",
  ],
  hubs: [
    { lat: 25.117, lon: 51.315, icao: "OTBH" }, // Al Udeid, Qatar
    { lat: 24.248, lon: 54.548, icao: "OMAM" }, // Al Dhafra, UAE
    { lat: 29.347, lon: 47.521, icao: "OKAS" }, // Ali Al Salem, Kuwait
    { lat: 24.063, lon: 47.580, icao: "OEPS" }, // Prince Sultan, KSA
    { lat: 26.271, lon: 50.636, icao: "OBBS" }, // Isa, Bahrain
  ],
  firs: ["OBBB", "OTDF", "OMAE", "OIIX", "OKAC", "ORBB", "OEJD", "OYSC"],
  terms: /\b(iran|iranian|tehran|irgc|iraq|iraqi|israel|israeli|\bidf\b|yemen|houthi|hormuz|persian gulf|arabian gulf|strait of hormuz|red sea|bab.?el.?mandeb|saudi|riyadh|qatar|doha|bahrain|manama|kuwait|\buae\b|emirates|abu dhabi|dubai|oman|muscat|syria|lebanon|hezbollah|hizbollah|centcom)\b/i,
  conflictIndicatorId: "conflict_intensity_gulf",
  chokepoint: { id: "hormuz", indicatorId: "hormuz_interdiction_signal", name: "Strait of Hormuz", searchTerm: "Strait of Hormuz", terms: ["hormuz", "strait"] },
  spacePowers: ["IRN"],
};

// Seed shape emitted by lib/missionProfile deriveTracking().warningProblems —
// re-declared here (structural) to avoid a module cycle.
export interface WarningProblemSeed {
  id: string;
  name: string;
  aor: string;
  countries: string[];
  chokepointId: string | null;
  /** Carry space_activity when the AOI holds a space power (default true). */
  spaceActivity?: boolean;
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Instantiate the six-indicator template for a Mission Profile AOI. Same
// weights/thresholds as the hand-built CENTCOM problem; texts are
// parameterized; the chokepoint indicator only exists when the AOI has one.
// A fresh problem id starts with an empty warning_daily history, so the engine
// holds it in learning mode until a real baseline forms — by design.
export function problemFromSeed(seed: WarningProblemSeed): { def: WarningProblemDef; geo: ProblemGeo } {
  const cp = seed.chokepointId ? CHOKEPOINTS.find((c) => c.id === seed.chokepointId) ?? null : null;
  const spacePowers = seed.spaceActivity === false ? [] : spacePowersIn(seed.countries);

  // Bbox from country centroids, padded — same coarse-SA standard as lib/aor.
  const cens = seed.countries.map((c) => countryCentroid(c)).filter((x): x is [number, number] => x != null);
  const PAD = 6;
  const bbox = cens.length
    ? {
        latMin: Math.min(...cens.map((c) => c[0])) - PAD, latMax: Math.max(...cens.map((c) => c[0])) + PAD,
        lonMin: Math.min(...cens.map((c) => c[1])) - PAD, lonMax: Math.max(...cens.map((c) => c[1])) + PAD,
      }
    : { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 };

  const inBbox = (lat: number, lon: number) =>
    lat >= bbox.latMin && lat <= bbox.latMax && lon >= bbox.lonMin && lon <= bbox.lonMax;
  const hubs = ALL_AIRFIELDS.filter((a) => inBbox(a.lat, a.lon)).slice(0, 8).map((a) => ({ lat: a.lat, lon: a.lon, icao: a.icao }));

  const firs = [...new Set(seed.countries.flatMap((c) => firsForCountry(c).map((f) => f.code)))].slice(0, 10);

  const termWords = [...new Set([
    ...seed.countries.map((c) => c.toLowerCase()),
    seed.name.toLowerCase(),
    ...(cp ? cp.keywords : []),
  ])].filter((w) => w.length >= 3);
  const terms = new RegExp(`\\b(${termWords.map(escapeRx).join("|")})\\b`, "i");

  const label = `${seed.aor} · ${seed.name}`;
  const def: WarningProblemDef = {
    id: seed.id,
    label,
    scenario: `Escalation across the ${seed.name} area of interest (${seed.countries.join(", ")}) toward sustained hostilities affecting basing, overflight, and mobility access.`,
    decisionLinkage:
      "A threshold crossing informs: (1) force-protection posture at AOI bases; (2) NEO readiness for AOI posts; " +
      `(3) tanker & strategic-airlift surge${cp ? ` and ${cp.name} routing` : ""}.`,
    thresholds: { watch: 0.15, warning: 0.35, alert: 0.6 },
    indicators: [
      {
        id: "conflict_intensity", warningProblem: seed.id,
        description: `In-AOI conflict-event intensity (strikes, battles, remote violence) across ${seed.name} versus its trailing baseline.`,
        sourceFeed: "conflictEvents (UCDP GED / ACLED / ReliefWeb)", weight: 0.9,
        falsifier: "30-day in-AOI event count returns to within 1σ of its trailing-90-day baseline for two consecutive weeks.",
        provenance: "ISW event methodology; UCDP GED event-intensity framing (templated).",
      },
      {
        id: "escalatory_strike_signal", warningProblem: seed.id,
        description: `Escalatory strike / rhetoric news signal geolocated to the ${seed.name} AOI, corroborated across sources.`,
        sourceFeed: "GDELT DOC, corroborated by your imported X + newsletters + OSINT feeds (own-source only caps at watch)", weight: 0.6,
        falsifier: "No escalation-phrase reporting corroborated by ≥2 independent sources in a rolling 72h window.",
        provenance: "CSIS/ISW open reporting cadence; Grabo 'communications & rhetoric' indicator class.",
      },
      {
        id: "mobility_divergence", warningProblem: seed.id,
        description: "Airlift/tanker mobility posture toward the AOI versus implied demand — the divergence sensor.",
        sourceFeed: "aircraftMil (keyless ADS-B, mobility/tanker filter) × implied-demand map", weight: 0.8,
        falsifier: "Mil mobility density near AOI hubs stays at or below baseline for 5 consecutive days while implied demand is elevated.",
        provenance: "Open mobility-posture-as-warning doctrine (RAND airlift-readiness studies).",
      },
      {
        id: "neo_departure_posture", warningProblem: seed.id,
        description: `State Department ordered/authorized-departure notices or a NEW Level-4 for an AOI state (${seed.countries.slice(0, 4).join(", ")}…).`,
        sourceFeed: "forceProtection / NEO advisory feed (travel.state.gov)", weight: 0.9,
        falsifier: "No new ordered/authorized-departure notice and no Level-4 change for any AOI state in the window.",
        provenance: "State Dept Travel Advisory system (open); Grabo 'evacuation of nationals' classic indicator.",
      },
      {
        id: "airspace_gps_disruption", warningProblem: seed.id,
        description: `AOI FIR/airspace closures and overflight NOTAMs — infrastructure-of-conflict precursors (${firs.length ? firs.join(" ") : "no mapped FIRs"}).`,
        sourceFeed: "airspace (DAIP FIR NOTAMs)", weight: 0.55,
        falsifier: "No new FIR closure / overflight NOTAM over the AOI.",
        provenance: "DAIP/NOTAM open data.",
      },
      ...(cp ? [{
        id: "chokepoint_interdiction", warningProblem: seed.id,
        description: `${cp.name} interdiction signal — closure declarations, mining, seizure or harassment reporting.`,
        sourceFeed: `Graded ${cp.name} activity read (reported act > declared threat > analysis; conflict events in the approaches) — the Economy tab's chokepoint board — corroborated by your X/newsletters/OSINT feeds`, weight: 0.7,
        falsifier: `No ${cp.name} closure / seizure / mining reporting corroborated by ≥2 sources in a rolling 72h window.`,
        provenance: "Open maritime/transit-security reporting.",
      }] : []),
      ...spectrumIndicators(seed.id, seed.name, spacePowers),
    ],
  };

  const geo: ProblemGeo = {
    bbox, countries: seed.countries, hubs, firs, terms,
    conflictIndicatorId: "conflict_intensity",
    chokepoint: cp ? { id: cp.id, indicatorId: "chokepoint_interdiction", name: cp.name, searchTerm: cp.name, terms: cp.keywords.map((k) => k.toLowerCase()) } : null,
    spacePowers,
  };
  return { def, geo };
}
