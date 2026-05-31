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
