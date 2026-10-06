// Dates an email NAMES — offered to the user as chips, never assigned.
// PURE, client-safe, unit-tested (REVIEW-2026-10 F3).
//
// The extractor is right to leave a deadline undated when the email names
// an EVENT date but not the obligation's date ("Picture Day is October 15"
// says nothing about when the order is due). But the operator can decide
// that, and typing a date the email already printed is friction. This
// module finds the explicit calendar dates in a text so the Set-date menu
// can offer them with the sentence they came from. Relative phrases ("next
// Friday", "the 15th", "end of month") are deliberately NOT recognised —
// the same discipline as lib/familyDates: a date the app resolved is a date
// the app guessed.

export interface NamedDate {
  iso: string;      // yyyy-mm-dd
  /** The sentence (or clause) the date sits in, trimmed to ~90 chars. */
  phrase: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// "October 15", "Oct. 15th, 2026", "15 October", "15th Oct 2026", "10/15", "10/15/2026", "2026-10-15"
const PATTERNS: { re: RegExp; m: number; d: number; y?: number; iso?: boolean }[] = [
  { re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "gi"), m: 1, d: 2, y: 3 },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s*(\\d{4}))?\\b`, "gi"), m: 2, d: 1, y: 3 },
  { re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g, m: 1, d: 2, y: 3 },
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, m: 2, d: 3, y: 1, iso: true },
];

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** Pick the year that lands a year-less date inside [-60 d, +365 d] of today, leaning forward. */
function resolveYear(m: number, d: number, today: string): number | null {
  const ty = Number(today.slice(0, 4));
  const now = Date.parse(`${today}T00:00:00Z`);
  const candidates = [ty - 1, ty, ty + 1].filter((y) => valid(y, m, d));
  let best: number | null = null, bestDist = Infinity;
  for (const y of candidates) {
    const t = Date.UTC(y, m - 1, d);
    const delta = (t - now) / DAY;
    if (delta < -60 || delta > 365) continue;
    const dist = delta < 0 ? -delta + 200 : delta;   // a past date only when nothing ahead fits
    if (dist < bestDist) { best = y; bestDist = dist; }
  }
  return best;
}

function sentenceAround(text: string, idx: number, len: number): string {
  const start = Math.max(text.lastIndexOf(". ", idx), text.lastIndexOf("\n", idx), text.lastIndexOf("! ", idx), text.lastIndexOf("? ", idx));
  const from = start < 0 ? 0 : start + 2;
  const endCands = [text.indexOf(". ", idx + len), text.indexOf("\n", idx + len), text.indexOf("! ", idx + len)].filter((i) => i >= 0);
  const to = endCands.length ? Math.min(...endCands) + 1 : text.length;
  let s = text.slice(from, to).replace(/\s+/g, " ").trim();
  if (s.length > 90) {
    const rel = idx - from;
    const a = Math.max(0, rel - 40);
    s = (a > 0 ? "…" : "") + text.slice(from + a, from + a + 88).replace(/\s+/g, " ").trim() + "…";
  }
  return s;
}

/** Explicit calendar dates in `text`, in order of appearance, deduplicated, capped at 6. */
export function datesInText(text: string, today: string): NamedDate[] {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const out: NamedDate[] = [];
  const seen = new Set<string>();
  const found: { idx: number; iso: string; len: number }[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let mt: RegExpExecArray | null;
    while ((mt = p.re.exec(text))) {
      let m: number, d: number, y: number | null = null;
      if (p.iso) { y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3]); }
      else {
        const mraw = mt[p.m], draw = mt[p.d];
        m = /^\d+$/.test(mraw) ? Number(mraw) : (MONTHS[mraw.toLowerCase().replace(/\.$/, "")] ?? 0);
        d = Number(draw);
        const yraw = p.y !== undefined ? mt[p.y] : undefined;
        if (yraw) { y = Number(yraw); if (yraw.length === 2) y += 2000; }
      }
      if (!m || !d) continue;
      if (y === null) y = resolveYear(m, d, today);
      if (y === null || !valid(y, m, d)) continue;
      // A bare m/d like "10/15" is ambiguous in some locales; keep it only
      // when it reads as a plausible month/day.
      found.push({ idx: mt.index, iso: `${y}-${pad(m)}-${pad(d)}`, len: mt[0].length });
    }
  }
  found.sort((a, b) => a.idx - b.idx);
  for (const f of found) {
    if (seen.has(f.iso)) continue;
    seen.add(f.iso);
    out.push({ iso: f.iso, phrase: sentenceAround(text, f.idx, f.len) });
    if (out.length >= 6) break;
  }
  return out;
}
