// Numeric sensor series — server-only. One value per sensor key per UTC day.
// The key namespace and each key's DAY POLICY live in lib/sensorKeys.ts
// (pure): `peak` keeps the day's highest value on duplicate writes (the
// mobility_count rule — a surge at 0900Z that recedes by 1500Z is still that
// day's fact), `last` overwrites (a state or a price). An unregistered key is
// refused, so a series cannot be invented at a call site.
//
// A dead sensor must write nothing: the caller passes null and this module
// returns without touching the row. Baselines are over PRIOR days only
// (today excluded) and say which kind they are — same-weekday once four
// weeks of that weekday exist, else the flat trailing mean — because the
// caller's provenance names the baseline it judged against.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { sensorKeyDef } from "./sensorKeys";
import { bestBaseline, flatBaseline, type Baseline, type SeriesPoint } from "./series";

export type SensorBaseline = Baseline;

export async function recordSensorDay(sensorKey: string, day: string, value: number | null): Promise<void> {
  if (value == null || !Number.isFinite(value)) return;
  const def = sensorKeyDef(sensorKey);
  if (!def) return;
  const pool = await getDb();
  const onDup = def.policy === "peak"
    ? "value = GREATEST(value, VALUES(value))"
    : "value = VALUES(value)";
  await pool.execute(
    `INSERT INTO sensor_daily (sensor_key, day, value, updated_at) VALUES (?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE ${onDup}, updated_at = NOW(3)`,
    [sensorKey.slice(0, 96), day, value],
  );
}

interface Row extends RowDataPacket { day: string; value: number }

/** The most recent `days` points at or before `through` (inclusive), oldest first. */
export async function getSensorSeries(sensorKey: string, days = 90, through?: string): Promise<SeriesPoint[]> {
  const pool = await getDb();
  const [rows] = through
    ? await pool.query<Row[]>(
        `SELECT day, value FROM sensor_daily WHERE sensor_key = ? AND day <= ? ORDER BY day DESC LIMIT ?`,
        [sensorKey.slice(0, 96), through, days],
      )
    : await pool.query<Row[]>(
        `SELECT day, value FROM sensor_daily WHERE sensor_key = ? ORDER BY day DESC LIMIT ?`,
        [sensorKey.slice(0, 96), days],
      );
  return rows.map((r) => ({ day: String(r.day), value: Number(r.value) })).reverse();
}

/** Several keys' series in one query (for boards that render many sparklines). */
export async function getSensorSeriesMany(keys: string[], days = 30): Promise<Record<string, SeriesPoint[]>> {
  const out: Record<string, SeriesPoint[]> = {};
  if (!keys.length) return out;
  const pool = await getDb();
  const cutoff = new Date(Date.now() - (days + 30) * 86_400_000).toISOString().slice(0, 10);
  const [rows] = await pool.query<Row[]>(
    `SELECT sensor_key AS k, day, value FROM sensor_daily WHERE sensor_key IN (?) AND day >= ? ORDER BY day ASC`,
    [keys.map((k) => k.slice(0, 96)), cutoff],
  );
  for (const r of rows as (Row & { k: string })[]) (out[r.k] ||= []).push({ day: String(r.day), value: Number(r.value) });
  for (const k of Object.keys(out)) out[k] = out[k].slice(-days);
  return out;
}

/** Baseline over PRIOR days (today excluded). With `{ weekday: true }` the
 *  same-weekday mean is preferred once it has WEEKDAY_MIN_SAMPLES; the flat
 *  mean of the last `days` is the fallback either way. */
export async function getSensorBaseline(
  sensorKey: string,
  today: string,
  days = 30,
  opts: { weekday?: boolean } = {},
): Promise<SensorBaseline> {
  const pool = await getDb();
  const lookback = opts.weekday ? Math.max(days, 91) : days;
  const [rows] = await pool.query<Row[]>(
    `SELECT day, value FROM sensor_daily WHERE sensor_key = ? AND day < ? ORDER BY day DESC LIMIT ?`,
    [sensorKey.slice(0, 96), today, lookback],
  );
  const series = rows.map((r) => ({ day: String(r.day), value: Number(r.value) })).reverse();
  return opts.weekday ? bestBaseline(series, today, days) : flatBaseline(series, today, days);
}
