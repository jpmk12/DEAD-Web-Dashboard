import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";

export interface NewsletterPrefs {
  openCounts: Record<string, number>;
  feedback: Record<string, "useful" | "not_useful">;
  lastUpdated: string;
}

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
  last_updated: Date;
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

async function readPrefsRaw(): Promise<NewsletterPrefs> {
  const pool = await getDb();
  const [rows] = await pool.query<PrefsRow[]>(
    "SELECT open_counts, feedback, last_updated FROM newsletter_prefs WHERE id = 1"
  );
  if (rows.length === 0) {
    return { openCounts: {}, feedback: {}, lastUpdated: new Date(0).toISOString() };
  }
  return {
    openCounts: asNumRecord(rows[0].open_counts),
    feedback: asFeedback(rows[0].feedback),
    lastUpdated: rows[0].last_updated.toISOString(),
  };
}

export async function readPrefs(): Promise<NewsletterPrefs> {
  await writeQueue;
  return readPrefsRaw();
}

async function writePrefs(prefs: NewsletterPrefs): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO newsletter_prefs (id, open_counts, feedback, last_updated)
     VALUES (1, CAST(? AS JSON), CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE
       open_counts  = VALUES(open_counts),
       feedback     = VALUES(feedback),
       last_updated = VALUES(last_updated)`,
    [JSON.stringify(prefs.openCounts), JSON.stringify(prefs.feedback), new Date()]
  );
}

async function updatePrefs(
  updater: (prefs: NewsletterPrefs) => NewsletterPrefs
): Promise<void> {
  const next = writeQueue.then(async () => {
    const current = await readPrefsRaw();
    const updated = { ...updater(current), lastUpdated: new Date().toISOString() };
    await writePrefs(updated);
  });
  writeQueue = next.catch((err) => {
    console.error("Failed to persist newsletter preferences:", err);
  });
  return next;
}

export async function recordOpen(subject: string): Promise<void> {
  const key = normalizeSubject(subject);
  if (!key) return;
  await updatePrefs((prefs) => ({
    ...prefs,
    openCounts: { ...prefs.openCounts, [key]: (prefs.openCounts[key] ?? 0) + 1 },
  }));
}

export async function recordFeedback(
  id: string,
  value: "useful" | "not_useful"
): Promise<void> {
  await updatePrefs((prefs) => ({
    ...prefs,
    feedback: { ...prefs.feedback, [id]: value },
  }));
}

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
