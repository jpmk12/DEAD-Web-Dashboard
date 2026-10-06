// Server-only store for the running brief per family member
// (`family_person_brief`, REVIEW-2026-10 F4). The pure judgement — what is
// new, what to send the model — lives in lib/family.ts; this only reads and
// writes rows.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";

export interface PersonBrief {
  personId: string;
  summary: string;
  whatsNew: string;
  /** Message ids the brief has incorporated. */
  sourceIds: string[];
  updatedAt: number;
}

interface Row extends RowDataPacket { person_id: string; summary: string; whats_new: string | null; source_ids: unknown; updated_at: number }

export async function getPersonBriefs(userEmail: string): Promise<Map<string, PersonBrief>> {
  const out = new Map<string, PersonBrief>();
  if (!userEmail) return out;
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(`SELECT person_id, summary, whats_new, source_ids, updated_at FROM family_person_brief WHERE user_email = ?`, [userEmail]);
    for (const r of rows) {
      out.set(r.person_id, {
        personId: r.person_id, summary: r.summary ?? "", whatsNew: r.whats_new ?? "",
        sourceIds: Array.isArray(r.source_ids) ? (r.source_ids as unknown[]).filter((x): x is string => typeof x === "string") : [],
        updatedAt: Number(r.updated_at) || 0,
      });
    }
  } catch { /* best-effort: no store = no previous brief */ }
  return out;
}

export async function savePersonBriefs(userEmail: string, briefs: PersonBrief[]): Promise<void> {
  if (!userEmail || !briefs.length) return;
  try {
    const pool = await getDb();
    const placeholders = briefs.map(() => "(?, ?, ?, ?, CAST(? AS JSON), ?)").join(",");
    const values: (string | number | null)[] = [];
    for (const b of briefs) values.push(userEmail, b.personId, b.summary.slice(0, 2000), b.whatsNew ? b.whatsNew.slice(0, 600) : null, JSON.stringify(b.sourceIds.slice(-300)), b.updatedAt);
    await pool.query(
      `INSERT INTO family_person_brief (user_email, person_id, summary, whats_new, source_ids, updated_at) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE summary = VALUES(summary), whats_new = VALUES(whats_new), source_ids = VALUES(source_ids), updated_at = VALUES(updated_at)`,
      values,
    );
  } catch (err) {
    console.error("family brief write failed:", err);
  }
}
