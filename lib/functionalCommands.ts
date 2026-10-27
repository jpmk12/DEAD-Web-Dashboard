// Functional combatant commands on the command board — PURE, client-safe,
// tested (2026-10-24, "I see the geographic commands but not SPACECOM,
// CYBERCOM and TRANSCOM").
//
// A geographic row is a WHERE: posture rows, bases and events hang off an
// AOR. A functional command's AOR is a WHAT — a domain — so it cannot share
// the geographic row shape (it would show no bases, no posture, no events,
// and read "quiet" forever). Each functional row is a set of DOMAIN-NATIVE
// cells, every one earned by a sensor the app already runs and read UNKNOWN
// when that sensor is dead. Nothing here is new data; it is the picture the
// app already computes, presented as the command whose job it is.
//
//   USTRANSCOM — the mobility enterprise: demand 7 d · crews vs demand ·
//                the straits · the en route system (own hub / spokes).
//   USSPACECOM — PNT · space weather · counterspace · launch cadence.
//   USCYBERCOM — cyber pressure · edge exposure (KEV × declared vendors) ·
//                outages · actor cyber posture.
//
// The I&W boards stay where they are (PNT / cyber / counterspace indicators
// live on each AOI board); a functional cell reports the WORST across boards
// and names the board, so one signal is never counted twice. USSTRATCOM and
// USSOCOM are deliberately absent: the app has no honest sensor for the
// first and the second is a customer of mobility, not a domain it watches.

import type { Aor } from "./aor";
import type { Led, CbDemand, CbSitrep, CbOwnField, CbAlert } from "./commandBoard";
import type { ObservedState } from "./warning";
import type { CrewPosture } from "./crewState";

export type FunctionalCommand = "TRANSCOM" | "SPACECOM" | "CYBERCOM";
export const FUNCTIONAL_COMMANDS: FunctionalCommand[] = ["TRANSCOM", "SPACECOM", "CYBERCOM"];
export const FC_LABELS: Record<FunctionalCommand, string> = { TRANSCOM: "USTRANSCOM", SPACECOM: "USSPACECOM", CYBERCOM: "USCYBERCOM" };
export const FC_DOMAIN: Record<FunctionalCommand, string> = {
  TRANSCOM: "global mobility — demand, crews, the straits, the en route system",
  SPACECOM: "the space domain — PNT, space weather, counterspace, launch",
  CYBERCOM: "cyberspace — pressure on the AOIs, your edge, outages, actor posture",
};
/** Map layers the picture turns ON when a functional row is open (never off). */
export const FC_MAP_LAYERS: Record<FunctionalCommand, string[]> = {
  TRANSCOM: ["milair", "enroute", "crf", "airfields", "maritime", "lines"],
  SPACECOM: ["launches", "gps", "outages"],
  CYBERCOM: ["outages", "gps"],
};

export type FcDoor =
  | { kind: "board"; id: string }
  | { kind: "field"; id: string }
  | { kind: "country"; id: string }
  | { kind: "tab"; tab: "glance" | "weather" | "economy" | "osint" };

export interface FcCell {
  key: string;
  label: string;
  led: Led;
  /** One line — the row's own words. */
  text: string;
  /** The sensor answered this pass. */
  live: boolean;
  /** Lines for the expanded row (per board / per strait / per actor …). */
  detail: string[];
  door?: FcDoor;
}

export interface FcRow {
  cmd: FunctionalCommand;
  label: string;
  domain: string;
  cells: FcCell[];
  worst: Led;
  /** The cell that colours the row, in words. */
  why: string;
  layers: string[];
}

// ── Inputs: structural subsets of what the assembler already holds ──
export interface FcRead { state: ObservedState; led: Led; board: string; problemId: string; why: string; live: boolean }
export interface FcSpectrum {
  pending?: boolean;
  pnt: FcRead | null;
  cyber: FcRead | null;
  space: FcRead | null;
  counterspace?: FcRead | null;
  spaceWx: { live: boolean; led: Led; severe: { scale: "R" | "S" | "G"; level: number }[] };
  edge: { declared: boolean; live: boolean; led: Led; vendors: string[]; hits: { cve: string; vendor: string; product: string; ransomware: boolean }[] };
  boards: { problemId: string; label: string; pnt: ObservedState | null; cyber: ObservedState | null; space: ObservedState | null; counterspace?: ObservedState | null }[];
  postures?: {
    country: string;
    board: { problemId: string; label: string } | null;
    counterspace: FcRead | null;
    catalogue: { live: boolean; configured: boolean; reason: string | null; closestKm: number | null; manoeuvres14: number } | null;
    cyber: { posture: "preparation" | "sustained pressure" | "demonstration" | "quiet" | "unknown"; why: string } | null;
  }[];
}
export interface FcCrew {
  declared: boolean;
  line: string | null;
  stale: boolean;
  staleHours: number | null;
  /** Per command: demand direction against the squadron-wide availability. */
  lines: { aor: string; direction: "rise" | "hold" | "fall"; posture: CrewPosture; mismatch: boolean; line: string }[];
}
export interface FcStrait { id: string; name: string; aor: Aor; score: number; acts: number; threats: number; line: string | null; transit?: string | null }
/** Which outage sources answered this pass — IODA (Georgia Tech) and
 *  Cloudflare Radar are independent; the Outages cell is green only when at
 *  least one answered, and names what it is missing. */
export interface FcOutageSources { ioda: boolean; radar: { configured: boolean; live: boolean; reason: string | null } }
/** Cloudflare Radar BGP — hijacks and route leaks touching the tracked
 *  countries (7 d). `reads` carry only countries with something; `tracked`
 *  is how many were asked, so "nothing" can say over how many. */
export interface FcRouting {
  configured: boolean; live: boolean; reason: string | null; tracked: number;
  reads: { code: string; name: string; level: "red" | "amber" | "note"; why: string; ongoing: boolean }[];
}
/** Cloudflare Radar NetFlows — the hour-matched traffic read per tracked
 *  country. A `collapsed` read with no outage alert turns the Outages cell
 *  amber (raw evidence, not yet curated); `down` is a detail line. */
export interface FcTraffic {
  configured: boolean; live: boolean; reason: string | null; failed: string[];
  reads: { code: string; name: string; state: "normal" | "down" | "collapsed" | "learning" | "unknown"; ratio: number | null; why: string }[];
}
export interface FcInput {
  spectrum: FcSpectrum | null;
  demand: CbDemand[] | null;
  crew: FcCrew | null;
  straits: FcStrait[] | null;
  sitreps: CbSitrep[] | null;
  ownFields: CbOwnField[];
  alerts: CbAlert[] | null;
  /** Absent (older callers) → the cell falls back to the cyber sensors' liveness. */
  outages?: FcOutageSources | null;
  /** Absent (older callers) → the Routing cell reads UNKNOWN. */
  routing?: FcRouting | null;
  /** Absent (older callers) → no traffic corroboration on the Outages cell. */
  traffic?: FcTraffic | null;
}

const LED_RANK: Record<Led, number> = { g: 0, u: 1, a: 2, r: 3 };
export const worstLed = (xs: Led[]): Led => xs.reduce<Led>((w, l) => (LED_RANK[l] > LED_RANK[w] ? l : w), "g");
const stateLed = (s: ObservedState): Led => (s === "confirmed" || s === "active" ? "r" : s === "watching" ? "a" : "g");
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function readCell(key: string, label: string, r: FcRead | null | undefined, pendingNote: string | null, missing: string): FcCell {
  if (!r) return { key, label, led: "u", text: pendingNote ?? missing, live: false, detail: [] };
  if (!r.live) return { key, label, led: "u", text: `UNKNOWN — ${r.why || "sensor dead"} (${r.board})`, live: false, detail: [r.why], door: { kind: "board", id: r.problemId } };
  return { key, label, led: r.led, text: `${r.state} on ${r.board} — ${cap(r.why, 160)}`, live: true, detail: [r.why], door: { kind: "board", id: r.problemId } };
}

function boardLines(spectrum: FcSpectrum | null, k: "pnt" | "cyber" | "space" | "counterspace"): string[] {
  return (spectrum?.boards ?? []).flatMap((b) => { const s = b[k]; return s ? [`${b.label}: ${s}`] : []; });
}

// ── USTRANSCOM ──
function transcom(i: FcInput): FcRow {
  const cells: FcCell[] = [];
  // Demand 7 d — the worst outlook across commands.
  if (!i.demand) cells.push({ key: "demand", label: "Demand 7 d", led: "u", text: "UNKNOWN — demand horizon unavailable", live: false, detail: [], door: { kind: "tab", tab: "glance" } });
  else {
    const rising = i.demand.filter((d) => d.direction === "rise").sort((a, b) => b.score - a.score);
    const falling = i.demand.filter((d) => d.direction === "fall");
    const led: Led = rising.length ? "a" : "g";
    const text = rising.length
      ? `${rising.map((d) => `${d.aor} likely to RISE (${d.confidence})`).join(" · ")}${falling.length ? ` · ${falling.map((d) => `${d.aor} FALL`).join(" · ")}` : ""}`
      : i.demand.length ? `holding across ${i.demand.length} command${i.demand.length === 1 ? "" : "s"}${falling.length ? ` · ${falling.map((d) => `${d.aor} FALL`).join(" · ")}` : ""}` : "no command watched";
    cells.push({ key: "demand", label: "Demand 7 d", led, text, live: true, detail: i.demand.map((d) => d.line), door: { kind: "tab", tab: "glance" } });
  }
  // Crews against demand.
  if (!i.crew) cells.push({ key: "crews", label: "Crews", led: "u", text: "UNKNOWN — crew state unavailable", live: false, detail: [], door: { kind: "tab", tab: "glance" } });
  else if (!i.crew.declared) cells.push({ key: "crews", label: "Crews", led: "u", text: "no crew counts declared — do not assume crews are available (Glance › Crews)", live: true, detail: [], door: { kind: "tab", tab: "glance" } });
  else {
    const mismatch = i.crew.lines.filter((l) => l.mismatch);
    const worstPosture = i.crew.lines.reduce<CrewPosture>((w, l) => (POSTURE_RANK[l.posture] > POSTURE_RANK[w] ? l.posture : w), "unknown");
    const led: Led = mismatch.length ? "r" : worstPosture === "critical" ? "r" : worstPosture === "thin" ? "a" : worstPosture === "sufficient" ? "g" : "u";
    const stale = i.crew.stale && i.crew.staleHours != null ? ` · last updated ${Math.round(i.crew.staleHours / 24)}d ago, confirm` : "";
    const text = mismatch.length
      ? `${mismatch.map((l) => `${l.aor} demand likely to RISE against ${l.posture} crews`).join(" · ")}${i.crew.line ? ` · ${i.crew.line}` : ""}${stale}`
      : `${i.crew.line ?? "declared"}${worstPosture !== "unknown" ? ` (${worstPosture})` : ""}${stale}`;
    cells.push({ key: "crews", label: "Crews", led, text, live: true, detail: i.crew.lines.map((l) => l.line), door: { kind: "tab", tab: "glance" } });
  }
  // The straits.
  if (!i.straits) cells.push({ key: "straits", label: "Straits", led: "u", text: "UNKNOWN — chokepoint reads unavailable", live: false, detail: [], door: { kind: "tab", tab: "economy" } });
  else {
    const sorted = [...i.straits].sort((a, b) => b.acts - a.acts || b.threats - a.threats || b.score - a.score);
    const hot = sorted.filter((s) => s.acts > 0 || s.threats > 0);
    const led: Led = sorted.some((s) => s.acts > 0) ? "r" : sorted.some((s) => s.threats > 0) ? "a" : "g";
    const text = hot.length
      ? hot.slice(0, 3).map((s) => `${s.name} — ${s.acts} act${s.acts === 1 ? "" : "s"}, ${s.threats} threat${s.threats === 1 ? "" : "s"}${s.transit && s.transit !== "normal" && s.transit !== "unknown" ? ` · transit ${s.transit}` : ""}`).join(" · ")
      : `no reported act or declared threat at ${sorted.length} strait${sorted.length === 1 ? "" : "s"}`;
    cells.push({ key: "straits", label: "Straits", led, text, live: true, detail: sorted.map((s) => `${s.name}: ${s.line ?? "nothing reported"}${s.transit ? ` · AIS ${s.transit}` : ""}`), door: { kind: "tab", tab: "economy" } });
  }
  // The en route system — own hub and spokes' SITREP LEDs.
  const own = i.ownFields;
  if (!own.length) cells.push({ key: "enroute", label: "En route", led: "u", text: "no hub or spoke declared — Preferences › Mission Profile", live: true, detail: [] });
  else {
    const rows = own.map((f) => ({ f, s: i.sitreps?.find((x) => x.icao === f.icao) ?? null }));
    const withS = rows.filter((r) => r.s);
    if (!withS.length) cells.push({ key: "enroute", label: "En route", led: "u", text: i.sitreps ? `${own.length} own field${own.length === 1 ? "" : "s"} without a SITREP slot — ★ a field to get one` : "UNKNOWN — SITREPs unavailable", live: !!i.sitreps, detail: own.map((f) => `${f.icao} ${f.role}`), door: { kind: "field", id: own[0].icao } });
    else {
      const worstOf = (s: CbSitrep) => worstLed([s.status.wx, s.status.ops, s.status.threat, s.status.infra, s.status.spectrum]);
      const ranked = withS.sort((a, b) => LED_RANK[worstOf(b.s!)] - LED_RANK[worstOf(a.s!)]);
      const top = ranked[0];
      const led = worstOf(top.s!);
      const text = led === "g" ? `${withS.length} field${withS.length === 1 ? "" : "s"} green${rows.length > withS.length ? ` · ${rows.length - withS.length} without a SITREP` : ""}` : `${top.f.icao} (${top.f.role}) ${led === "r" ? "RED" : led === "a" ? "amber" : "UNKNOWN"} — ${cap(top.s!.driver, 120)}`;
      cells.push({ key: "enroute", label: "En route", led, text, live: true, detail: ranked.map((r) => `${r.f.icao} ${r.f.role}: wx ${r.s!.status.wx} · ops ${r.s!.status.ops} · threat ${r.s!.status.threat} · infra ${r.s!.status.infra} · spectrum ${r.s!.status.spectrum} — ${r.s!.driver}`), door: { kind: "field", id: top.f.icao } });
    }
  }
  return finish("TRANSCOM", cells);
}
const POSTURE_RANK: Record<CrewPosture, number> = { unknown: 0, sufficient: 1, thin: 2, critical: 3 };

// ── USSPACECOM ──
function spacecom(i: FcInput): FcRow {
  const sp = i.spectrum;
  const pend = sp?.pending ? "assembling — the spectrum summary is pending" : sp ? null : "UNKNOWN — spectrum summary unavailable";
  const cells: FcCell[] = [];
  const pnt = readCell("pnt", "PNT", sp?.pnt, pend, "no board reads PNT, or every sensor was dead");
  pnt.detail = [...pnt.detail, ...boardLines(sp, "pnt")];
  cells.push(pnt);
  // Space weather.
  if (!sp) cells.push({ key: "swx", label: "Space wx", led: "u", text: pend ?? "UNKNOWN", live: false, detail: [], door: { kind: "tab", tab: "weather" } });
  else if (!sp.spaceWx.live) cells.push({ key: "swx", label: "Space wx", led: "u", text: "UNKNOWN — SWPC unreachable", live: false, detail: [], door: { kind: "tab", tab: "weather" } });
  else cells.push({ key: "swx", label: "Space wx", led: sp.spaceWx.led, text: sp.spaceWx.severe.length ? `${sp.spaceWx.severe.map((s) => `${s.scale}${s.level}`).join(" · ")} in effect` : "quiet — no scale ≥ 3 today", live: true, detail: [], door: { kind: "tab", tab: "weather" } });
  // Counterspace.
  const cs = readCell("counterspace", "Counterspace", sp?.counterspace, pend, "no board watches a space power (Russia / China) — or the catalogue and the wires were silent");
  const cat = (sp?.postures ?? []).map((p) => p.catalogue).find((c) => c);
  if (cat && !cat.configured) cs.detail = [`Space-Track not configured (${cat.reason ?? "set SPACETRACK_USER / SPACETRACK_PASS"}) — reporting only`, ...cs.detail];
  else if (cat && !cat.live) cs.detail = [`catalogue not live (${cat.reason ?? "unknown"}) — reporting only`, ...cs.detail];
  for (const p of sp?.postures ?? []) if (p.catalogue?.live) cs.detail.push(`${p.country}: ${p.catalogue.manoeuvres14} manoeuvre${p.catalogue.manoeuvres14 === 1 ? "" : "s"} in 14 d${p.catalogue.closestKm != null ? ` · closest declared asset ${p.catalogue.closestKm} km` : ""}`);
  cells.push(cs);
  const launch = readCell("launch", "Launch", sp?.space, pend, "no board watches a space power");
  launch.detail = [...launch.detail, ...boardLines(sp, "space")];
  cells.push(launch);
  return finish("SPACECOM", cells);
}

// ── USCYBERCOM ──
function cybercom(i: FcInput): FcRow {
  const sp = i.spectrum;
  const pend = sp?.pending ? "assembling — the spectrum summary is pending" : sp ? null : "UNKNOWN — spectrum summary unavailable";
  const cells: FcCell[] = [];
  const cy = readCell("cyber", "Cyber pressure", sp?.cyber, pend, "no board reads cyber pressure, or every sensor was dead");
  cy.detail = [...cy.detail, ...boardLines(sp, "cyber")];
  cells.push(cy);
  // Edge exposure.
  if (!sp) cells.push({ key: "edge", label: "Edge", led: "u", text: pend ?? "UNKNOWN", live: false, detail: [] });
  else if (!sp.edge.declared) cells.push({ key: "edge", label: "Edge", led: "u", text: "no edge vendors declared — UNKNOWN, not clear (SITREP › Spectrum › ⚙ vendors)", live: true, detail: [] });
  else if (!sp.edge.live) cells.push({ key: "edge", label: "Edge", led: "u", text: "UNKNOWN — CISA KEV unreachable", live: false, detail: [] });
  else {
    const ransom = sp.edge.hits.filter((h) => h.ransomware).length;
    cells.push({ key: "edge", label: "Edge", led: sp.edge.led, text: sp.edge.hits.length ? `${sp.edge.hits.length} KEV hit${sp.edge.hits.length === 1 ? "" : "s"} on ${sp.edge.vendors.join(", ")}${ransom ? ` · ${ransom} in ransomware use` : ""}` : `no KEV hit on ${sp.edge.vendors.join(", ")}`, live: true, detail: sp.edge.hits.map((h) => `${h.cve} — ${h.vendor} ${h.product}${h.ransomware ? " (ransomware)" : ""}`) });
  }
  // Outages.
  // Two independent sources: IODA (Georgia Tech) and Cloudflare Radar. An
  // alert from either is RED here (the alert itself already carries its own
  // severity); with no alert the cell is green only when at least one
  // source ANSWERED, and the detail names the one that did not — a Radar
  // token that is not set is "not configured", never "no outage".
  const outages = (i.alerts ?? []).filter((a) => a.id.startsWith("outage-"));
  const src = i.outages;
  const srcLines: string[] = src
    ? [
        src.ioda ? "IODA answered" : "IODA did not answer — UNKNOWN on that source",
        !src.radar.configured ? `Cloudflare Radar not configured (${src.radar.reason ?? "set CLOUDFLARE_RADAR_TOKEN"})` : src.radar.live ? "Cloudflare Radar answered" : `Cloudflare Radar did not answer (${src.radar.reason ?? "unknown"}) — UNKNOWN on that source`,
      ]
    : [];
  const answered = src ? src.ioda || src.radar.live : !!sp?.cyber?.live;
  const answeredBy = src ? [src.ioda ? "IODA" : null, src.radar.live ? "Cloudflare Radar" : null].filter(Boolean).join(" + ") : "IODA";
  // NetFlows — the raw traffic UNDER the annotations. A collapsed read in a
  // tracked country with no outage alert is amber here (raw evidence, not
  // yet curated — a second KIND of evidence, never a re-level of an
  // annotation); a `down` read is a detail line; learning / stale reads are
  // named so a quiet cell is not mistaken for a watched one.
  const tr = i.traffic;
  const collapsed = tr?.configured ? tr.reads.filter((r) => r.state === "collapsed") : [];
  const trafficLines: string[] = tr === undefined ? []
    : tr === null ? ["NetFlows read unavailable — traffic UNKNOWN"]
    : !tr.configured ? ["Cloudflare NetFlows not configured — traffic UNKNOWN"]
    : [
        ...tr.reads.filter((r) => r.state !== "normal").map((r) => `${r.name}: ${r.why}`),
        ...(tr.failed.length ? [`NetFlows did not answer for ${tr.failed.length} countr${tr.failed.length === 1 ? "y" : "ies"} (${tr.reason ?? "unknown"}) — UNKNOWN there`] : []),
        ...(tr.reads.length && tr.reads.every((r) => r.state === "normal") ? [`NetFlows: traffic normal in ${tr.reads.length} tracked countr${tr.reads.length === 1 ? "y" : "ies"}`] : []),
      ];
  const detail = [...srcLines, ...trafficLines];
  if (outages.length) cells.push({ key: "outages", label: "Outages", led: "r", text: outages.map((a) => a.title).join(" · "), live: true, detail: [...outages.map((a) => `${a.title} — ${a.sub}`), ...detail] });
  else if (!i.alerts) cells.push({ key: "outages", label: "Outages", led: "u", text: "UNKNOWN — alerts unavailable", live: false, detail });
  else if (collapsed.length) cells.push({ key: "outages", label: "Outages", led: "a", text: `traffic COLLAPSED in ${collapsed.map((r) => r.name).join(", ")} (Cloudflare NetFlows) — no outage annotation or IODA alert yet`, live: true, detail, door: { kind: "country", id: collapsed[0].name } });
  else if (answered) cells.push({ key: "outages", label: "Outages", led: "g", text: `no nationwide outage alert in a tracked country (${answeredBy})`, live: true, detail });
  else cells.push({ key: "outages", label: "Outages", led: "u", text: src ? "no outage alert — but neither outage source answered, so UNKNOWN" : "no outage alert — but the cyber sensors did not answer, so UNKNOWN", live: false, detail });
  // Routing — BGP hijacks and route leaks touching the tracked countries.
  // A high-confidence, recent hijack of a tracked country's prefixes is RED;
  // mid confidence or a leak is amber; nothing is green ONLY when the feed
  // answered; not configured is UNKNOWN, never clear.
  const rt = i.routing;
  if (rt === undefined) cells.push({ key: "routing", label: "Routing", led: "u", text: "UNKNOWN — BGP read unavailable", live: false, detail: [] });
  else if (!rt || !rt.configured) cells.push({ key: "routing", label: "Routing", led: "u", text: "Cloudflare Radar not configured — BGP hijacks UNKNOWN, not clear (CLOUDFLARE_RADAR_TOKEN)", live: false, detail: [] });
  else if (!rt.live) cells.push({ key: "routing", label: "Routing", led: "u", text: `UNKNOWN — Cloudflare BGP did not answer (${rt.reason ?? "unknown"})`, live: false, detail: rt.reads.map((r) => `${r.name} [${r.level}]: ${r.why}`) });
  else {
    const red = rt.reads.filter((r) => r.level === "red");
    const amber = rt.reads.filter((r) => r.level === "amber");
    const lead = red[0] ?? amber[0];
    const led: Led = red.length ? "r" : amber.length ? "a" : "g";
    const more = red.length + amber.length - 1;
    const text = lead
      ? `${lead.name}: ${cap(lead.why, 150)}${more > 0 ? ` · +${more} more` : ""}`
      : `no hijack or route leak touching a tracked country in 7 d (${rt.tracked} countr${rt.tracked === 1 ? "y" : "ies"} watched${rt.reads.length ? `; ${rt.reads.length} note${rt.reads.length === 1 ? "" : "s"}` : ""})`;
    cells.push({ key: "routing", label: "Routing", led, text, live: true, detail: rt.reads.map((r) => `${r.name} [${r.level}]: ${r.why}`), ...(lead ? { door: { kind: "country" as const, id: lead.name } } : {}) });
  }
  // Actor posture.
  const posts = (sp?.postures ?? []).filter((p) => p.cyber);
  if (!sp) cells.push({ key: "actors", label: "Actor posture", led: "u", text: pend ?? "UNKNOWN", live: false, detail: [] });
  else if (!posts.length) cells.push({ key: "actors", label: "Actor posture", led: "u", text: "no actor posture read — no board watches Russia or China", live: true, detail: [] });
  else {
    const rank = { preparation: 3, "sustained pressure": 2, demonstration: 1, quiet: 0, unknown: -1 } as const;
    const worst = posts.reduce((w, p) => (rank[p.cyber!.posture] > rank[w.cyber!.posture] ? p : w));
    const led: Led = worst.cyber!.posture === "unknown" ? "u" : worst.cyber!.posture === "preparation" || worst.cyber!.posture === "sustained pressure" ? "a" : "g";
    cells.push({ key: "actors", label: "Actor posture", led, text: posts.map((p) => `${p.country}: ${p.cyber!.posture}`).join(" · "), live: posts.some((p) => p.cyber!.posture !== "unknown"), detail: posts.map((p) => `${p.country}: ${p.cyber!.why}`), door: { kind: "country", id: worst.country } });
  }
  return finish("CYBERCOM", cells);
}

function finish(cmd: FunctionalCommand, cells: FcCell[]): FcRow {
  const worst = worstLed(cells.map((c) => c.led));
  const driver = cells.find((c) => c.led === worst) ?? cells[0];
  return { cmd, label: FC_LABELS[cmd], domain: FC_DOMAIN[cmd], cells, worst, why: `${driver.label}: ${driver.text}`, layers: FC_MAP_LAYERS[cmd] };
}

export function functionalRows(i: FcInput): FcRow[] {
  return [transcom(i), spacecom(i), cybercom(i)];
}

const LED_WORD: Record<Led, string> = { g: "GREEN", a: "AMBER", r: "RED", u: "UNKNOWN" };

/** The rows as text for the Ask pack. */
export function functionalText(rows: FcRow[], only?: FunctionalCommand[]): string {
  return rows.filter((r) => !only || only.includes(r.cmd)).map((r) =>
    `${r.label} (${LED_WORD[r.worst]}) — ${r.domain}\n${r.cells.map((c) => `- ${c.label} [${LED_WORD[c.led]}]: ${c.text}${c.detail.length ? `\n    ${c.detail.slice(0, 6).join("\n    ")}` : ""}`).join("\n")}`,
  ).join("\n\n");
}
