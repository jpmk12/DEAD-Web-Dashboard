// Day-over-day Force Protection posture history → "what changed since yesterday".
// Keyed on a STABLE entry key (country name / base label), not the prefs id
// (which is timestamped and changes on re-add), so a country's history survives
// edits. Best-effort: every failure degrades to "no delta", never throws.

import { getDb } from "./db";
import type { RowDataPacket } from "mysql2";
import type { ForceAssessment, Severity } from "./forceProtection";

const todayUTC = () => new Date().toISOString().slice(0, 10);

// Stable key: country watches by country, bases by label (both lowercased).
export function postureKey(a: Pick<ForceAssessment, "kind" | "country" | "label">): string {
  return a.kind === "country" ? `c:${a.country.toLowerCase().trim()}` : `b:${a.label.toLowerCase().trim()}`;
}

// Most-recent composite recorded on a day BEFORE today, per entry key.
export async function getPreviousComposites(): Promise<Record<string, Severity>> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.entry_key, t.composite
         FROM force_posture_daily t
         JOIN (SELECT entry_key, MAX(day) AS mday FROM force_posture_daily WHERE day < ? GROUP BY entry_key) m
           ON t.entry_key = m.entry_key AND t.day = m.mday`,
      [todayUTC()],
    );
    const out: Record<string, Severity> = {};
    for (const r of rows) out[String(r.entry_key)] = String(r.composite) as Severity;
    return out;
  } catch {
    return {};
  }
}

// Upsert today's composite for each assessment (idempotent per day).
export async function recordPosture(assessments: ForceAssessment[]): Promise<void> {
  if (assessments.length === 0) return;
  try {
    const pool = await getDb();
    const day = todayUTC();
    const values: (string)[] = [];
    const placeholders: string[] = [];
    for (const a of assessments) {
      placeholders.push("(?, ?, ?, ?, ?)");
      values.push(day, postureKey(a), a.label.slice(0, 80), a.cocom.slice(0, 16), a.composite);
    }
    await pool.execute(
      `INSERT INTO force_posture_daily (day, entry_key, label, cocom, composite)
         VALUES ${placeholders.join(", ")}
       ON DUPLICATE KEY UPDATE composite = VALUES(composite), label = VALUES(label), cocom = VALUES(cocom)`,
      values,
    );
  } catch {
    /* best-effort — a recording failure must never break the board */
  }
}
