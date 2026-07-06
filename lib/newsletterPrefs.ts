import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { isOwner } from "./allowlist";

export interface NewsletterPrefs {
  openCounts: Record<string, number>;
  feedback: Record<string, "useful" | "not_useful">;
  // Cross-device hide/keep sets — newsletter (Gmail message) ids the user has
  // dismissed or pinned. Persisted server-side so the state follows the user
  // between desktop and mobile. Bounded (see CAP) since ids age out.
  dismissed: string[];
  kept: string[];
  lastUpdated: string;
}

// Newsletters are fetched newer_than:7d, so ids older than the most recent few
// hundred are never matched again — keep the lists bounded.
const ID_SET_CAP = 400;

// Extract series name so daily variants ("MORNING DEFENSE: May 18" and
// "MORNING DEFENSE: May 17") share the same preference key.
// Only splits on colon, pipe, em-dash, or a hyphen surrounded by spaces —
// not on hyphens mid-word (e.g. "F-35", "B-52").
export function normalizeSubject(subject: string): string {
  return subject
    .split(/[:\|–]|\s+-\s+/)[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

interface PrefsRow extends RowDataPacket {
  open_counts: Record<string, number> | null;
  feedback: Record<string, "useful" | "not_useful"> | null;
  dismissed: string[] | null;
  kept: string[] | null;
  last_updated: Date;
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asNumRecord(v: unknown): Record<string, number> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) {
      if (typeof n === "number") out[k] = n;
    }
    return out;
  }
  return {};
}

function asFeedback(v: unknown): Record<string, "useful" | "not_useful"> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, "useful" | "not_useful"> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === "useful" || val === "not_useful") out[k] = val;
    }
    return out;
  }
  return {};
}

let writeQueue: Promise<void> = Promise.resolve();

async function readPrefsRaw(email: string): Promise<NewsletterPrefs> {
  const pool = await getDb();
  const [rows] = await pool.query<PrefsRow[]>(
    "SELECT open_counts, feedback, dismissed, kept, last_updated, user_email FROM newsletter_prefs WHERE user_email IN (?, '')",
    [email]
  );
  const row = (rows as (typeof rows[number] & { user_email?: string })[]).find((r) => r.user_email === email)
    ?? (isOwner(email) ? (rows as (typeof rows[number] & { user_email?: string })[]).find((r) => r.user_email === "") : undefined);
  if (!row) {
    return { openCounts: {}, feedback: {}, dismissed: [], kept: [], lastUpdated: new Date(0).toISOString() };
  }
  return {
    openCounts: asNumRecord(row.open_counts),
    feedback: asFeedback(row.feedback),
    dismissed: asStrArray(row.dismissed),
    kept: asStrArray(row.kept),
    lastUpdated: row.last_updated.toISOString(),
  };
}

export async function readPrefs(email: string): Promise<NewsletterPrefs> {
  await writeQueue;
  return readPrefsRaw(email);
}

async function writePrefs(email: string, prefs: NewsletterPrefs): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO newsletter_prefs (id, user_email, open_counts, feedback, dismissed, kept, last_updated)
     VALUES (1, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       open_counts  = VALUES(open_counts),
       feedback     = VALUES(feedback),
       dismissed    = VALUES(dismissed),
       kept         = VALUES(kept),
       last_updated = VALUES(last_updated)`,
    [email, JSON.stringify(prefs.openCounts), JSON.stringify(prefs.feedback), JSON.stringify(prefs.dismissed), JSON.stringify(prefs.kept), new Date()]
  );
}

async function updatePrefs(
  email: string,
  updater: (prefs: NewsletterPrefs) => NewsletterPrefs
): Promise<void> {
  const next = writeQueue.then(async () => {
    const current = await readPrefsRaw(email);
    const updated = { ...updater(current), lastUpdated: new Date().toISOString() };
    await writePrefs(email, updated);
  });
  writeQueue = next.catch((err) => {
    console.error("Failed to persist newsletter preferences:", err);
  });
  return next;
}

export async function recordOpen(email: string, subject: string): Promise<void> {
  const key = normalizeSubject(subject);
  if (!key) return;
  await updatePrefs(email, (prefs) => ({
    ...prefs,
    openCounts: { ...prefs.openCounts, [key]: (prefs.openCounts[key] ?? 0) + 1 },
  }));
}

// A "deep dive" — the user clicked through to read the original email in Gmail —
// is a much stronger interest signal than merely expanding the summary, so it
// contributes a heavier weight to the series' engagement score. Folding it into
// openCounts means it flows through sortByPreference, buildPrefsContext's
// top-series list, and the quiet-series pruning with no further changes.
const DEEP_DIVE_WEIGHT = 3;

export async function recordDeepDive(email: string, subject: string): Promise<void> {
  const key = normalizeSubject(subject);
  if (!key) return;
  await updatePrefs(email, (prefs) => ({
    ...prefs,
    openCounts: { ...prefs.openCounts, [key]: (prefs.openCounts[key] ?? 0) + DEEP_DIVE_WEIGHT },
  }));
}

export async function recordFeedback(
  email: string,
  id: string,
  value: "useful" | "not_useful"
): Promise<void> {
  await updatePrefs(email, (prefs) => ({
    ...prefs,
    feedback: { ...prefs.feedback, [id]: value },
  }));
}

// Add/remove an id from the hide or keep set (most-recent-kept, capped). `on`
// adds, `!on` removes. Returns once persisted so the write is durable.
function toggleIdSet(email: string, field: "dismissed" | "kept", id: string, on: boolean): Promise<void> {
  if (!id) return Promise.resolve();
  return updatePrefs(email, (prefs) => {
    const without = (prefs[field] ?? []).filter((x) => x !== id);
    const next = on ? [...without, id].slice(-ID_SET_CAP) : without;
    return { ...prefs, [field]: next };
  });
}

export const setDismissed = (email: string, id: string, on: boolean) => toggleIdSet(email, "dismissed", id, on);
export const setKept = (email: string, id: string, on: boolean) => toggleIdSet(email, "kept", id, on);

export function buildPrefsContext(prefs: NewsletterPrefs): string {
  const topSeries = Object.entries(prefs.openCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([s]) => s);

  const usefulCount = Object.values(prefs.feedback).filter((v) => v === "useful").length;
  const notUsefulCount = Object.values(prefs.feedback).filter((v) => v === "not_useful").length;

  if (topSeries.length === 0 && usefulCount === 0) return "";

  const parts: string[] = [];
  if (topSeries.length > 0)
    parts.push(`frequently reads: "${topSeries.join('", "')}"`);
  if (usefulCount > 0) parts.push(`${usefulCount} newsletter(s) rated useful`);
  if (notUsefulCount > 0) parts.push(`${notUsefulCount} newsletter(s) rated not useful`);

  return `\n\nUser engagement history — ${parts.join("; ")}. Prioritise bullets on topics matching these interests.`;
}

export function sortByPreference<T extends { subject: string }>(
  newsletters: T[],
  prefs: NewsletterPrefs
): T[] {
  return [...newsletters].sort((a, b) => {
    const scoreA = prefs.openCounts[normalizeSubject(a.subject)] ?? 0;
    const scoreB = prefs.openCounts[normalizeSubject(b.subject)] ?? 0;
    return scoreB - scoreA;
  });
}
