// The "Julian date" of military scheduling — the ordinal day of the year
// (001–366), computed on the instant's LOCAL calendar day in the given zone
// (the device's when none is given). Not the astronomical Julian Day Number;
// the three-digit day is what a flying schedule prints. PURE, tested.
export function dayOfYear(d: Date, tz?: string): number {
  let y: number, m: number, day: number;
  if (tz) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    y = get("year"); m = get("month"); day = get("day");
  } else {
    y = d.getFullYear(); m = d.getMonth() + 1; day = d.getDate();
  }
  const start = Date.UTC(y, 0, 1);
  const here = Date.UTC(y, m - 1, day);
  return Math.round((here - start) / 86_400_000) + 1;
}

/** The day of year as the three-digit form a schedule prints ("300", "007"). */
export function julianDayLabel(d: Date, tz?: string): string {
  return String(dayOfYear(d, tz)).padStart(3, "0");
}

// Today's date as YYYY-MM-DD in the given IANA timezone. Used as a daily cache
// key so a value generated at 06:00 still resolves to the same date at 22:00.
// Shared by the briefing and news-overview caches so they key dates identically.
export function todayInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Render a timed event's ISO instant in the user's timezone. Without a timeZone,
// formatting falls back to the server's tz (UTC in production), which shifts
// times — e.g. 08:30 CDT shown as 13:30. Always pass the user's tz for anything
// the user reads.
export function formatInTz(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// Time-only ("8:30 AM") in the user's tz — for an event's end time.
export function timeInTz(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// All-day events carry a floating date-only string ("2026-06-17") with no time.
// Render it from its own components (UTC), never shifted into a local tz — doing
// so would slide an all-day event onto the previous day.
export function formatFloatingDate(iso: string): string {
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return iso;
  }
}

// Long "Wednesday, June 17, 2026" for today in the user's tz (prompt headers).
export function longDateInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}
