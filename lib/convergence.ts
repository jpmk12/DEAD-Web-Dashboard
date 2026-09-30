// Convergence: where several independent surfaces are pointing at one place.
//
// PURE, client-safe, unit-tested. No model call, no new fetch.
//
// The Crisis map already has a convergence strip, but it can only see its own
// map layers and groups by AOR — a whole combatant command, which is too
// coarse to act on. This generalises the idea across every surface the app
// runs (feeds, I&W, disasters, force posture, base SITREPs, chokepoint news)
// and groups by SUBJECT — the country or chokepoint itself.
//
// Why it is worth a card: no single pane can say the sentence. The feed knows
// mentions are up. The I&W board knows the level. Force Protection knows the
// posture. Each is individually unremarkable; the fact that all three moved on
// the same subject this week is the finding, and today nothing computes it.
//
// ── Discipline ────────────────────────────────────────────────────────────
// CONVERGENCE MEANS DISTINCT KINDS. Three disaster alerts in one country is
// not corroboration, it is one story reported three times — the same
// single-source trap the I&W board's "own-source-only caps at WATCH" rule
// exists to avoid. Only signals from DIFFERENT surfaces count toward breadth.
//
// BREADTH BEATS INTENSITY. Rows are ranked by how many independent surfaces
// agree before how loud any one of them is, because that is the whole claim
// being made. One screaming source is already visible on its own pane.

export type ConvergenceKind =
  | "feed"      // trend movers — mentions in the user's own sources
  | "iw"        // an I&W board above calm
  | "disaster"  // GDACS/USGS/ReliefWeb alert
  | "posture"   // Force Protection composite elevated
  | "sitrep"    // a base LED amber/red
  | "economic"  // chokepoint / energy news pressure
  | "pair";     // two terms seen together for the first time in 60 days (lib/trends.newPairs)

export interface ConvergenceSignal {
  /** Country, chokepoint or place. Normalised by `canonicalSubject`. */
  subject: string;
  kind: ConvergenceKind;
  /** One clause of evidence, shown verbatim on the row. */
  detail: string;
  /** Tie-breaker within equal breadth. */
  weight: number;
}

export interface Convergence {
  subject: string;
  /** Distinct kinds agreeing — the headline number. */
  breadth: number;
  /** Strongest signal per kind, ordered by KIND_ORDER for a stable read. */
  signals: ConvergenceSignal[];
  /** Sum of the per-kind strongest weights. Ranking tie-break only. */
  score: number;
}

/** Display order, roughly "most considered judgement" first, so a row always
 *  reads the same way regardless of which surface happened to fire first. */
export const KIND_ORDER: ConvergenceKind[] = ["iw", "posture", "sitrep", "disaster", "economic", "feed", "pair"];

export const KIND_LABEL: Record<ConvergenceKind, string> = {
  iw: "I&W", posture: "Posture", sitrep: "SITREP",
  disaster: "Disaster", economic: "Economic", feed: "Feeds", pair: "New pairing",
};

/** Minimum distinct surfaces before a subject is worth a row. */
export const MIN_BREADTH = 2;

// Noise words stripped when joining subjects across surfaces. Deliberately
// small: an over-eager normaliser would merge distinct places, which is a
// worse failure than missing a join.
const TRIM_PATTERNS: RegExp[] = [
  /\s*\([^)]*\)\s*$/,                       // "Congo (Kinshasa)" → "Congo"
  /^(the|republic of|islamic republic of|state of|kingdom of)\s+/i,
  /,\s*(the|islamic republic of|republic of)$/i,
];

/**
 * Canonical form for cross-surface joining. Surfaces name the same place
 * differently — a disaster feed says "Iran (Islamic Republic of)", an I&W
 * label says "Iran" — and without this they never meet, which would make
 * convergence silently under-report exactly when it matters.
 */
export function canonicalSubject(raw: string): string {
  let s = (raw ?? "").trim();
  // Iterate to a fixed point: the prefixes stack ("The Republic of Iraq"), and
  // a single pass over the pattern list strips "The " and then never revisits
  // the prefix rule. Bounded so a pathological input cannot spin.
  for (let pass = 0; pass < 4; pass++) {
    const before = s;
    for (const p of TRIM_PATTERNS) s = s.replace(p, "").trim();
    if (s === before) break;
  }
  return s.toLowerCase().replace(/\s+/g, " ");
}

/** Title-ish display form, preferring the longest original spelling seen —
 *  "Bab-el-Mandeb" reads better than "bab el mandeb". */
function pickDisplay(originals: string[]): string {
  return originals.slice().sort((a, b) => b.length - a.length)[0] ?? "";
}

export function findConvergence(
  signals: ConvergenceSignal[],
  opts: { minBreadth?: number; max?: number } = {},
): Convergence[] {
  const minBreadth = opts.minBreadth ?? MIN_BREADTH;

  // Group by canonical subject, keeping the STRONGEST signal per kind. Keeping
  // every signal would let one chatty surface inflate the score.
  const groups = new Map<string, { originals: string[]; byKind: Map<ConvergenceKind, ConvergenceSignal> }>();
  for (const s of signals) {
    const key = canonicalSubject(s.subject);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) { g = { originals: [], byKind: new Map() }; groups.set(key, g); }
    g.originals.push(s.subject.trim());
    const cur = g.byKind.get(s.kind);
    if (!cur || s.weight > cur.weight) g.byKind.set(s.kind, s);
  }

  const out: Convergence[] = [];
  for (const g of groups.values()) {
    const breadth = g.byKind.size;
    if (breadth < minBreadth) continue;
    const ordered = KIND_ORDER.map((k) => g.byKind.get(k)).filter((s): s is ConvergenceSignal => !!s);
    out.push({
      subject: pickDisplay(g.originals),
      breadth,
      signals: ordered,
      score: ordered.reduce((n, s) => n + s.weight, 0),
    });
  }

  // Breadth first — that IS the claim. Intensity only breaks ties.
  out.sort((a, b) => b.breadth - a.breadth || b.score - a.score || a.subject.localeCompare(b.subject));
  return out.slice(0, opts.max ?? 5);
}

/** One-sentence summary for the row header. */
export function convergenceLine(c: Convergence): string {
  return `${c.breadth} surfaces agree — ${c.signals.map((s) => KIND_LABEL[s.kind]).join(" · ")}`;
}
