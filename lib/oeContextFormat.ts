// The assistant's operational-environment context — the FORMAT, pure and
// unit-tested. lib/oeContext.ts (server-only) gathers the snapshot; this file
// turns it into the compact block the chat prompt carries.
//
// Why the assistant needs this at all: it could see the calendar, tasks and
// recent headlines, but not one thing the dashboard itself had computed —
// force posture, base LEDs, I&W levels, active alerts, what changed since the
// last look, the calls that are due. Ask it "what should I be worried about"
// and it answered from headlines. This block is the app's own picture,
// handed over so the assistant reasons from the same surfaces the commander
// reads, and names them.
//
// Discipline carried over from those surfaces: UNKNOWN is stated as unknown,
// never dropped (a dead feed is not a quiet world); everything is labelled
// with the surface it came from so the answer can send the user there; the
// block is a SNAPSHOT with a time on it; and it is capped so it cannot crowd
// out the conversation.

export interface OeForceRow {
  label: string;
  composite: string;            // red | amber | green | unknown
  topDriver: string;
  cocom?: string;
  /** e.g. "chronic 12/14d" — omitted when quiet. */
  chronicity?: string | null;
  escalated?: boolean;
}

export interface OeSitrepRow {
  icao: string;
  label: string;
  status: { wx: string; ops: string; threat: string; infra: string };   // g|a|r|u
  driver: string;
  worse: string[];
}

export interface OeBoardRow {
  label: string;
  level: string;                // calm | watch | warning | alert
  anomaly: number;
  trajectory: string;
  learning: boolean;
  drivers: string[];
}

export interface OeAlertRow { severity: string; title: string; sub: string }

export interface OeDecisionRow { problem: string; call: string; expectation: string; dueISO: string }

export interface OeDemandRow { aor: string; direction: string; score: number; confidence: string; line: string }

export interface OeSnapshot {
  atISO: string;
  force: OeForceRow[] | null;        // null = surface unavailable
  sitrep: OeSitrepRow[] | null;
  boards: OeBoardRow[] | null;
  alerts: OeAlertRow[] | null;
  delta: { line: string | null; worse: string[]; better: string[]; fresh: string[] } | null;
  decisionsDue: OeDecisionRow[] | null;
  /** 7-day demand outlook per command (lib/demandHorizon). */
  demand?: OeDemandRow[] | null;
  /** True when the snapshot is older than the freshness window. */
  stale?: boolean;
}

export const OE_CONTEXT_MAX_CHARS = 3200;

const LED: Record<string, string> = { g: "green", a: "AMBER", r: "RED", u: "unknown" };
const SEV_RANK: Record<string, number> = { red: 3, amber: 2, unknown: 1, green: 0 };
const LVL_RANK: Record<string, number> = { alert: 3, warning: 2, watch: 1, calm: 0 };
const TRAJ: Record<string, string> = { deteriorating: "deteriorating", improving: "improving", stable: "stable" };

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const hhmmZ = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 16) + "Z" : "—";
};

/** Where the user is looking, as a hint line — `surface` is the active tab
 *  (and pane when known), as the client reports it. */
export function surfaceLine(surface: string | null | undefined): string {
  if (!surface || typeof surface !== "string") return "";
  const s = surface.replace(/[^a-z0-9:_-]/gi, "").slice(0, 40);
  return s ? `\nThe user currently has the "${s}" surface open.` : "";
}

export function renderOeContext(snap: OeSnapshot | null): string {
  if (!snap) {
    return "\n\nCURRENT OPERATIONAL ENVIRONMENT: unavailable this turn (the dashboard's OE surfaces did not respond in time). Say so if asked about posture, bases, boards or alerts — do not infer them from headlines.";
  }
  const lines: string[] = [];
  lines.push(`CURRENT OPERATIONAL ENVIRONMENT — snapshot as of ${hhmmZ(snap.atISO)}${snap.stale ? " (STALE — refresh in progress)" : ""}, from the dashboard's own surfaces. Reason from this, name the surface, and send the user to it for detail.`);

  // Force posture — worst first, quiet ones counted, never listed.
  if (snap.force === null) lines.push("Force posture (OSINT › Watch › map / Regional): UNAVAILABLE this turn.");
  else if (snap.force.length === 0) lines.push("Force posture: no watched countries or bases configured.");
  else {
    const sorted = snap.force.slice().sort((a, b) => (SEV_RANK[b.composite] ?? 0) - (SEV_RANK[a.composite] ?? 0));
    const loud = sorted.filter((r) => r.composite !== "green");
    const quiet = sorted.length - loud.length;
    const rows = loud.slice(0, 8).map((r) => {
      const tags = [r.escalated ? "escalated today" : null, r.chronicity ?? null].filter(Boolean).join(", ");
      return `  • ${r.label}${r.cocom ? ` (${r.cocom})` : ""}: ${r.composite.toUpperCase()} — ${clip(r.topDriver, 90)}${tags ? ` [${tags}]` : ""}`;
    });
    lines.push(`Force posture (${sorted.length} watched; OSINT › Regional):`);
    lines.push(...rows);
    if (loud.length > 8) lines.push(`  • …and ${loud.length - 8} more elevated`);
    if (quiet > 0) lines.push(`  • ${quiet} green`);
  }

  // Base SITREPs.
  if (snap.sitrep === null) lines.push("Base SITREP (OSINT › Watch): UNAVAILABLE this turn.");
  else if (snap.sitrep.length > 0) {
    lines.push("Base SITREP (OSINT › Watch › SITREP):");
    for (const s of snap.sitrep.slice(0, 6)) {
      const st = `wx ${LED[s.status.wx] ?? "unknown"} · ops ${LED[s.status.ops] ?? "unknown"} · threat ${LED[s.status.threat] ?? "unknown"} · infra ${LED[s.status.infra] ?? "unknown"}`;
      const worse = s.worse.length ? ` [worse than yesterday: ${s.worse.join(", ")}]` : "";
      lines.push(`  • ${s.label} (${s.icao}): ${st} — ${clip(s.driver, 100)}${worse}`);
    }
  }

  // I&W boards.
  if (snap.boards === null) lines.push("I&W boards (OSINT › Watch): UNAVAILABLE this turn.");
  else if (snap.boards.length > 0) {
    lines.push("Indications & Warning (OSINT › Watch › I&W; colour is earned — calm is the normal state):");
    const sorted = snap.boards.slice().sort((a, b) => (LVL_RANK[b.level] ?? 0) - (LVL_RANK[a.level] ?? 0));
    for (const b of sorted.slice(0, 6)) {
      const drv = b.drivers.length ? ` — drivers: ${b.drivers.slice(0, 3).map((d) => clip(d, 70)).join("; ")}` : "";
      lines.push(`  • ${b.label}: ${b.level.toUpperCase()}, anomaly ${b.anomaly >= 0 ? "+" : ""}${b.anomaly.toFixed(2)}, ${TRAJ[b.trajectory] ?? b.trajectory}${b.learning ? " (learning mode — baseline forming, level capped)" : ""}${drv}`);
    }
  }

  // Active alerts.
  if (snap.alerts === null) lines.push("Active alerts: UNAVAILABLE this turn.");
  else if (snap.alerts.length > 0) {
    lines.push("Active alerts (the conditions that would page you):");
    for (const a of snap.alerts.slice(0, 6)) lines.push(`  • ${a.severity.toUpperCase()}: ${clip(a.title, 80)} — ${clip(a.sub, 90)}`);
  } else lines.push("Active alerts: none.");

  // Delta.
  if (snap.delta) {
    if (snap.delta.line) {
      lines.push(`Changed since the user's last look (Glance › What changed): ${snap.delta.line}`);
      const ch = [...snap.delta.worse.map((w) => `↑ ${w}`), ...snap.delta.better.map((b) => `↓ ${b}`), ...snap.delta.fresh.map((f) => `new ${f}`)];
      if (ch.length) lines.push(`  ${ch.slice(0, 8).join(" · ")}`);
    } else lines.push("Changed since the user's last look: nothing moved.");
  }

  // Demand horizon — the forecast, with its drivers in the line.
  if (snap.demand === null) lines.push("7-day demand horizon (Glance): UNAVAILABLE this turn.");
  else if (snap.demand && snap.demand.length > 0) {
    lines.push("7-day mobility-demand horizon (Glance › Demand horizon; deterministic from the sensors above):");
    for (const d of snap.demand.slice(0, 6)) lines.push(`  • ${clip(d.line, 170)}`);
  }

  // Decisions due.
  if (snap.decisionsDue && snap.decisionsDue.length > 0) {
    lines.push("I&W calls now due for scoring (decision log):");
    for (const d of snap.decisionsDue.slice(0, 4)) lines.push(`  • ${d.problem}: ${d.call} — “${clip(d.expectation, 90)}” (due ${d.dueISO.slice(0, 10)})`);
  }

  lines.push("Rules for this block: UNKNOWN or UNAVAILABLE is not clear — say it is unknown. Do not invent posture, levels or alerts beyond what is listed. When asked what to worry about, lead with RED/alert and with what changed. Point to the surface by name.");

  let out = "\n\n" + lines.join("\n");
  if (out.length > OE_CONTEXT_MAX_CHARS) out = out.slice(0, OE_CONTEXT_MAX_CHARS - 1) + "…";
  return out;
}
