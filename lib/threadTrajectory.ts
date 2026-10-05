// Threads read against their own history — PURE, client-safe, unit-tested.
//
// The History tab held the best data on the News tab (label trajectories,
// sustained escalation, re-emergence) and nobody reached it (REVIEW-2026-10
// N2/N4). These helpers put that history ON the thread card: the run ("3rd
// day rising", "new today", "back after 18 d"), a 14-day sparkline, the
// diff against yesterday's thread with the same label, the through-line's
// "vs yesterday" line, and the door-in chips to the boards / chokepoints a
// thread touches. Everything here is a join over stored sessions — no
// model call — and a thread with no history says so rather than guessing.

import type { LabelOccurrence, LabelSummary, StoredSession, StoredThread } from "./threadHistory";
import type { NewsThread } from "./types";

export type Trend = "rising" | "stable" | "fading";

export interface ThreadRun {
  trend: Trend;
  /** Consecutive sessions (ending with the latest) sharing `trend`. */
  days: number;
  /** "new today" · "3rd day" · "back after 18 d" */
  label: string;
  /** Seen once only. */
  isNew: boolean;
  /** Returned after a gap of ≥ 2 days. */
  reemerging: boolean;
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const dayNum = (ymd: string): number => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

/** The run this label is on, from its occurrences (any order). */
export function threadRun(history: LabelOccurrence[], fallbackTrend: Trend = "stable"): ThreadRun {
  const occ = history.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (occ.length === 0) return { trend: fallbackTrend, days: 0, label: "no history", isNew: true, reemerging: false };
  const last = occ[occ.length - 1];
  if (occ.length === 1) return { trend: last.trend, days: 1, label: "new today", isNew: true, reemerging: false };
  const prev = occ[occ.length - 2];
  const gap = dayNum(last.date) - dayNum(prev.date);
  if (gap >= 2) return { trend: last.trend, days: 1, label: `back after ${gap} d`, isNew: false, reemerging: true };
  let days = 1;
  for (let i = occ.length - 2; i >= 0 && occ[i].trend === last.trend; i--) days++;
  return { trend: last.trend, days, label: days === 1 ? `1st day ${last.trend}` : `${ordinal(days)} day`, isNew: false, reemerging: false };
}

/** One cell per calendar day ending `today`; null = no session that day. */
export function sparkCells(history: LabelOccurrence[], today: string, days = 14): (Trend | null)[] {
  const by = new Map(history.map((h) => [h.date, h.trend] as const));
  const end = dayNum(today);
  const out: (Trend | null)[] = [];
  for (let d = end - days + 1; d <= end; d++) {
    const ymd = new Date(d * 86_400_000).toISOString().slice(0, 10);
    out.push(by.get(ymd) ?? null);
  }
  return out;
}

/** What moved against the previous session's thread with the same label. */
export function threadDiff(today: Pick<NewsThread, "trend" | "sources" | "headline">, prev: Pick<StoredThread, "trend" | "sources" | "headline"> | null | undefined): string {
  if (!prev) return "Not on the previous board.";
  const prevSet = new Set(prev.sources.map((s) => s.toLowerCase()));
  const todaySet = new Set(today.sources.map((s) => s.toLowerCase()));
  const added = today.sources.filter((s) => !prevSet.has(s.toLowerCase()));
  const dropped = prev.sources.filter((s) => !todaySet.has(s.toLowerCase()));
  const parts: string[] = [];
  parts.push(`Previously read ${prev.trend} on ${prev.sources.length} source${prev.sources.length === 1 ? "" : "s"}`);
  const moves: string[] = [];
  if (added.length) moves.push(`adds ${added.join(", ")}`);
  if (dropped.length) moves.push(`drops ${dropped.join(", ")}`);
  if (today.trend !== prev.trend) moves.push(`moves to ${today.trend}`);
  if (moves.length === 0) moves.push(today.headline.trim() === prev.headline.trim() ? "unchanged" : "same trend and sources, headline moved");
  return `${parts.join("")}; today ${moves.join(", ")}.`;
}

/** The through-line's one-line diff: new, moved, unchanged, dropped. */
export function throughLineDiff(today: Pick<NewsThread, "label" | "trend">[], prev: Pick<StoredSession, "date" | "threads"> | null | undefined): string | null {
  if (!prev) return null;
  const prevBy = new Map(prev.threads.map((t) => [t.label, t.trend] as const));
  const todayLabels = new Set(today.map((t) => t.label));
  const fresh = today.filter((t) => !prevBy.has(t.label)).map((t) => `${t.label} is NEW`);
  const moved = today.filter((t) => prevBy.has(t.label) && prevBy.get(t.label) !== t.trend).map((t) => `${t.label} ${prevBy.get(t.label)} → ${t.trend}`);
  const unchanged = today.filter((t) => prevBy.has(t.label) && prevBy.get(t.label) === t.trend).length;
  const dropped = prev.threads.filter((t) => !todayLabels.has(t.label)).map((t) => t.label);
  const parts = [
    ...fresh,
    ...moved,
    unchanged ? `${unchanged} unchanged` : "",
    dropped.length ? `${dropped.join(", ")} dropped` : "",
  ].filter(Boolean);
  return parts.length ? `vs ${prev.date}: ${parts.join("; ")}.` : `vs ${prev.date}: identical board.`;
}

const AMC_RE = /\b(AMC|mobility|airlift|air lift|strategic lift|lift demand|tanker|tanking|CRF|aerial refuel|air refuel|C-17|C-5|KC-46|KC-135|basing|overflight)\b/i;

/** Split the model's "For AMC…" sentence out of the summary. An explicit
 *  `amc` field wins; otherwise the LAST sentence that names mobility. */
export function splitAmc(summary: string, amc?: string | null): { body: string; amc: string | null } {
  if (amc && amc.trim()) return { body: summary.trim(), amc: amc.trim() };
  const sentences = summary.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (sentences.length < 2) return { body: summary.trim(), amc: null };
  for (let i = sentences.length - 1; i >= 1; i--) {
    if (AMC_RE.test(sentences[i])) {
      return { body: [...sentences.slice(0, i), ...sentences.slice(i + 1)].join(" ").trim(), amc: sentences[i] };
    }
  }
  return { body: summary.trim(), amc: null };
}

export interface ThreadDoor { kind: "board" | "chokepoint"; id: string; label: string; detail: string }

const COCOM_WORDS = new Set(["centcom", "eucom", "indopacom", "africom", "southcom", "northcom", "board", "watch"]);

/** Door-in chips: the I&W boards and chokepoints a thread names. Deterministic
 *  word match on the board's label words (≥ 4 letters, not a command name)
 *  and the chokepoint's keywords. Cap 3. */
export function threadDoors(
  thread: Pick<NewsThread, "label" | "headline" | "summary">,
  boards: { problemId: string; label: string; level: string; trajectory: string }[],
  chokepoints: { id: string; name: string; keywords: string[] }[],
): ThreadDoor[] {
  const text = ` ${thread.label} ${thread.headline} ${thread.summary} `.toLowerCase();
  const has = (w: string) => new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i").test(text);
  const out: ThreadDoor[] = [];
  for (const b of boards) {
    const words = b.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !COCOM_WORDS.has(w));
    if (words.some(has)) out.push({ kind: "board", id: b.problemId, label: b.label, detail: `I&W ${b.level.toUpperCase()} · ${b.trajectory}` });
  }
  for (const c of chokepoints) {
    if (c.keywords.some((k) => text.includes(k.toLowerCase()))) out.push({ kind: "chokepoint", id: c.id, label: c.name, detail: "chokepoint read" });
  }
  return out.slice(0, 3);
}

export interface MovingGroup { key: "sustained" | "rising" | "reemerging" | "steady" | "fading"; title: string; labels: LabelSummary[] }

/** The Moving rail, in the order the operator asked for. */
export function movingGroups(labels: LabelSummary[]): MovingGroup[] {
  const sustained = labels.filter((l) => l.isSustainedEscalation);
  const reemerging = labels.filter((l) => !l.isSustainedEscalation && l.isRemerging);
  const rest = labels.filter((l) => !l.isSustainedEscalation && !l.isRemerging);
  const rising = rest.filter((l) => l.lastTrend === "rising").sort((a, b) => b.trajectoryScore - a.trajectoryScore);
  const steady = rest.filter((l) => l.lastTrend === "stable").sort((a, b) => b.occurrences - a.occurrences);
  const fading = rest.filter((l) => l.lastTrend === "fading").sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  return [
    { key: "sustained", title: "⚡ Sustained escalation", labels: sustained },
    { key: "rising", title: "↑ Rising", labels: rising },
    { key: "reemerging", title: "↩ Re-emerging", labels: reemerging },
    { key: "steady", title: "→ Steady", labels: steady },
    { key: "fading", title: "↓ Fading", labels: fading },
  ].filter((g) => g.labels.length > 0) as MovingGroup[];
}

const TREND_GLYPH: Record<Trend, string> = { rising: "↑ rising", stable: "→ stable", fading: "↓ fading" };

/** The 🧵 thread doc for a label: a Latest section that is replaced each day
 *  and a Trace list (the Docs tab renders it as a timeline) that gains ONE
 *  stop per date — re-saving the same day replaces that day's stop. */
export function threadDocMarkdown(thread: Pick<NewsThread, "label" | "headline" | "summary" | "trend" | "sources">, dateYmd: string, existing?: string | null): string {
  const stop = `${dateYmd} — ${TREND_GLYPH[thread.trend]} — ${thread.headline.trim()}${thread.sources.length ? ` (${thread.sources.join(", ")})` : ""}`;
  const latest = `## Latest\n\n**${thread.headline.trim()}**\n\n${thread.summary.trim()}\n`;
  if (!existing || !existing.trim()) {
    return `# Thread: ${thread.label}\n\n_Followed from the News tab. The Trace below gains one stop each day the thread appears._\n\n${latest}\n## Trace\n\n1. ${stop}\n`;
  }
  let out = existing;
  // Replace the Latest section (up to the next heading).
  if (/^## Latest\s*$/m.test(out)) {
    out = out.replace(/## Latest\s*\n[\s\S]*?(?=\n## |\s*$)/, latest.trimEnd());
  } else {
    out = out.replace(/\n## Trace/, `\n${latest}\n## Trace`);
  }
  // Append to (or replace within) the Trace list.
  const traceIdx = out.search(/^#{1,6}\s+.*\btrace\b.*$/im);
  if (traceIdx === -1) return `${out.trimEnd()}\n\n## Trace\n\n1. ${stop}\n`;
  const lines = out.split("\n");
  const headLine = out.slice(0, traceIdx).split("\n").length - 1;
  let i = headLine + 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  const itemIdx: number[] = [];
  while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { itemIdx.push(i); i++; }
  const existingForDay = itemIdx.find((li) => lines[li].replace(/^\s*\d+[.)]\s+/, "").startsWith(dateYmd));
  if (existingForDay !== undefined) {
    lines[existingForDay] = `${itemIdx.indexOf(existingForDay) + 1}. ${stop}`;
  } else {
    const insertAt = itemIdx.length ? itemIdx[itemIdx.length - 1] + 1 : headLine + 2;
    if (!itemIdx.length && lines[headLine + 1]?.trim() !== "") lines.splice(headLine + 1, 0, "");
    lines.splice(insertAt, 0, `${itemIdx.length + 1}. ${stop}`);
  }
  return lines.join("\n");
}
