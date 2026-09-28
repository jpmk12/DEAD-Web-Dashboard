// AIS transit counting at chokepoints — server-only. Judgement is in
// lib/chokepointTransit.ts (pure, tested).
//
// The AISStream bridge (lib/aisStream) subscribes to the tight counting box
// over every maritime chokepoint (Chokepoint.aisBox) alongside the home box,
// and hands every position report here. We keep, per chokepoint, the
// distinct MMSI seen today (UTC) and a trailing-hour set, plus the minutes
// the bridge was actually listening — the denominator that stops a short
// listen from reading as low traffic. Today's row is upserted to
// chokepoint_transits_daily every few minutes; prior days form the baseline.
//
// Honest limits: the bridge lives in the server process, so a deploy or
// restart resets the in-memory sets (the DB row keeps the day's high-water
// mark via GREATEST) and coverage is only as continuous as the process.
// That is exactly what `observed_minutes` records, and why the signal says
// UNKNOWN until it has listened long enough.

import type { RowDataPacket } from "mysql2";
import { CHOKEPOINTS } from "./chokepoints";
import { getDb } from "./db";
import { transitSignal, transitBaseline, type TransitSignal } from "./chokepointTransit";

interface Counter {
  day: string;
  today: Set<number>;
  recent: Map<number, number>;   // mmsi → last seen ms
}

const counters = new Map<string, Counter>();
const observedMs = new Map<string, number>();   // day → ms listened
let openSince: number | null = null;
let lastPersist = 0;
let listening = false;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const HOUR = 60 * 60 * 1000;
const PERSIST_EVERY = 3 * 60 * 1000;

const BOXES = CHOKEPOINTS.filter((c) => c.aisBox).map((c) => ({ id: c.id, box: c.aisBox! }));

export function hasChokepointBoxes(): boolean { return BOXES.length > 0; }

/** Bounding boxes in AISStream's [[latMin, lonMin], [latMax, lonMax]] form. */
export function chokepointBoundingBoxes(): [[number, number], [number, number]][] {
  return BOXES.map(({ box }) => [[box[0], box[1]], [box[2], box[3]]]);
}

/** Called by the bridge on open/close so listening time is accounted for. */
export function noteAisListening(on: boolean, nowMs = Date.now()): void {
  accrue(nowMs);
  listening = on;
  openSince = on ? nowMs : null;
}

function accrue(nowMs: number): void {
  if (openSince === null) return;
  const day = dayOf(nowMs);
  observedMs.set(day, (observedMs.get(day) ?? 0) + Math.max(0, nowMs - openSince));
  openSince = nowMs;
}

function counterFor(id: string, day: string): Counter {
  let c = counters.get(id);
  if (!c) { c = { day, today: new Set(), recent: new Map() }; counters.set(id, c); }
  if (c.day !== day) {
    // Day rolled: persist yesterday's final numbers, then start fresh.
    persistRow(id, c.day, c.today.size, Math.round((observedMs.get(c.day) ?? 0) / 60_000)).catch(() => {});
    c.day = day; c.today = new Set(); c.recent = new Map();
  }
  return c;
}

/** Called by the bridge for every position report. Cheap: a few box tests. */
export function noteVesselPosition(mmsi: number, lat: number, lon: number, nowMs = Date.now()): void {
  const day = dayOf(nowMs);
  for (const { id, box } of BOXES) {
    if (lat < box[0] || lat > box[2] || lon < box[1] || lon > box[3]) continue;
    const c = counterFor(id, day);
    c.today.add(mmsi);
    c.recent.set(mmsi, nowMs);
    if (c.recent.size > 4000) {
      const cutoff = nowMs - HOUR;
      for (const [k, t] of c.recent) if (t < cutoff) c.recent.delete(k);
    }
  }
  if (nowMs - lastPersist > PERSIST_EVERY) {
    lastPersist = nowMs;
    accrue(nowMs);
    for (const [id, c] of counters) {
      if (c.day === day) persistRow(id, day, c.today.size, Math.round((observedMs.get(day) ?? 0) / 60_000)).catch(() => {});
    }
  }
}

async function persistRow(id: string, day: string, distinct: number, observedMinutes: number): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    `INSERT INTO chokepoint_transits_daily (day, chokepoint_id, distinct_mmsi, observed_minutes) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE distinct_mmsi = GREATEST(distinct_mmsi, VALUES(distinct_mmsi)), observed_minutes = GREATEST(observed_minutes, VALUES(observed_minutes))`,
    [day, id, distinct, observedMinutes],
  );
}

interface Row extends RowDataPacket { day: string; distinct_mmsi: number; observed_minutes: number }
const baselineCache = new Map<string, { at: number; perHour: number | null; days: number }>();

async function baselineFor(id: string, today: string): Promise<{ perHour: number | null; days: number }> {
  const hit = baselineCache.get(id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit;
  let out = { perHour: null as number | null, days: 0 };
  try {
    const pool = await getDb();
    const [rows] = await pool.query<Row[]>(
      "SELECT day, distinct_mmsi, observed_minutes FROM chokepoint_transits_daily WHERE chokepoint_id = ? AND day < ? ORDER BY day DESC LIMIT 30",
      [id, today],
    );
    out = transitBaseline(rows.map((r) => ({ distinct: Number(r.distinct_mmsi), observedMinutes: Number(r.observed_minutes) })));
  } catch { /* no DB → learning */ }
  baselineCache.set(id, { at: Date.now(), ...out });
  return out;
}

export interface ChokepointTransit extends TransitSignal {
  distinctToday: number;
  lastHour: number;
  observedMinutesToday: number;
  baselinePerHour: number | null;
  baselineDays: number;
}

/** Live transit picture per chokepoint id (only those with a counting box). */
export async function getChokepointTransits(opts: { configured: boolean; connected: boolean }, nowMs = Date.now()): Promise<Record<string, ChokepointTransit>> {
  accrue(nowMs);
  const day = dayOf(nowMs);
  const observedMinutesToday = Math.round((observedMs.get(day) ?? 0) / 60_000);
  const out: Record<string, ChokepointTransit> = {};
  for (const { id } of BOXES) {
    const c = counters.get(id);
    const cutoff = nowMs - HOUR;
    let lastHour = 0;
    if (c && c.day === day) for (const t of c.recent.values()) if (t >= cutoff) lastHour++;
    const distinctToday = c && c.day === day ? c.today.size : 0;
    const b = await baselineFor(id, day);
    const sig = transitSignal({
      configured: opts.configured && (opts.connected || listening),
      distinctToday, observedMinutesToday, lastHour,
      baselinePerHour: b.perHour, baselineDays: b.days,
    });
    out[id] = { ...sig, distinctToday, lastHour, observedMinutesToday, baselinePerHour: b.perHour, baselineDays: b.days };
  }
  return out;
}
