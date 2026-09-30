// Team state rows — server-only CRUD. Judgement lives in lib/crewState.ts.
// Shared, crew-maintained, attributed by email (the sitrep_limfacs model).

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import type { CrewRow } from "./crewState";

interface Row extends RowDataPacket {
  qual: string; label: string; total: number; crew_rest: number; on_mission: number; dnif: number; other: number;
  note: string | null; sort: number; updated_by: string | null; updated_at: Date;
}

const toRow = (r: Row): CrewRow => ({
  qual: r.qual, label: r.label, total: Number(r.total), crewRest: Number(r.crew_rest), onMission: Number(r.on_mission),
  dnif: Number(r.dnif), other: Number(r.other), note: r.note, sort: Number(r.sort), updatedBy: r.updated_by,
  updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
});

export async function listCrewRows(): Promise<CrewRow[]> {
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>("SELECT * FROM crew_state ORDER BY sort ASC, qual ASC");
  return rows.map(toRow);
}

const QUAL_RX = /^[A-Za-z0-9][A-Za-z0-9 _/-]{0,31}$/;
const cnt = (v: unknown): number => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x >= 0 ? Math.min(999, x) : 0; };

export function validQual(q: unknown): q is string { return typeof q === "string" && QUAL_RX.test(q.trim()); }

export async function upsertCrewRow(input: {
  qual: string; label?: string; total: number; crewRest: number; onMission: number; dnif: number; other: number;
  note?: string | null; sort?: number; by: string;
}): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO crew_state (qual, label, total, crew_rest, on_mission, dnif, other, note, sort, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE label = VALUES(label), total = VALUES(total), crew_rest = VALUES(crew_rest), on_mission = VALUES(on_mission),
       dnif = VALUES(dnif), other = VALUES(other), note = VALUES(note), sort = VALUES(sort), updated_by = VALUES(updated_by), updated_at = NOW(3)`,
    [
      input.qual.trim().slice(0, 32), (input.label ?? "").trim().slice(0, 80),
      cnt(input.total), cnt(input.crewRest), cnt(input.onMission), cnt(input.dnif), cnt(input.other),
      input.note ? String(input.note).trim().slice(0, 200) : null, cnt(input.sort ?? 0), input.by.slice(0, 255),
    ],
  );
}

// ── History (PLAN §6 D2) ─────────────────────────────────────────────────────
// The day's LAST counts per qual. Called after every upsert, from the crew
// GET and by the daily heartbeat, so the series exists on days nobody edits.
export async function snapshotCrewDay(rows: CrewRow[], day = new Date().toISOString().slice(0, 10)): Promise<void> {
  if (!rows.length) return;
  const pool = await getDb();
  const placeholders: string[] = [];
  const values: (string | number)[] = [];
  for (const r of rows) {
    placeholders.push("(?, ?, ?, ?, ?, ?, ?)");
    values.push(day, r.qual.slice(0, 32), cnt(r.total), cnt(r.crewRest), cnt(r.onMission), cnt(r.dnif), cnt(r.other));
  }
  await pool.execute(
    `INSERT INTO crew_state_daily (day, qual, total, crew_rest, on_mission, dnif, other) VALUES ${placeholders.join(", ")}
     ON DUPLICATE KEY UPDATE total = VALUES(total), crew_rest = VALUES(crew_rest), on_mission = VALUES(on_mission), dnif = VALUES(dnif), other = VALUES(other)`,
    values,
  );
}

interface DayRow extends RowDataPacket { day: string; qual: string; total: number; crew_rest: number; on_mission: number; dnif: number; other: number }

export async function getCrewHistory(days = 60): Promise<{ day: string; qual: string; total: number; crewRest: number; onMission: number; dnif: number; other: number }[]> {
  const pool = await getDb();
  const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const [rows] = await pool.query<DayRow[]>(`SELECT * FROM crew_state_daily WHERE day >= ? ORDER BY day ASC`, [cutoff]);
  return rows.map((r) => ({ day: String(r.day), qual: r.qual, total: Number(r.total), crewRest: Number(r.crew_rest), onMission: Number(r.on_mission), dnif: Number(r.dnif), other: Number(r.other) }));
}

export async function deleteCrewRow(qual: string): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM crew_state WHERE qual = ?", [qual.trim().slice(0, 32)]);
}
