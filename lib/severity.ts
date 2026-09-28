// The severity vocabulary — one home, one direction.
//
// PURE, client-safe, unit-tested. Same rule as lib/icons.tsx: "change it here,
// not at call sites, so one value keeps one meaning."
//
// ── Why this file exists ──────────────────────────────────────────────────
// Before it, SEV_RANK was defined six times across lib/ and components/, in two
// CONTRADICTORY directions. lib/forceProtection.ts used green:0 … red:3 (higher
// is worse); the two components that render its output used red:0 … green:3
// (lower is worse). Each file was self-consistent, so nothing was visibly
// broken — but ForceWatchBoard had to annotate its comparison ("lower rank
// index = more severe") to stay readable, and any comparison moved across that
// boundary would have been silently backwards. A board that ranks calm above
// critical still renders perfectly, which is what made it dangerous.
//
// The two SEV_DOT tables also disagreed on the colour of `unknown`, so the same
// posture rendered two different greys on two panes.
//
// ── The direction ─────────────────────────────────────────────────────────
// HIGHER IS WORSE. This is forceProtection's convention, kept because its
// scoring uses the ordinal as a multiplier (`rank * 20`) — the exact numbers
// below are load-bearing there and must not move.
//
// UNKNOWN SITS ABOVE GREEN, not below it. An unconfirmed posture is more
// concerning than a confirmed clear one — this is the app's "UNKNOWN is not
// clear" rule expressed as an ordering. A sort that put unknown below green
// would bury exactly the entries a dead feed produces.
//
// Components should not touch the numbers at all. Use the helpers: that is
// what removes the direction hazard, not merely centralising the table.
//
// NOT in scope: `disasters` (has orange), NWS severe weather (Extreme/Severe/
// Moderate/Minor), and the Household wellbeing tone (red/amber/calm) are
// different vocabularies with different level names, not duplicates of this
// one. Forcing them into one enum would be the opposite mistake.

export type Severity = "green" | "unknown" | "amber" | "red";

export const SEVERITIES: readonly Severity[] = ["green", "unknown", "amber", "red"];

/** Ordinal, higher = worse. See the header before changing any value. */
export const SEVERITY_RANK: Record<Severity, number> = { green: 0, unknown: 1, amber: 2, red: 3 };

/** True when `a` is strictly worse than `b`. */
export const isWorse = (a: Severity, b: Severity): boolean => SEVERITY_RANK[a] > SEVERITY_RANK[b];

/** The worse of two. On a tie the FIRST argument wins, which preserves the
 *  behaviour of forceProtection's original `worse()` reducer exactly. */
export const worseOf = (a: Severity, b: Severity): Severity =>
  SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;

/** The worst in a list, or `fallback` for an empty one — never a guessed
 *  green. A group with nothing in it is unknown, not clear. */
export function worstOf(list: readonly Severity[], fallback: Severity = "unknown"): Severity {
  if (list.length === 0) return fallback;
  return list.reduce(worseOf);
}

/** Comparator: worst first. `list.sort(byWorstFirst)`; chain a tie-break after
 *  it with `||` as the call sites already do. */
export const byWorstFirst = (a: Severity, b: Severity): number => SEVERITY_RANK[b] - SEVERITY_RANK[a];

// ── Display tokens ────────────────────────────────────────────────────────
// Hex for SVG/inline `style` (Leaflet markers and dots cannot take Tailwind
// classes), Tailwind classes for text and borders.

export const SEVERITY_DOT: Record<Severity, string> = {
  red: "#ef4444", amber: "#fbbf24", green: "#10b981", unknown: "#64748b",
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  red: "text-red-400", amber: "text-amber-400", green: "text-emerald-400", unknown: "text-slate-400",
};

export const SEVERITY_BORDER: Record<Severity, string> = {
  red: "border-l-red-500/70", amber: "border-l-amber-500/70",
  green: "border-l-emerald-500/40", unknown: "border-l-slate-500/50",
};

/** Narrow an untrusted string to a Severity, defaulting to unknown — never to
 *  green. A malformed severity from a feed must not read as clear. */
export function asSeverity(v: unknown): Severity {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v) ? (v as Severity) : "unknown";
}
