// Cultural / civil calendar for the Force Protection civil-diplomatic axis:
// windows that raise force-protection posture or sensitivity near a base —
// major religious observances (Ramadan, Eid, Hajj), national days, and
// elections. Pure data + date math (no network, no key), unit-tested.
//
// HONESTY: Islamic observance dates are moon-sighted and therefore APPROXIMATE
// (±1-2 days); they're tabled per year and must be refreshed annually. The
// elections table is intentionally EMPTY by default — election dates move and we
// will not fabricate them; populate CURATED_ELECTIONS as an operator step. The
// framework surfaces whatever real data is present and nothing it isn't.

export type CivilEventKind = "observance" | "national_day" | "election";

export interface CivilEvent {
  kind: CivilEventKind;
  label: string;
  start: string;      // YYYY-MM-DD (inclusive)
  end: string;        // YYYY-MM-DD (inclusive)
  daysUntil: number;  // <0 = already started/active, 0 = today, >0 = upcoming
  active: boolean;
}

// Countries (lowercased) where the Islamic calendar materially shapes ops tempo
// and force-protection posture. Loose-matched against a base's country.
const MUSLIM_MAJORITY = new Set([
  "afghanistan", "algeria", "azerbaijan", "bahrain", "bangladesh", "brunei", "burkina faso",
  "chad", "comoros", "djibouti", "egypt", "gambia", "guinea", "indonesia", "iran", "iraq",
  "jordan", "kazakhstan", "kuwait", "kyrgyzstan", "lebanon", "libya", "malaysia", "maldives",
  "mali", "mauritania", "morocco", "niger", "nigeria", "oman", "pakistan", "palestine", "qatar",
  "saudi arabia", "senegal", "somalia", "sudan", "syria", "tajikistan", "tunisia", "turkey",
  "türkiye", "turkmenistan", "united arab emirates", "uae", "uzbekistan", "yemen",
]);

// Approximate (moon-sighted) Islamic observance windows. UPDATE ANNUALLY.
const OBSERVANCES: { label: string; start: string; end: string }[] = [
  { label: "Ramadan (approx)",        start: "2026-02-18", end: "2026-03-19" },
  { label: "Eid al-Fitr (approx)",    start: "2026-03-20", end: "2026-03-22" },
  { label: "Hajj / Eid al-Adha (approx)", start: "2026-05-24", end: "2026-05-30" },
  { label: "Ramadan (approx)",        start: "2027-02-08", end: "2027-03-09" },
  { label: "Eid al-Fitr (approx)",    start: "2027-03-10", end: "2027-03-12" },
  { label: "Hajj / Eid al-Adha (approx)", start: "2027-05-14", end: "2027-05-19" },
];

// Fixed-date national days (recurring annually, MM-DD), for countries with a US
// force presence — demonstrations/heightened posture windows. Loose-matched.
const NATIONAL_DAYS: { country: string; label: string; md: string }[] = [
  { country: "united states", label: "US Independence Day", md: "07-04" },
  { country: "germany", label: "German Unity Day", md: "10-03" },
  { country: "france", label: "Bastille Day", md: "07-14" },
  { country: "qatar", label: "Qatar National Day", md: "12-18" },
  { country: "saudi arabia", label: "Saudi National Day", md: "09-23" },
  { country: "kuwait", label: "Kuwait National Day", md: "02-25" },
  { country: "bahrain", label: "Bahrain National Day", md: "12-16" },
  { country: "united arab emirates", label: "UAE National Day", md: "12-02" },
  { country: "japan", label: "Japan National Foundation Day", md: "02-11" },
  { country: "korea", label: "Korea Liberation Day", md: "08-15" },
  { country: "djibouti", label: "Djibouti Independence Day", md: "06-27" },
];

// Operator-populated upcoming national elections (YYYY-MM-DD). Empty by design —
// we won't fabricate dates. Add entries here (or wire a feed) to light them up.
const CURATED_ELECTIONS: { country: string; label: string; date: string }[] = [];

const DAY = 86_400_000;
const dayMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const ymdUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(the|of|republic|democratic|peoples?)\b/g, "").trim();
}
function countryMatch(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function mkEvent(kind: CivilEventKind, label: string, start: string, end: string, nowMs: number): CivilEvent {
  const startMs = dayMs(start), endMs = dayMs(end);
  const active = nowMs >= startMs - DAY && nowMs <= endMs + DAY;
  const daysUntil = Math.round((startMs - nowMs) / DAY);
  return { kind, label, start, end, daysUntil, active };
}

// Civil-calendar events for a country that are active now or begin within
// `lookaheadDays`. Sorted active-first then soonest.
export function civilCalendarEvents(country: string, nowMs: number, lookaheadDays = 21): CivilEvent[] {
  const out: CivilEvent[] = [];
  const horizon = nowMs + lookaheadDays * DAY;

  // Religious observances apply across Muslim-majority countries.
  if ([...MUSLIM_MAJORITY].some((c) => countryMatch(country, c))) {
    for (const o of OBSERVANCES) {
      const e = mkEvent("observance", o.label, o.start, o.end, nowMs);
      if (e.active || (dayMs(o.start) >= nowMs && dayMs(o.start) <= horizon)) out.push(e);
    }
  }

  // National days recur annually — resolve this year's and next year's instance.
  for (const nd of NATIONAL_DAYS) {
    if (!countryMatch(country, nd.country)) continue;
    const yr = new Date(nowMs).getUTCFullYear();
    for (const y of [yr, yr + 1]) {
      const date = `${y}-${nd.md}`;
      const e = mkEvent("national_day", nd.label, date, date, nowMs);
      if (e.active || (dayMs(date) >= nowMs && dayMs(date) <= horizon)) { out.push(e); break; }
    }
  }

  // Curated elections (exact dates).
  for (const el of CURATED_ELECTIONS) {
    if (!countryMatch(country, el.country)) continue;
    const e = mkEvent("election", el.label, el.date, el.date, nowMs);
    if (e.active || (dayMs(el.date) >= nowMs && dayMs(el.date) <= horizon)) out.push(e);
  }

  return out.sort((a, b) => (Number(b.active) - Number(a.active)) || (a.daysUntil - b.daysUntil));
}

export { ymdUTC };
