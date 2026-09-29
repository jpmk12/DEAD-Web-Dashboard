// Indicator calibration — the decision log feeding back into the board.
//
// PURE, client-safe, unit-tested. `warning_decisions` records calls against
// a problem and, optionally, against ONE indicator. Once enough of those are
// scored, the hit rate is per-indicator, which means the log can finally say
// which indicators are earning their place. This module turns the scored
// entries into proposals: an indicator you keep being wrong about is flagged
// for down-weighting; one you are reliably right about is named as earning
// its weight. Nothing is changed automatically — the board proposes, the
// analyst disposes, the same rule the whole I&W surface is built on, and the
// same shape as the watchlist's drop suggestions (every row carries its
// evidence; below a floor there is no claim at all).
//
// What this is honest about: a self-scored prediction is weak evidence, and
// the per-indicator sample is smaller than the board's. So the floor here is
// the board's MIN_SCORED_FOR_RATE applied PER INDICATOR, and ambiguous
// outcomes are reported but never counted either way — a log that is mostly
// ambiguous means the expectations are not sharp enough, and that is the
// finding, not a calibration signal.

import { hitRate, MIN_SCORED_FOR_RATE, type DecisionEntry, type HitRate } from "./decisionLog";

export type CalibrationVerdict = "downweight" | "earning" | "forming";

export interface IndicatorCalibration {
  indicatorId: string;
  hit: HitRate;
  verdict: CalibrationVerdict;
  /** One sentence the UI can render as-is — the evidence for the verdict. */
  evidence: string;
}

/** Below this hit rate (right / decided), with the floor met, the indicator
 *  is proposed for down-weighting. Deliberately generous: a coin-flip
 *  indicator is still a coin flip, and the point is to surface the ones that
 *  are worse than that. */
export const DOWNWEIGHT_BELOW = 0.4;
/** At or above this, with the floor met, the indicator is named as earning
 *  its weight. The band between is neither — calibration says nothing. */
export const EARNING_AT = 0.7;

/** Per-indicator calibration from a problem's decision entries. Whole-board
 *  calls (indicatorId null) are excluded — they say nothing about any ONE
 *  indicator. Indicators with no scored call are omitted: absence of data is
 *  not evidence, in either direction. Sorted so proposals lead: down-weight
 *  first, then earning, then forming; ties by most decided. */
export function calibrateIndicators(
  entries: DecisionEntry[],
  opts: { minScored?: number } = {},
): IndicatorCalibration[] {
  const minScored = opts.minScored ?? MIN_SCORED_FOR_RATE;
  const byInd = new Map<string, DecisionEntry[]>();
  for (const e of entries) {
    if (!e.indicatorId || e.outcome === null) continue;
    const arr = byInd.get(e.indicatorId) ?? [];
    arr.push(e);
    byInd.set(e.indicatorId, arr);
  }
  const out: IndicatorCalibration[] = [];
  for (const [indicatorId, list] of byInd) {
    const hit = hitRate(list, { minScored });
    const amb = hit.ambiguous > 0 ? `, ${hit.ambiguous} ambiguous` : "";
    if (hit.rate === null) {
      out.push({
        indicatorId, hit, verdict: "forming",
        evidence: `${hit.right} of ${hit.decided} decided calls right${amb} — ${Math.max(0, minScored - hit.decided)} more decided call${minScored - hit.decided === 1 ? "" : "s"} before calibration says anything.`,
      });
      continue;
    }
    const pct = Math.round(hit.rate * 100);
    if (hit.rate < DOWNWEIGHT_BELOW) {
      out.push({
        indicatorId, hit, verdict: "downweight",
        evidence: `Right ${hit.right} of ${hit.decided} scored calls (${pct}%${amb}) — below ${Math.round(DOWNWEIGHT_BELOW * 100)}%. Consider down-weighting or sharpening its falsifier.`,
      });
    } else if (hit.rate >= EARNING_AT) {
      out.push({
        indicatorId, hit, verdict: "earning",
        evidence: `Right ${hit.right} of ${hit.decided} scored calls (${pct}%${amb}) — earning its weight.`,
      });
    } else {
      out.push({
        indicatorId, hit, verdict: "forming",
        evidence: `Right ${hit.right} of ${hit.decided} scored calls (${pct}%${amb}) — neither strong nor weak yet.`,
      });
    }
  }
  const rank: Record<CalibrationVerdict, number> = { downweight: 0, earning: 1, forming: 2 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.hit.decided - a.hit.decided || a.indicatorId.localeCompare(b.indicatorId));
}

/** Only the rows that ask for a decision — what the board shows by default. */
export function calibrationProposals(rows: IndicatorCalibration[]): IndicatorCalibration[] {
  return rows.filter((r) => r.verdict === "downweight");
}
