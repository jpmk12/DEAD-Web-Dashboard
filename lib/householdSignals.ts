// Household judgements. PURE, client-safe, unit-tested.
//
// The division of labour matters: the MODEL extracts facts from bill text
// (amount, due date, account tail), and this module derives every JUDGEMENT
// from those facts deterministically. "Is this bill late", "is this amount
// unusual", "how much runway is left on that passport" are arithmetic, and
// arithmetic should not be asked of a language model that will occasionally
// be confidently wrong about it.
//
// Same rules as the rest of the app: a comparison with too little history
// reports nothing rather than something misleading, and absence is a signal
// in its own right.

import type { BillCadence, FamilyBiller, FamilyDocument } from "./familyProfile";
import { resolveLeadDays } from "./familyProposals";

export interface BillSighting {
  billerId: string;
  seenISO: string;      // date the message arrived, YYYY-MM-DD
  amountCents: number | null;
}

// Expected gap between messages, and the slack we allow before calling a
// biller silent. Slack is generous on purpose: one late statement is normal,
// and a false "your bill is missing" teaches the user to ignore the panel.
// `auto` carries no expectation of its own: the caller resolves it to an
// observed cadence first (lib/billHistory.effectiveCadence). An unresolved
// auto is treated like irregular — never accused.
const CADENCE_DAYS: Record<BillCadence, number | null> = {
  monthly: 31, quarterly: 92, annual: 366, irregular: null, auto: null,
};
const SLACK_DAYS: Record<BillCadence, number> = {
  monthly: 10, quarterly: 21, annual: 45, irregular: 0, auto: 0,
};

export const cadenceDays = (c: BillCadence): number | null => CADENCE_DAYS[c];

const dayMs = 86_400_000;
const toMs = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);

export interface SilenceItem {
  biller: FamilyBiller;
  lastSeenISO: string | null;
  daysQuiet: number | null;   // null when never seen
  missedCycles: number;       // whole cadence periods overdue, ≥1 to appear
}

// Billers that should have written by now and have not.
//
// Requires THREE prior sightings before it will claim anything: with fewer,
// "quarterly" and "stopped six months ago" look identical, and the panel would
// manufacture alarm out of a short history. Irregular billers never appear —
// by definition they have no expected cadence to violate.
export function silenceWatch(
  billers: FamilyBiller[],
  sightings: BillSighting[],
  nowMs: number,
  minHistory = 3,
): SilenceItem[] {
  const byBiller = new Map<string, string[]>();
  for (const s of sightings) {
    const arr = byBiller.get(s.billerId) ?? [];
    arr.push(s.seenISO);
    byBiller.set(s.billerId, arr);
  }

  const out: SilenceItem[] = [];
  for (const biller of billers) {
    const expected = CADENCE_DAYS[biller.cadence];
    if (expected === null) continue;                       // irregular → no claim
    const dates = (byBiller.get(biller.id) ?? []).slice().sort();
    if (dates.length < minHistory) continue;               // not enough to know

    const lastSeenISO = dates[dates.length - 1];
    const lastMs = toMs(lastSeenISO);
    if (!Number.isFinite(lastMs)) continue;

    const daysQuiet = Math.floor((nowMs - lastMs) / dayMs);
    if (daysQuiet <= expected + SLACK_DAYS[biller.cadence]) continue;

    out.push({
      biller,
      lastSeenISO,
      daysQuiet,
      missedCycles: Math.max(1, Math.floor(daysQuiet / expected)),
    });
  }
  return out.sort((a, b) => (b.daysQuiet ?? 0) - (a.daysQuiet ?? 0));
}

export interface AmountDelta {
  currentCents: number;
  averageCents: number;
  pct: number;          // +38 means 38% above the trailing average
  samples: number;
}

// Percent difference against the biller's own trailing average.
//
// Returns null below `minSamples` — the learning-mode rule borrowed from I&W.
// A "+300%" derived from one prior month is noise dressed as a finding, and
// the first thing it would do is destroy trust in the ones that are real.
export function amountDelta(
  currentCents: number | null,
  priorCents: (number | null)[],
  minSamples = 3,
): AmountDelta | null {
  if (currentCents === null || !Number.isFinite(currentCents)) return null;
  const prior = priorCents.filter((c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0);
  if (prior.length < minSamples) return null;
  const averageCents = Math.round(prior.reduce((a, b) => a + b, 0) / prior.length);
  if (averageCents <= 0) return null;
  return {
    currentCents,
    averageCents,
    pct: Math.round(((currentCents - averageCents) / averageCents) * 100),
    samples: prior.length,
  };
}

// Only speak up when the move is big enough to act on. Utility bills swing
// seasonally; ±10% is weather, not a finding.
export const AMOUNT_ALERT_PCT = 15;
export const isAmountNotable = (d: AmountDelta | null): boolean =>
  d !== null && Math.abs(d.pct) >= AMOUNT_ALERT_PCT;

export interface DocumentRunway {
  doc: FamilyDocument;
  daysLeft: number;            // to the stated expiry
  actionableDaysLeft: number;  // to when it stops being usable (leadDays applied)
  level: "red" | "amber" | "calm";
}

// Runway on a declared document. `leadDays` is what makes this honest: a
// passport's printed expiry overstates its usable life, because most
// destinations demand six months' validity. Sorting and colour follow the
// ACTIONABLE date, not the printed one. When no lead was declared the type
// default applies (resolveLeadDays — 183 for a passport, 30 for a licence or
// registration), so the field only needs typing to override it.
export function documentRunway(docs: FamilyDocument[], nowMs: number): DocumentRunway[] {
  return docs
    .flatMap((doc): DocumentRunway[] => {
      const ms = toMs(doc.expiresISO);
      if (!Number.isFinite(ms)) return [];
      const daysLeft = Math.ceil((ms - nowMs) / dayMs);
      const actionableDaysLeft = daysLeft - resolveLeadDays(doc);
      const level: DocumentRunway["level"] =
        actionableDaysLeft <= 45 ? "red" : actionableDaysLeft <= 180 ? "amber" : "calm";
      return [{ doc, daysLeft, actionableDaysLeft, level }];
    })
    .sort((a, b) => a.actionableDaysLeft - b.actionableDaysLeft);
}

// Fraction of a one-year horizon still remaining, for the runway bar. Clamped
// so an expiry years out doesn't render as an empty track and read as urgent.
export function runwayPct(actionableDaysLeft: number, horizonDays = 365): number {
  if (actionableDaysLeft <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((actionableDaysLeft / horizonDays) * 100)));
}

// Never render a full account number. Bills quote them in the clear and there
// is no reason for the dashboard to repeat one.
export function maskAccount(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "····";
  return `····${digits.slice(-4)}`;
}

export function formatUsdCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Manual-pay first, then soonest due. The pane's question is "what will not
// pay itself", so an autopay item due tomorrow is less urgent than a manual
// one due next week.
export function sortBills<T extends { autopay: boolean; dueISO: string | null }>(bills: T[]): T[] {
  return [...bills].sort((a, b) => {
    if (a.autopay !== b.autopay) return a.autopay ? 1 : -1;
    return (a.dueISO ?? "9999-99-99").localeCompare(b.dueISO ?? "9999-99-99");
  });
}
