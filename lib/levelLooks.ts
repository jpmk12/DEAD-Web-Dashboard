// Server door for the stored looks behind the OE delta (see lib/oeDelta.ts
// rollLook). `look(email, surface, series, { write })`: reads the stored look,
// rolls it with the levels now, writes it back when `write` (the Glance card
// and the command board — a user looking), and returns the delta. Read-only
// callers (the assistant, Ask) pass write:false: the assistant reading the
// picture is not the user looking at it. A dead table degrades to the old
// "since yesterday" read, never to an error.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { deltaAgainstLook, levelSnapshot, rollLook, type LevelSeries, type LevelSnapshot, type LookState } from "./oeDelta";

export type LookSurface = "oe" | "osint";

function parse(v: unknown): LevelSnapshot | null {
  if (v == null) return null;
  try {
    const o = typeof v === "string" ? JSON.parse(v) : v;
    return o && typeof o === "object" ? (o as LevelSnapshot) : null;
  } catch { return null; }
}

async function readLook(email: string, surface: LookSurface): Promise<LookState | null> {
  const pool = await getDb();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT last_look_at, last_levels, baseline_at, baseline FROM level_looks WHERE user_email = ? AND surface = ?",
    [email, surface],
  );
  const r = rows[0];
  if (!r) return null;
  const lastLevels = parse(r.last_levels);
  if (!lastLevels) return null;
  return { lastLookAt: Number(r.last_look_at), lastLevels, baselineAt: r.baseline_at == null ? null : Number(r.baseline_at), baseline: parse(r.baseline) };
}

async function saveLook(email: string, surface: LookSurface, s: LookState): Promise<void> {
  const pool = await getDb();
  await pool.query(
    `INSERT INTO level_looks (user_email, surface, last_look_at, last_levels, baseline_at, baseline)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE last_look_at = VALUES(last_look_at), last_levels = VALUES(last_levels),
       baseline_at = VALUES(baseline_at), baseline = VALUES(baseline)`,
    [email, surface, s.lastLookAt, JSON.stringify(s.lastLevels), s.baselineAt, s.baseline ? JSON.stringify(s.baseline) : null],
  );
}

export async function lookDelta(
  email: string,
  surface: LookSurface,
  series: LevelSeries[],
  opts: { write: boolean; max?: number; nowMs?: number },
) {
  const now = opts.nowMs ?? Date.now();
  let state: LookState | null = null;
  let stored = true;
  try { state = await readLook(email, surface); } catch { stored = false; }
  const { compareWith, next } = rollLook(state, levelSnapshot(series), now);
  if (opts.write && stored) saveLook(email, surface, next).catch((e) => console.error("level look save failed:", e instanceof Error ? e.message : e));
  return deltaAgainstLook(series, compareWith, now, { max: opts.max });
}
