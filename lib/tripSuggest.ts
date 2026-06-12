import type { CalendarEvent } from "./types";
import { isGeocodable } from "./geocode";

// Detect a likely TDY/travel trip from calendar events, to offer as a one-tap
// "set as your current location?" in the Morning Brief. Pure + client-safe
// (no server imports) so it's unit-tested and runs in the modal.

export interface TripSuggestion {
  location: string;   // raw place to geocode
  label: string;      // short display
  startDate: string;  // YYYY-MM-DD (inclusive)
  endDate: string;    // YYYY-MM-DD (inclusive)
  eventId: string;
  eventTitle: string;
}

const TDY_RE = /\b(tdy|travel|trip|conference|offsite|off-site|symposium|summit|deploy|deployment|exercise|in-?brief|out-?brief)\b/i;

function ymd(s: string): string {
  return (s ?? "").slice(0, 10);
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// First event that looks like a stay somewhere (multi-day OR a travel keyword)
// with a geocodable location AND that covers `todayYmd`. Returns null otherwise.
export function suggestTrip(events: CalendarEvent[], todayYmd: string): TripSuggestion | null {
  const candidates = [...events].sort((a, b) => ymd(a.start).localeCompare(ymd(b.start)));
  for (const e of candidates) {
    const loc = (e.location ?? "").trim();
    if (!loc || !isGeocodable(loc)) continue;

    const startDate = ymd(e.start);
    let endDate = ymd(e.end) || startDate;
    // Google all-day events use an EXCLUSIVE end date — a Mon–Thu TDY ends
    // "Fri", so pull it back a day to get the real last day.
    if (e.isAllDay && endDate > startDate) endDate = addDays(endDate, -1);
    if (endDate < startDate) endDate = startDate;

    const multiDay = endDate > startDate;
    const keyworded = TDY_RE.test(e.title);
    if (!multiDay && !keyworded) continue;

    // Only suggest a trip that actually covers today.
    if (todayYmd < startDate || todayYmd > endDate) continue;

    return {
      location: loc,
      label: loc.split(/[,(]/)[0].trim().slice(0, 120) || loc.slice(0, 120),
      startDate,
      endDate,
      eventId: e.id,
      eventTitle: e.title,
    };
  }
  return null;
}
