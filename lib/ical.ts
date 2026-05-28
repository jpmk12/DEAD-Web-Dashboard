import { CalendarEvent } from "./types";

// RFC 5545 iCalendar (.ics) generator. Keeps the surface intentionally small —
// VCALENDAR wrapper + one VEVENT per CalendarEvent, with proper escaping and
// line folding so feeds are accepted by Apple Calendar / iOS Calendar / Outlook.

export interface IcalOptions {
  calendarName?: string; // X-WR-CALNAME
  productId?: string;    // PRODID
  defaultTimeZone?: string; // X-WR-TIMEZONE + TZID for timed events without offset
}

// Escape RFC 5545 TEXT values: backslash, comma, semicolon, newline.
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// Fold content lines at 75 octets per RFC 5545 §3.1 (continuation lines start
// with a single space). Counts bytes, not characters, so multi-byte UTF-8 is
// safe.
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf-8");
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  // First chunk: 75 bytes
  let end = Math.min(75, bytes.length);
  out.push(bytes.subarray(start, end).toString("utf-8"));
  start = end;
  // Subsequent chunks: 74 bytes (1 byte for the leading space)
  while (start < bytes.length) {
    end = Math.min(start + 74, bytes.length);
    out.push(" " + bytes.subarray(start, end).toString("utf-8"));
    start = end;
  }
  return out.join("\r\n");
}

// Stable UID: hash of (id || iCalUID-equivalent) + start. Avoids regenerating
// new UIDs on every fetch, which would make subscribers duplicate events.
function uidFor(event: CalendarEvent): string {
  const seed = `${event.id || ""}::${event.start || ""}`;
  // Simple FNV-1a 32-bit — collision-resistant enough for a personal calendar.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `${h.toString(16)}@dead-dashboard`;
}

// Format Date as RFC 5545 UTC: YYYYMMDDTHHmmssZ
function fmtUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// Format a YYYY-MM-DD date as RFC 5545 DATE: YYYYMMDD (for VALUE=DATE all-day events)
function fmtDateOnly(isoDate: string): string {
  // Accept either "2026-05-20" or "2026-05-20T..."
  return isoDate.slice(0, 10).replace(/-/g, "");
}

// Format an ISO timestamp as local-with-TZID: YYYYMMDDTHHmmss (no Z)
function fmtLocal(iso: string): string {
  // Strip non-digit chars after splitting on T: keep YYYYMMDDTHHmmss
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return fmtUtc(new Date(iso));
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}`;
}

function dtStartEnd(event: CalendarEvent, tz: string): string[] {
  // All-day events: start/end are date-only strings (YYYY-MM-DD)
  if (event.isAllDay || !event.start.includes("T")) {
    return [
      `DTSTART;VALUE=DATE:${fmtDateOnly(event.start)}`,
      `DTEND;VALUE=DATE:${fmtDateOnly(event.end)}`,
    ];
  }
  // Timed event. If the ISO carries an offset (Z or ±HH:MM), express in UTC.
  // Otherwise, use TZID so the consumer interprets it in the local timezone.
  const hasOffset = (s: string) => /Z$|[+-]\d{2}:\d{2}$/.test(s);
  if (hasOffset(event.start)) {
    return [
      `DTSTART:${fmtUtc(new Date(event.start))}`,
      `DTEND:${fmtUtc(new Date(event.end))}`,
    ];
  }
  return [
    `DTSTART;TZID=${tz}:${fmtLocal(event.start)}`,
    `DTEND;TZID=${tz}:${fmtLocal(event.end)}`,
  ];
}

export function generateIcal(events: CalendarEvent[], opts: IcalOptions = {}): string {
  const tz = opts.defaultTimeZone || "UTC";
  const name = opts.calendarName || "DEAD’s Dashboard";
  const prodId = opts.productId || "-//DEAD Dashboard//EN";
  const now = fmtUtc(new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${tz}`,
  ];

  for (const event of events) {
    if (!event.start || !event.end) continue;

    const parts: string[] = [
      "BEGIN:VEVENT",
      `UID:${uidFor(event)}`,
      `DTSTAMP:${now}`,
      ...dtStartEnd(event, tz),
      `SUMMARY:${escapeText(event.title || "Untitled Event")}`,
    ];
    if (event.location) parts.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) parts.push(`DESCRIPTION:${escapeText(event.description)}`);
    parts.push("END:VEVENT");

    lines.push(...parts);
  }
  lines.push("END:VCALENDAR");

  // Fold each line and join with CRLF (RFC 5545 §3.1 requires CRLF).
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
