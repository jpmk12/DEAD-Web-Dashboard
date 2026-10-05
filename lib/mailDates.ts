// Dates found in mail — PURE, client-safe, unit-tested (REVIEW-2026-10 C5).
//
// The email triage already reads every unread email with a model and writes
// a summary; it now returns one more field, `dates`, for emails that STATE
// a specific date or deadline — the Family-proposals trick: same call, no
// second call. This module validates what comes back and shapes it for the
// Calendar's "Dates in your mail" panel.
//
// Discipline: NEVER A GUESSED DATE. `when` survives only as an unambiguous
// calendar date (yyyy-mm-dd, optionally Thh:mm); a relative phrase ("next
// Friday", "end of month") comes back with `when: null` and renders as
// "open email". A date in the past or more than 400 days out is dropped.

import type { EmailMessage } from "./types";

/** What the triage model returns per email (untrusted). */
export interface MailDateRaw { when?: unknown; whenText?: unknown; what?: unknown }

export interface MailDate {
  id: string;            // `${messageId}:${n}`
  messageId: string;
  account: "primary" | "secondary";
  accountEmail: string;
  /** yyyy-mm-dd or yyyy-mm-ddThh:mm; null when the email's phrase was not anchored. */
  when: string | null;
  whenText: string;
  what: string;
  from: string;
  subject: string;
  /** The email's own date, for ordering and age. */
  date: string;
}

export const MAX_DATES_PER_EMAIL = 3;
export const MAX_DAYS_OUT = 400;
const WHEN_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

const clip = (v: unknown, n: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const dayNum = (ymd: string): number => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

/** Validate the model's `dates` for one email. */
export function normalizeMailDates(raw: unknown, email: Pick<EmailMessage, "id" | "account" | "accountEmail" | "from" | "subject" | "date">, today: string): MailDate[] {
  if (!Array.isArray(raw)) return [];
  const out: MailDate[] = [];
  const seen = new Set<string>();
  const todayN = dayNum(today);
  for (const r of raw as MailDateRaw[]) {
    if (!r || typeof r !== "object") continue;
    const what = clip(r.what, 120);
    const whenText = clip(r.whenText, 60);
    if (!what) continue;
    let when: string | null = null;
    const w = clip(r.when, 16);
    if (w && WHEN_RE.test(w)) {
      const n = dayNum(w.slice(0, 10));
      if (Number.isFinite(n) && n >= todayN && n - todayN <= MAX_DAYS_OUT) when = w;
      else continue; // a past or absurd date is not a date to add
    }
    if (!when && !whenText) continue;
    const key = `${when ?? whenText.toLowerCase()}|${what.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `${email.id}:${out.length}`, messageId: email.id, account: email.account, accountEmail: email.accountEmail,
      when, whenText: whenText || (when ?? ""), what, from: email.from, subject: email.subject, date: email.date,
    });
    if (out.length >= MAX_DATES_PER_EMAIL) break;
  }
  return out;
}

/** All dates across the loaded mail, dismissed ids removed, anchored first
 *  by date then unanchored by email recency. */
export function mailDatesFrom(emails: EmailMessage[], today: string, dismissed: Set<string>): MailDate[] {
  const all: MailDate[] = [];
  for (const e of emails) {
    if (!Array.isArray(e.dates) || e.dates.length === 0) continue;
    for (const d of normalizeMailDates(e.dates, e, today)) if (!dismissed.has(d.id)) all.push(d);
  }
  return all.sort((a, b) => {
    if (a.when && b.when) return a.when.localeCompare(b.when);
    if (a.when) return -1;
    if (b.when) return 1;
    return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
  });
}

/** The event plan for a mail date: all-day for a bare date, 30 minutes for a
 *  dated time. Wall-clock strings in the effective zone; the route attaches it. */
export function eventPlanFor(d: MailDate): { summary: string; start: string; end: string } | null {
  if (!d.when) return null;
  if (d.when.length === 10) {
    const n = dayNum(d.when);
    return { summary: d.what, start: d.when, end: new Date((n + 1) * 86_400_000).toISOString().slice(0, 10) };
  }
  const [date, hm] = d.when.split("T");
  const [h, m] = hm.split(":").map(Number);
  const endMin = h * 60 + m + 30;
  const endDate = endMin >= 1440 ? new Date((dayNum(date) + 1) * 86_400_000).toISOString().slice(0, 10) : date;
  const eh = Math.floor((endMin % 1440) / 60), em = endMin % 60;
  return { summary: d.what, start: `${d.when}:00`, end: `${endDate}T${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}:00` };
}

/** A short "from" for the row: display name or local part. */
export function senderShort(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  const at = from.indexOf("@");
  return at > 0 ? from.slice(0, at) : from;
}
