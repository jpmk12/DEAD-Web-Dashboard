// LIMFAC / Mission-Impact derivation — PURE, client-safe, unit-tested. Turns
// the assembled SITREP signals (weather, NOTAMs, force protection, infra) plus
// any commander-entered LIMFACs into a leadership-facing mission-capability
// picture: per-function FMC/PMC/NMC, a ranked LIMFAC register, and CCIR flags.
//
// Discipline (mirrors the rest of the SITREP): CONSERVATIVE. Only field-closed
// and the NAVAID×forecast-weather fusion produce an automatic NMC; everything
// else caps at PMC so the tool never overstates. When the driving feed is
// UNREACHABLE the function is UNKNOWN, never FMC — a dead source must not read
// as "green". These are planning aids for the commander's judgment, not
// directive readiness calls.

import type { SitrepPayload } from "./sitrep";
import { closureWindows, type ClosureWindow } from "./sitrepSignals";

export type Capability = "fmc" | "pmc" | "nmc" | "unknown";

export interface MissionFunctionStatus {
  key: string;
  label: string;
  capability: Capability;
  driver: string;
  window: string | null;
  limfacIds: string[];
  derived?: boolean;      // marks the NAVAID×weather fusion
}

export type LimfacSource = "auto" | "manual";
export type LimfacStatus = "new" | "ongoing" | "improving" | "worsening" | "resolved";

export interface Limfac {
  id: string;
  fn: string;             // mission-function key
  fnLabel: string;
  capability: Capability;
  source: LimfacSource;
  status: LimfacStatus;
  window: string | null;
  driver: string;
  impact: string;
  mitigation?: string;
  ask?: string;
  ccir?: boolean;
  enteredBy?: string;     // manual attribution (display name/email)
  stale?: boolean;        // manual LIMFAC whose window has passed but still active
}

export interface CcirFlag { key: string; text: string }

export interface MissionImpact {
  state: Capability;
  functions: MissionFunctionStatus[];
  limfacs: Limfac[];
  ccir: CcirFlag[];
}

// Commander-entered LIMFAC as stored (lib/limfacStore). Windows are ISO or null.
export interface ManualLimfac {
  id: string;
  icao: string;
  fn: string;
  capability: Capability;
  driver: string;
  impact: string;
  mitigation?: string | null;
  ask?: string | null;
  ccir?: boolean;
  fromISO?: string | null;
  toISO?: string | null;
  status: LimfacStatus;
  enteredBy?: string | null;
  createdAt: string;
}

export const MISSION_FUNCTIONS: { key: string; label: string }[] = [
  { key: "launch_recovery", label: "Launch & Recovery" },
  { key: "all_weather_night", label: "All-Weather / Night" },
  { key: "throughput", label: "Throughput / Parking" },
  { key: "fuel_servicing", label: "Fuel / Servicing" },
  { key: "arff", label: "Fire / Crash Rescue (ARFF)" },
  { key: "c2_comms", label: "C2 / Comms" },
  { key: "force_protection", label: "Force Protection / Access" },
];
const FN_LABEL: Record<string, string> = Object.fromEntries(MISSION_FUNCTIONS.map((f) => [f.key, f.label]));
export function functionLabel(key: string): string { return FN_LABEL[key] ?? key; }

const CAP_RANK: Record<Capability, number> = { fmc: 0, unknown: 1, pmc: 2, nmc: 3 };
const worse = (a: Capability, b: Capability): Capability => (CAP_RANK[a] >= CAP_RANK[b] ? a : b);

export const CAP_LABEL: Record<Capability, string> = {
  fmc: "FMC", pmc: "PMC", nmc: "NMC", unknown: "UNKNOWN",
};
export const CAP_LONG: Record<Capability, string> = {
  fmc: "Fully Mission Capable",
  pmc: "Partially Mission Capable",
  nmc: "Non-Mission Capable",
  unknown: "Status Unknown",
};

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

// Format a window from a closure bar for display: "1330–2200Z" / "–1400Z"
// (already in effect) / "1330Z–UFN" (open-ended).
function windowLabelFor(w: ClosureWindow, nowMs: number): string {
  const start = w.fromMs <= nowMs + 60_000 ? "" : hhmm(w.fromMs);
  const end = w.openEnded ? "UFN" : hhmm(w.toMs);
  return `${start}–${end}Z`;
}

function isoWindow(fromISO?: string | null, toISO?: string | null): string | null {
  const f = fromISO ? Date.parse(fromISO) : NaN;
  const t = toISO ? Date.parse(toISO) : NaN;
  if (!Number.isFinite(f) && !Number.isFinite(t)) return null;
  const start = Number.isFinite(f) ? hhmm(f) : "";
  const end = Number.isFinite(t) ? hhmm(t) : "UFN";
  return `${start}–${end}Z`;
}

const NAVAID_RE = /\bILS|LOC|VOR|TACAN|RNAV|GLIDESLOPE|\bGS\b|PAPI|VASI|APCH|APPROACH/i;

// ── Core derivation ──────────────────────────────────────────────────────────

export function deriveMissionImpact(p: SitrepPayload, manual: ManualLimfac[] = []): MissionImpact {
  const nowMs = Date.parse(p.generatedAt) || Date.now();
  const daipUp = p.ops.configured && p.ops.live;
  const windows = daipUp ? closureWindows(p.ops.groups.flatMap((g) => g.items), nowMs, 48) : [];

  const limfacs: Limfac[] = [];
  const ccir: CcirFlag[] = [];
  let n = 0;
  const nextId = () => `L-${String(++n).padStart(2, "0")}`;

  const push = (l: Omit<Limfac, "id" | "fnLabel" | "source" | "status"> & Partial<Pick<Limfac, "status">>): string => {
    const id = nextId();
    limfacs.push({ id, fnLabel: functionLabel(l.fn), source: "auto", status: l.status ?? "ongoing", ...l } as Limfac);
    return id;
  };

  const funcs: MissionFunctionStatus[] = [];
  const addFn = (key: string, capability: Capability, driver: string, window: string | null, limfacIds: string[], derived?: boolean) =>
    funcs.push({ key, label: functionLabel(key), capability, driver, window, limfacIds, derived });

  // 1. Launch & Recovery ─────────────────────────────────────────────────────
  {
    const rwyClose = windows.find((w) => /^RWY|^Airfield/.test(w.label) && w.kind === "closure");
    const xwRed = p.ops.runwayWinds.find((r) => r.flag === "r");
    const lifr = p.weather.now?.flightCategory === "LIFR";
    if (!daipUp) {
      addFn("launch_recovery", "unknown", "DAIP unreachable — runway/airfield status UNKNOWN", null, []);
    } else if (p.ops.fieldClosed) {
      const id = push({ fn: "launch_recovery", capability: "nmc", window: windowFromClose(windows, nowMs), driver: "Airfield closed (NOTAM)", impact: "Airfield cannot support launch or recovery.", status: "new", ccir: true });
      addFn("launch_recovery", "nmc", "Airfield closed (NOTAM)", windowFromClose(windows, nowMs), [id]);
      ccir.push({ key: "field_closed", text: "Airfield closed (NOTAM)" });
    } else if (rwyClose) {
      const win = windowLabelFor(rwyClose, nowMs);
      const id = push({ fn: "launch_recovery", capability: "pmc", window: win, driver: `Runway closure (${rwyClose.label})`, impact: "Single-runway operations; reduced surge capacity, no simultaneous ops.", mitigation: "Slot deconfliction with tower; brief crews on active-runway change." });
      addFn("launch_recovery", "pmc", `Single-runway ops — ${rwyClose.label} closed`, win, [id]);
      ccir.push({ key: "single_runway", text: `Single-runway operations (${rwyClose.label} closed ${win})` });
    } else if (xwRed) {
      const id = push({ fn: "launch_recovery", capability: "pmc", window: null, driver: `Crosswind exceedance RWY ${xwRed.ident} (${xwRed.crossKt}kt${xwRed.gustCrossKt ? `G${xwRed.gustCrossKt}` : ""})`, impact: "Crosswind above advisory threshold; recovery limited to favourable runway ends." });
      addFn("launch_recovery", "pmc", `Crosswind exceedance RWY ${xwRed.ident}`, null, [id]);
    } else if (lifr) {
      const id = push({ fn: "launch_recovery", capability: "pmc", window: null, driver: "LIFR conditions", impact: "Ceiling/visibility at LIFR; launch/recovery restricted to lowest-minima aircraft/crews." });
      addFn("launch_recovery", "pmc", "LIFR conditions", null, [id]);
    } else {
      addFn("launch_recovery", "fmc", `${p.weather.now?.flightCategory ?? "VFR"}; runway open`, null, []);
    }
  }

  // 2. All-Weather / Night — the NAVAID × forecast-weather fusion ─────────────
  {
    const navaidGroup = p.ops.groups.find((g) => g.key === "navaid");
    const navaidWin = windows.find((w) => NAVAID_RE.test(w.label));
    const navaidOut = Boolean(navaidWin) || Boolean(navaidGroup && navaidGroup.items.length > 0);
    const tafBad = p.weather.tafWorst?.worst === "IFR" || p.weather.tafWorst?.worst === "LIFR"
      || p.weather.now?.flightCategory === "IFR" || p.weather.now?.flightCategory === "LIFR";
    const win = navaidWin ? windowLabelFor(navaidWin, nowMs) : null;
    if (!daipUp) {
      addFn("all_weather_night", "unknown", "DAIP unreachable — approach/NAVAID status UNKNOWN", null, []);
    } else if (navaidOut && tafBad) {
      const drv = navaidWin ? `${navaidWin.label} U/S` : (navaidGroup?.items[0]?.text.slice(0, 60) ?? "NAVAID/approach U/S");
      const id = push({ fn: "all_weather_night", capability: "nmc", window: win, driver: `${drv} × TAF ${p.weather.tafWorst?.worst ?? p.weather.now?.flightCategory}`, impact: "No usable precision approach in forecast instrument conditions; night/IFR arrivals at divert risk.", mitigation: "Request ASR/GCA from approach control; pre-coordinate an alternate.", status: "new", ccir: true });
      addFn("all_weather_night", "nmc", `${drv} × forecast IFR — no usable approach`, win, [id], true);
      ccir.push({ key: "no_approach", text: `No usable precision approach in forecast conditions${win ? ` (${win})` : ""}` });
    } else if (navaidOut) {
      const drv = navaidWin ? `${navaidWin.label} U/S` : "NAVAID/approach U/S";
      const id = push({ fn: "all_weather_night", capability: "pmc", window: win, driver: drv, impact: "Approach unavailable (VFR — not currently required); night/instrument capability reduced." });
      addFn("all_weather_night", "pmc", `${drv} (VFR — not required now)`, win, [id]);
    } else {
      addFn("all_weather_night", "fmc", "Approaches available", null, []);
    }
  }

  // 3. Throughput / Parking ──────────────────────────────────────────────────
  {
    const twyWin = windows.find((w) => /^TWY|Apron/i.test(w.label));
    if (!daipUp) {
      addFn("throughput", "unknown", "DAIP unreachable — taxiway/apron status UNKNOWN", null, []);
    } else if (twyWin) {
      const win = windowLabelFor(twyWin, nowMs);
      const id = push({ fn: "throughput", capability: "pmc", window: win, driver: `${twyWin.label} ${twyWin.kind === "closure" ? "closed" : "limited"}`, impact: "Reduced taxi routing / ramp capacity; added time to launch/recovery turn.", mitigation: "Marshal via alternate taxiway; sequence departures to hold congestion." });
      addFn("throughput", "pmc", `${twyWin.label} ${twyWin.kind === "closure" ? "closed" : "limited"}`, win, [id]);
    } else {
      addFn("throughput", "fmc", "Taxiways/ramp open", null, []);
    }
  }

  // 4. Fuel / Servicing ──────────────────────────────────────────────────────
  {
    const fuel = p.ops.fuel;
    if (!fuel || !fuel.live) {
      addFn("fuel_servicing", "unknown", "Fuel NOTAM feed unreachable — UNKNOWN", null, []);
    } else if (fuel.items.length > 0) {
      const unavbl = fuel.items.some((t) => /UNAVBL|NOT\s+AVBL/i.test(t));
      const id = push({ fn: "fuel_servicing", capability: "pmc", window: null, driver: fuel.items[0].slice(0, 80), impact: unavbl ? "Fuel unavailable per NOTAM — sortie generation at risk." : "Fuel limitation per NOTAM; refuel throughput reduced." });
      addFn("fuel_servicing", "pmc", unavbl ? "Fuel unavailable (NOTAM)" : "Fuel limitation (NOTAM)", null, [id]);
      if (unavbl) ccir.push({ key: "fuel_unavbl", text: "Fuel unavailable (NOTAM)" });
    } else {
      addFn("fuel_servicing", "fmc", "No fuel NOTAMs", null, []);
    }
  }

  // 5. ARFF — no automated feed; manual-only (a stub function unless a manual
  //    LIMFAC covers it). Shows UNKNOWN→FMC baseline of "no reported limitation".
  addFn("arff", "fmc", "No reported ARFF limitation", null, []);

  // 6. C2 / Comms ────────────────────────────────────────────────────────────
  {
    const inet = p.infra.internet;
    const nasDown = p.infra.nas?.live && p.infra.nas.nearby.some((x) => x.kind === "closure" || x.kind === "groundStop");
    if (!inet.live && !p.infra.nas?.live) {
      addFn("c2_comms", "unknown", "Connectivity sensors unreachable — UNKNOWN", null, []);
    } else if (inet.led === "r") {
      const id = push({ fn: "c2_comms", capability: "pmc", window: null, driver: `Internet degradation (${inet.entity ?? "region"})`, impact: "Regional connectivity degraded; C2 / reachback may be affected." });
      addFn("c2_comms", "pmc", "Internet degradation detected", null, [id]);
      ccir.push({ key: "comms", text: "Internet/comms degradation detected" });
    } else if (inet.led === "a" || nasDown || p.infra.commsNews.length > 0) {
      addFn("c2_comms", "fmc", nasDown ? "FAA NAS program nearby (watch)" : "Minor connectivity signal (watch)", null, []);
    } else {
      addFn("c2_comms", "fmc", "Connectivity nominal", null, []);
    }
  }

  // 7. Force Protection / Access ─────────────────────────────────────────────
  {
    const fp = p.threats.fp;
    if (!fp) {
      addFn("force_protection", "unknown", "Force Protection assessment unavailable — UNKNOWN", null, []);
    } else if (fp.composite === "red") {
      const id = push({ fn: "force_protection", capability: "pmc", window: null, driver: fp.topDriver, impact: "Elevated force-protection posture; access/operations may require posture change." });
      addFn("force_protection", "pmc", `FP RED — ${fp.topDriver}`, null, [id]);
      ccir.push({ key: "fp_red", text: `Force protection posture RED — ${fp.topDriver}` });
    } else if (fp.composite === "amber") {
      addFn("force_protection", "fmc", `FP amber (watch) — ${fp.topDriver}`, null, []);
    } else {
      addFn("force_protection", "fmc", "No elevated force-protection drivers", null, []);
    }
  }

  // ── Merge commander-entered LIMFACs ────────────────────────────────────────
  for (const m of manual) {
    if (m.status === "resolved") continue;
    // A commander LIMFAC whose end window is in the past but which hasn't been
    // resolved — prompt the entrant to confirm or clear it so leadership never
    // sees a stale limitation. (Auto LIMFACs self-clear as their NOTAM expires.)
    const endMs = m.toISO ? Date.parse(m.toISO) : NaN;
    const stale = Number.isFinite(endMs) && endMs < nowMs;
    const lf: Limfac = {
      id: m.id, fn: m.fn, fnLabel: functionLabel(m.fn), capability: m.capability,
      source: "manual", status: m.status, window: isoWindow(m.fromISO, m.toISO),
      driver: m.driver, impact: m.impact,
      mitigation: m.mitigation ?? undefined, ask: m.ask ?? undefined,
      ccir: m.ccir, enteredBy: m.enteredBy ?? undefined, stale,
    };
    limfacs.push(lf);
    if (m.ccir) ccir.push({ key: `manual_${m.id}`, text: `${functionLabel(m.fn)}: ${m.driver}` });
    // Worsen the matching function's capability if the manual entry is worse.
    const fn = funcs.find((f) => f.key === m.fn);
    if (fn) {
      if (CAP_RANK[m.capability] > CAP_RANK[fn.capability]) {
        fn.capability = m.capability;
        fn.driver = m.driver;
        fn.window = lf.window ?? fn.window;
      }
      fn.limfacIds.push(m.id);
    }
  }

  // Rank the register: NMC first, then PMC, then unknown; CCIR-flagged float up.
  limfacs.sort((a, b) =>
    (CAP_RANK[b.capability] - CAP_RANK[a.capability]) ||
    (Number(Boolean(b.ccir)) - Number(Boolean(a.ccir))));

  // Overall airfield state = worst function.
  const state = funcs.reduce<Capability>((acc, f) => worse(acc, f.capability), "fmc");

  return { state, functions: funcs, limfacs, ccir };
}

// Helper: earliest airfield/runway closure window label (for the closed case).
function windowFromClose(windows: ClosureWindow[], nowMs: number): string | null {
  const w = windows.find((x) => /^Airfield|^RWY/.test(x.label) && x.kind === "closure");
  return w ? windowLabelFor(w, nowMs) : null;
}
