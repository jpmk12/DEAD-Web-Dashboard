// Readers for daily series that were recorded and never read — PURE,
// client-safe, unit-tested. Each turns a `sensor_daily` series into ONE
// sentence a surface can carry, under the trend-learning disciplines:
// observed days, never calendar days; a learning floor before any claim (a
// tally, never a rate); and nothing here sets a level — a history read
// annotates the reading beside it.
//
//   elevatedHistory — outage:<country> (IODA), cfout:<iso2> (Cloudflare
//     Radar outages), bgp:<iso2> (Radar routing): is this country's trouble
//     new, recurring or chronic? Rendered on the country room's Digital card.
//   chatterLeadRead — chatter:<AOR> against the command's observed ADS-B lift
//     (warning_daily.mobility_count, max across its boards): does your
//     sources' lift chatter come BEFORE the surge, and how often is it not
//     followed by one? Rendered under the Glance lift-chatter lines.

import { classifyChronicity, type Chronicity } from "./chronicity";
import { dayDiff, precedes, type LeadResult, type SeriesPoint } from "./series";
import { MOBILITY_SURGE_FACTOR } from "./warningRules";

// ── Elevated-day history (outages, routing) ─────────────────────────────────
export const HISTORY_WINDOW_DAYS = 30;
/** A last record older than this is stated, not read as today. */
export const HISTORY_STALE_DAYS = 3;

export interface HistoryRead {
  source: string;
  state: Chronicity;
  daysElevated: number;
  daysObserved: number;
  /** The newest observed day — a read about the past, never about today. */
  lastDay: string;
  label: string;
}

/** History of one country's series for one source. `elevatedAt` is the
 *  ordinal that counts (2 = amber for every series this reads). Null when
 *  nothing is on record in the window — "no history yet", never "quiet". */
export function elevatedHistory(source: string, series: SeriesPoint[], today: string, elevatedAt = 2, windowDays = HISTORY_WINDOW_DAYS): HistoryRead | null {
  const pts = series.filter((p) => p.day <= today && Number.isFinite(dayDiff(p.day, today)) && dayDiff(p.day, today) < windowDays).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const c = classifyChronicity(pts.map((p) => ({ day: p.day, elevated: p.value >= elevatedAt })), last.value >= elevatedAt, last.day, { windowDays });
  const age = dayDiff(last.day, today);
  const stale = age > HISTORY_STALE_DAYS ? ` · last observed ${age} d ago` : "";
  let text: string;
  if (c.state === "quiet") text = `no elevated day in ${c.daysObserved} observed (${windowDays} d)`;
  else if (c.state === "unknown") text = `elevated · only ${c.daysObserved} day${c.daysObserved === 1 ? "" : "s"} of history`;
  else text = c.label ?? `${c.daysElevated} of ${c.daysObserved} observed days elevated`;
  return { source, state: c.state, daysElevated: c.daysElevated, daysObserved: c.daysObserved, lastDay: last.day, label: `${source}: ${text}${stale}` };
}

// ── Lift chatter vs the ADS-B surge ─────────────────────────────────────────
/** Prior observed days of lift before a day can be called a surge. */
export const SURGE_MIN_PRIOR = 7;
/** How far ahead of a surge chatter may sit and still count as leading it. */
export const CHATTER_LEAD_DAYS = 3;

/** Days whose observed lift exceeds the command's own trailing normal by
 *  the I&W surge rule (×MOBILITY_SURGE_FACTOR, floor mean+2) — over the
 *  prior observed days only, never the day itself. */
export function surgeDays(lift: SeriesPoint[], minPrior = SURGE_MIN_PRIOR, trailing = 30): string[] {
  const pts = lift.filter((p) => Number.isFinite(p.value)).sort((a, b) => (a.day < b.day ? -1 : 1));
  const out: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prior = pts.slice(Math.max(0, i - trailing), i);
    if (prior.length < minPrior) continue;
    const mean = prior.reduce((s, p) => s + p.value, 0) / prior.length;
    if (pts[i].value > Math.max(mean * MOBILITY_SURGE_FACTOR, mean + 2)) out.push(pts[i].day);
  }
  return out;
}

export interface ChatterLead {
  surges: number;
  chatterDays: number;
  lead: LeadResult | null;
  /** Chatter days whose window has closed with lift observed in it, and of
   *  those, how many saw no surge — the false-alarm count. */
  scored: number;
  unanswered: number;
  label: string;
}

/** Does chatter toward the command precede its ADS-B lift surges? A chatter
 *  day is one with ≥1 handle. A chatter day is scored only once its
 *  CHATTER_LEAD_DAYS window has closed AND lift was observed inside it — a
 *  window with no ADS-B record is ambiguous, never a miss. */
export function chatterLeadRead(chatter: SeriesPoint[], lift: SeriesPoint[], today: string): ChatterLead {
  const surges = surgeDays(lift);
  const chatterHit = chatter.filter((p) => p.value >= 1 && p.day <= today).map((p) => p.day);
  const lead = precedes(chatterHit, surges, CHATTER_LEAD_DAYS);
  const liftDays = new Set(lift.map((p) => p.day));
  let scored = 0;
  let unanswered = 0;
  for (const d of chatterHit) {
    if (dayDiff(d, today) <= CHATTER_LEAD_DAYS) continue;            // window still open
    const window = Array.from({ length: CHATTER_LEAD_DAYS + 1 }, (_, k) => addDays(d, k));
    if (!window.some((w) => liftDays.has(w))) continue;               // no ADS-B record — ambiguous
    scored++;
    if (!window.some((w) => surges.includes(w))) unanswered++;
  }
  const parts: string[] = [];
  if (lead) {
    const lag = lead.medianLeadDays == null ? "" : lead.medianLeadDays === 0 ? " (same day)" : ` (median lead ${lead.medianLeadDays} d)`;
    parts.push(`lift chatter preceded ${lead.hits} of ${lead.events} ADS-B surges${lag}`);
  }
  else parts.push(`chatter-vs-ADS-B read forming — ${surges.length} surge${surges.length === 1 ? "" : "s"} on record (3 before a read)`);
  if (scored) parts.push(`${unanswered} of ${scored} chatter day${scored === 1 ? "" : "s"} not followed by a surge within ${CHATTER_LEAD_DAYS} d`);
  return { surges: surges.length, chatterDays: chatterHit.length, lead, scored, unanswered, label: parts.join(" · ") };
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
