// Relative time, one grammar.
//
// PURE, client-safe, unit-tested (tests/relTime.test.ts). Before this file
// the dashboard carried fourteen private helpers that said "3h ago", "3 h
// ago", "about 3 hours ago", "3h" and "3 h" for the same instant. One
// function, one spelling: no space between the number and its unit.
//
// `now` is always a parameter so a test (and a caller holding a tick) can
// pin the instant; the default is the wall clock.

export type RelTimeInput = number | string | Date;

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Epoch ms for any accepted input, or NaN when it does not parse. */
export function toMs(input: RelTimeInput | null | undefined): number {
  if (input == null) return NaN;
  if (input instanceof Date) return input.getTime();
  if (typeof input === "number") return input;
  if (!input) return NaN;
  return Date.parse(input);
}

function units(ageMs: number): string {
  if (ageMs < HOUR) return `${Math.floor(ageMs / MIN)}m`;
  if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)}h`;
  return `${Math.floor(ageMs / DAY)}d`;
}

/** "just now" (< 60 s) · "5m ago" · "3h ago" · "2d ago". A future instant
 *  reads as "just now" (it has not happened yet; see `relTimeFuture`).
 *  Unparseable input → "" so a caller can render nothing rather than NaN. */
export function relTime(input: RelTimeInput | null | undefined, now: number = Date.now()): string {
  const t = toMs(input);
  if (!Number.isFinite(t)) return "";
  const age = now - t;
  if (age < MIN) return "just now";
  return `${units(age)} ago`;
}

/** The same grammar in both directions: "in 5m" / "in 3h" / "in 2d" for an
 *  instant ahead of `now`, "just now" within a minute either way, and
 *  `relTime` for the past. */
export function relTimeFuture(input: RelTimeInput | null | undefined, now: number = Date.now()): string {
  const t = toMs(input);
  if (!Number.isFinite(t)) return "";
  const diff = t - now;
  if (Math.abs(diff) < MIN) return "just now";
  if (diff > 0) return `in ${units(diff)}`;
  return relTime(t, now);
}

/** The "last updated" stamp: relative inside the first hour, then the local
 *  clock time ("just now" · "5m ago" · "9:41 AM"). The four tab headers that
 *  carried this exact grammar share it here. */
export function updatedAgo(input: RelTimeInput | null | undefined, now: number = Date.now()): string {
  const t = toMs(input);
  if (!Number.isFinite(t)) return "";
  const age = now - t;
  if (age < MIN) return "just now";
  if (age < HOUR) return `${Math.floor(age / MIN)}m ago`;
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Day-granular: "today" · "yesterday" · "3d ago" (· "in 2d"). Takes a bare
 *  `YYYY-MM-DD` (read at local noon, so a zone shift cannot roll it a day)
 *  or any instant; compares LOCAL calendar days, never 24-hour spans. */
export function relDay(input: RelTimeInput | null | undefined, now: number = Date.now()): string {
  const t = typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input) ? Date.parse(`${input}T12:00:00`) : toMs(input);
  if (!Number.isFinite(t)) return "";
  const a = new Date(t); const b = new Date(now);
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  const d = Math.round((dayB - dayA) / DAY);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 0) return `in ${-d}d`;
  return `${d}d ago`;
}
