// One runway-closure NOTAM, judged against NOW and the field's runway count —
// PURE, client-safe, unit-tested (tests/runwayClosure.test.ts).
//
// Why this exists (2026-11-02, "OJAQ only has one runway, why am I getting
// this for routine construction"): the force-posture airspace axis turned RED
// for ANY runway-closure NOTAM in the active set — a construction closure
// published as "SUN TUE WED 1400-1800" read RED all day, and its signal
// ("RWY 01/19 CLSD — starts in 8h") carried no runway count, so the model
// surfaces that read it (the brief, the assistant, the reads) supplied a
// second runway and wrote "your hub goes single-runway; deconflict inbound
// lift now". Two rules, the SITREP's own:
//   • a closure drives colour only while IN EFFECT (the schedule's occurrence
//     covering now, or a standing closure with no times); a future one is
//     named with its window and how far off it is;
//   • the runway count is stated: the field's ONLY runway closed is the field
//     closed for that window (never "single-runway"), one of several closed
//     is single-runway ops, and an unknown count is said to be unknown.

import { closureWindows, parseNotamSchedule, type SitrepNotam } from "./sitrepSignals";

/** Works wording a NOTAM uses for routine closures. */
export const WORKS_RE = /\b(?:WIP|WORK IN PROGRESS|WORKS?|CONST\w*|MAINT\w*|RESURFAC\w*|REPAIR\w*|PAINT\w*|RUBBER REMOVAL|CRACK SEAL\w*)\b/i;

export type ClosureTiming = "now" | "soon" | "later" | "indeterminate" | "expired";

export interface RunwayClosureRead {
  timing: ClosureTiming;
  /** green / amber / red — earned by timing × runway count. */
  severity: "green" | "amber" | "red";
  sole: boolean;
  /** 0 = the count is unknown. */
  runwayCount: number;
  routine: boolean;
  text: string;
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** `label` is the runway as the NOTAM names it ("RWY 01/19"); "RWY" alone
 *  (no designator) is THE runway. */
export function runwayClosureRead(n: SitrepNotam, nowMs: number, runwayCount: number, label: string): RunwayClosureRead {
  const count = runwayCount > 0 ? runwayCount : 0;
  const sole = label === "RWY" || count === 1;
  const schedule = parseNotamSchedule(n.text);
  const wins = closureWindows([n], nowMs, 48).filter((w) => w.kind === "closure");
  const recurring = wins.some((w) => w.recurring) || Boolean(schedule);
  const routine = recurring || WORKS_RE.test(n.text);
  const why = routine ? (recurring ? "scheduled works" : "works") : "NOTAM";
  const name = sole ? `Sole runway ${label === "RWY" ? "" : `${label} `}`.replace(/\s+$/, " ") : `${label} `;
  const consequence = sole ? "field closed" : count > 1 ? `${count - 1} other runway${count > 2 ? "s" : ""} open` : "runway count UNKNOWN — if it is the only runway the field is closed";
  const base = { sole, runwayCount: count, routine };

  const endMs = n.end ? Date.parse(n.end) : NaN;
  if (Number.isFinite(endMs) && endMs < nowMs) return { ...base, timing: "expired", severity: "green", text: `${name}closure expired` };

  const inEffect = wins.find((w) => !w.indeterminate && w.fromMs <= nowMs + 60_000 && w.toMs > nowMs);
  if (inEffect) {
    const until = inEffect.openEnded ? "UFN" : `until ${hhmm(inEffect.toMs)}Z`;
    return { ...base, timing: "now", severity: sole || count === 0 ? "red" : "amber", text: `${name}CLOSED ${until} (${why}) — ${consequence}` };
  }
  if (wins.some((w) => w.indeterminate)) {
    return { ...base, timing: "indeterminate", severity: "amber", text: `${name}closure — schedule not parsed, see the NOTAM (${consequence})` };
  }
  const next = wins.filter((w) => w.fromMs > nowMs).sort((a, b) => a.fromMs - b.fromMs)[0];
  if (next) {
    const h = Math.round((next.fromMs - nowMs) / 3_600_000);
    const lead = h >= 1 ? `in ~${h} h` : "within the hour";
    const win = `${hhmm(next.fromMs)}–${next.openEnded ? "UFN" : `${hhmm(next.toMs)}Z`}`;
    // Upcoming: the sole runway (or an unknown count) is worth amber — access
    // will be lost for the window; one of several is a note, not a colour.
    return { ...base, timing: "soon", severity: sole || count === 0 ? "amber" : "green", text: `${name}closes ${win} (${lead}, ${why}) — ${consequence} for that window, open outside it` };
  }
  // No window inside 48 h. A published schedule whose next occurrence is
  // further out, or a validity that starts later, is not a closure now.
  const startMs = n.start ? Date.parse(n.start) : NaN;
  if (schedule || (Number.isFinite(startMs) && startMs > nowMs)) {
    return { ...base, timing: "later", severity: "green", text: `${name}closure scheduled beyond 48 h (${why})` };
  }
  // A standing closure with no times at all is in effect now.
  return { ...base, timing: "now", severity: sole || count === 0 ? "red" : "amber", text: `${name}CLOSED (${why}) — ${consequence}` };
}
