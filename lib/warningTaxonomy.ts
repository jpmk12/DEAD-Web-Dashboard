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

import type { WarningProblemDef } from "./warning";

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
      sourceFeed: "conflictNews.scoreConflictNews (GDELT DOC + OSINT feeds)",
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
        "Gulf FIR/airspace closures and overflight NOTAMs plus GPS/EW interference density over the AOR — infrastructure-of-conflict precursors.",
      sourceFeed: "airspace (DAIP FIR NOTAMs) + gpsjam GPS-interference",
      weight: 0.55,
      falsifier: "No new FIR closure / overflight NOTAM and GPS-interference cells at or below baseline over the AOR.",
      provenance: "DAIP/NOTAM open data; open GPS-jamming observation (gpsjam.org).",
    },
    {
      id: "hormuz_interdiction_signal",
      warningProblem: "centcom_iran",
      description:
        "Strait of Hormuz interdiction signal — closure declarations, mining, tanker seizure or harassment reporting.",
      sourceFeed: "conflictNews keyword layer (Hormuz closure/mining/seizure) [+ AIS anomaly when keyed]",
      weight: 0.7,
      falsifier: "No Hormuz closure / seizure / mining reporting corroborated by ≥2 sources in a rolling 72h window.",
      provenance: "Open maritime-security reporting; historical Iran Hormuz-threat pattern.",
    },
  ],
};

// The active watch list. Phase 1 ships one problem, done deep (§9.1).
export const WARNING_PROBLEMS: WarningProblemDef[] = [CENTCOM_IRAN];

export function warningProblemById(id: string): WarningProblemDef | undefined {
  return WARNING_PROBLEMS.find((p) => p.id === id);
}
