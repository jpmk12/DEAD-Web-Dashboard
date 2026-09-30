// Numeric sensor baselines — server-only. One value per sensor key per UTC
// day, keeping the DAY'S PEAK on duplicate writes (the mobility_count rule):
// a surge at 0900Z that recedes by 1500Z is still that day's fact for
// baseline purposes. The trailing mean over PRIOR days is the baseline the
// spectrum indicators score against — the AOI's own normal, not a static
// bar. A dead sensor must write nothing: the caller passes null and this
// module returns without touching the row.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";

export interface SensorBaseline { mean: number | null; samples: number }

export async function recordSensorDay(sensorKey: string, day: string, value: number | null): Promise<void> {
  if (value == null || !Number.isFinite(value)) return;
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO sensor_daily (sensor_key, day, value, updated_at) VALUES (?, ?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value)), updated_at = NOW(3)`,
    [sensorKey.slice(0, 96), day, value],
  );
}

interface Row extends RowDataPacket { value: number }

/** Mean of the `days` most recent PRIOR days' values (today excluded). */
export async function getSensorBaseline(sensorKey: string, today: string, days = 30): Promise<SensorBaseline> {
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    `SELECT value FROM sensor_daily WHERE sensor_key = ? AND day < ? ORDER BY day DESC LIMIT ?`,
    [sensorKey.slice(0, 96), today, days],
  );
  if (!rows.length) return { mean: null, samples: 0 };
  return { mean: rows.reduce((s, r) => s + Number(r.value), 0) / rows.length, samples: rows.length };
}
