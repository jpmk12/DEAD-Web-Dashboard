import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import { isOwner } from "./allowlist";
import { haversineKm } from "./disasters";

// TDY / travel trips. A trip is a labelled, geocoded place with a date range.
// The "active" trip (today within [start,end]) is the user's effective
// location, overriding home for weather / local news / the morning brief.

export interface Trip {
  id: string;
  label: string;       // display, e.g. "Stuttgart, DE"
  location: string;    // raw place text that was geocoded
  lat: number;
  lon: number;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  tz: string | null;
  feedKey: string | null; // snapped nearest base-news set, or null → GDELT fallback
  notes: string | null;
  source: "manual" | "calendar"; // 'calendar' = auto-synced from a calendar event
  eventId: string | null;        // source calendar event id, for idempotent upsert
  createdAt: string;
}

export interface EffectiveLocation {
  label: string;
  lat: number;
  lon: number;
  feedKey: string | null;
  trip: Trip | null;     // null = home
  dayOfTrip?: number;    // 1-based, when on a trip
  tripDays?: number;
}

// Centroids of the curated LOCAL_NEWS_SETS, for snapping an arbitrary TDY
// location to the nearest base feed when it's close enough; otherwise local
// news falls back to a geo search (GDELT). Keep keys in sync with
// LOCAL_NEWS_SETS / VALID_FEED_KEYS.
const FEED_CENTROIDS: Record<string, [number, number]> = {
  colorado:      [38.83, -104.82], // Colorado Springs
  dc:            [38.90, -77.04],  // Washington DC
  hampton_roads: [36.85, -76.29],  // Norfolk
  san_antonio:   [29.42, -98.49],
  hawaii:        [21.31, -157.86], // Honolulu
  japan:         [35.75, 139.35],  // Yokota
  germany:       [49.44, 7.60],    // Ramstein / Kaiserslautern
  illinois:      [38.54, -89.85],  // Scott AFB
  oklahoma:      [35.42, -97.39],  // Tinker / OKC
  new_jersey:    [40.03, -74.59],  // JB MDL
};
const SNAP_KM = 250;

// Nearest curated base-news set within SNAP_KM, else null (→ GDELT geo news).
// Pure — unit-tested.
export function nearestFeedKey(lat: number, lon: number): string | null {
  let best: { key: string; d: number } | null = null;
  for (const [key, [clat, clon]] of Object.entries(FEED_CENTROIDS)) {
    const d = haversineKm(lat, lon, clat, clon);
    if (!best || d < best.d) best = { key, d };
  }
  return best && best.d <= SNAP_KM ? best.key : null;
}

// Pick the active trip for a given YYYY-MM-DD. When trips overlap, the one that
// started most recently wins (you flew to the newer place). Pure — unit-tested.
export function pickActiveTrip(trips: Trip[], today: string): Trip | null {
  const inRange = trips.filter((t) => t.startDate <= today && t.endDate >= today);
  if (inRange.length === 0) return null;
  return inRange.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0))[0];
}

// Day-of-trip (1-based) and total days, inclusive. Pure.
export function tripProgress(trip: Trip, today: string): { day: number; days: number } {
  const ms = 86_400_000;
  const d0 = Date.parse(`${trip.startDate}T00:00:00Z`);
  const d1 = Date.parse(`${trip.endDate}T00:00:00Z`);
  const dt = Date.parse(`${today}T00:00:00Z`);
  const days = Math.max(1, Math.round((d1 - d0) / ms) + 1);
  const day = Math.min(days, Math.max(1, Math.round((dt - d0) / ms) + 1));
  return { day, days };
}

interface TripRow extends RowDataPacket {
  id: string; label: string; location: string; lat: number; lon: number;
  start_date: string; end_date: string; tz: string | null; feed_key: string | null;
  notes: string | null; source: string | null; event_id: string | null; created_at: Date;
}
function rowToTrip(r: TripRow): Trip {
  return {
    id: r.id, label: r.label, location: r.location, lat: r.lat, lon: r.lon,
    startDate: r.start_date, endDate: r.end_date, tz: r.tz, feedKey: r.feed_key,
    notes: r.notes, source: r.source === "calendar" ? "calendar" : "manual",
    eventId: r.event_id, createdAt: r.created_at.toISOString(),
  };
}
const TRIP_COLS = "id, label, location, lat, lon, start_date, end_date, tz, feed_key, notes, source, event_id, created_at";

// Email scoping for reads/mutations: exact-email rows, plus pre-multi-user
// '' rows which belong to the OWNER (single-user-era legacy).
function scopeClause(email: string): { clause: string; params: string[] } {
  return isOwner(email)
    ? { clause: "user_email IN (?, '')", params: [email] }
    : { clause: "user_email = ?", params: [email] };
}


export async function listTrips(email: string): Promise<Trip[]> {
  const pool = await getDb();
  const sc = scopeClause(email);
  const [rows] = await pool.query<TripRow[]>(
    `SELECT ${TRIP_COLS} FROM trips WHERE ${sc.clause} ORDER BY start_date DESC`,
    sc.params,
  );
  return rows.map(rowToTrip);
}

export async function getActiveTrip(email: string, today: string): Promise<Trip | null> {
  const pool = await getDb();
  const sc = scopeClause(email);
  const [rows] = await pool.query<TripRow[]>(
    `SELECT ${TRIP_COLS} FROM trips WHERE start_date <= ? AND end_date >= ? AND ${sc.clause} ORDER BY start_date DESC LIMIT 1`,
    [today, today, ...sc.params],
  );
  return rows[0] ? rowToTrip(rows[0]) : null;
}

export async function createTrip(email: string, t: {
  label: string; location: string; lat: number; lon: number;
  startDate: string; endDate: string; tz?: string | null; notes?: string | null;
  source?: "manual" | "calendar"; eventId?: string | null;
}): Promise<Trip> {
  const pool = await getDb();
  const id = randomUUID();
  const feedKey = nearestFeedKey(t.lat, t.lon);
  const now = new Date();
  const source = t.source ?? "manual";
  const eventId = t.eventId ?? null;
  await pool.execute(
    `INSERT INTO trips (id, user_email, label, location, lat, lon, start_date, end_date, tz, feed_key, notes, source, event_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, email, t.label, t.location, t.lat, t.lon, t.startDate, t.endDate, t.tz ?? null, feedKey, t.notes ?? null, source, eventId, now],
  );
  return {
    id, label: t.label, location: t.location, lat: t.lat, lon: t.lon,
    startDate: t.startDate, endDate: t.endDate, tz: t.tz ?? null, feedKey,
    notes: t.notes ?? null, source, eventId, createdAt: now.toISOString(),
  };
}

export async function getTripById(email: string, id: string): Promise<Trip | null> {
  const pool = await getDb();
  const sc = scopeClause(email);
  const [rows] = await pool.query<TripRow[]>(`SELECT ${TRIP_COLS} FROM trips WHERE id = ? AND ${sc.clause} LIMIT 1`, [id, ...sc.params]);
  return rows[0] ? rowToTrip(rows[0]) : null;
}

// Update a hand-entered trip's dates and/or label in place. Restricted to
// source='manual' rows (the WHERE clause) — calendar trips are owned by their
// source event and would just be re-synced, so the route blocks those earlier
// with a clearer message. Returns the updated trip (or null if nothing matched).
export async function updateTrip(
  email: string,
  id: string,
  fields: { startDate?: string; endDate?: string; label?: string },
): Promise<Trip | null> {
  const sets: string[] = [];
  const vals: string[] = [];
  if (fields.startDate !== undefined) { sets.push("start_date = ?"); vals.push(fields.startDate); }
  if (fields.endDate !== undefined) { sets.push("end_date = ?"); vals.push(fields.endDate); }
  if (fields.label !== undefined) { sets.push("label = ?"); vals.push(fields.label); }
  if (sets.length > 0) {
    const pool = await getDb();
    const sc = scopeClause(email);
    await pool.execute(`UPDATE trips SET ${sets.join(", ")} WHERE id = ? AND source = 'manual' AND ${sc.clause}`, [...vals, id, ...sc.params]);
  }
  return getTripById(email, id);
}

export async function deleteTrip(email: string, id: string): Promise<void> {
  const pool = await getDb();
  const sc = scopeClause(email);
  await pool.execute(`DELETE FROM trips WHERE id = ? AND ${sc.clause}`, [id, ...sc.params]);
}

// Calendar-sourced trips covering `today`. Used by the auto-sync to prune trips
// whose source event was deleted/moved so they don't linger as a phantom TDY.
export async function listActiveCalendarTrips(email: string, today: string): Promise<Trip[]> {
  const pool = await getDb();
  const sc = scopeClause(email);
  const [rows] = await pool.query<TripRow[]>(
    `SELECT ${TRIP_COLS} FROM trips WHERE source = 'calendar' AND start_date <= ? AND end_date >= ? AND ${sc.clause}`,
    [today, today, ...sc.params],
  );
  return rows.map(rowToTrip);
}

// Insert-or-update a calendar-derived trip, keyed by its source event id so a
// re-sync is idempotent (and an event whose dates/location moved updates in
// place rather than duplicating). Only ever touches source='calendar' rows, so
// hand-entered trips are never clobbered.
export async function upsertCalendarTrip(email: string, t: {
  eventId: string; label: string; location: string; lat: number; lon: number;
  startDate: string; endDate: string;
}): Promise<void> {
  const pool = await getDb();
  const feedKey = nearestFeedKey(t.lat, t.lon);
  const sc = scopeClause(email);
  const [rows] = await pool.query<TripRow[]>(
    `SELECT id FROM trips WHERE source = 'calendar' AND event_id = ? AND ${sc.clause} LIMIT 1`,
    [t.eventId, ...sc.params],
  );
  if (rows[0]) {
    await pool.execute(
      `UPDATE trips SET label = ?, location = ?, lat = ?, lon = ?, start_date = ?, end_date = ?, feed_key = ?
       WHERE id = ?`,
      [t.label, t.location, t.lat, t.lon, t.startDate, t.endDate, feedKey, rows[0].id],
    );
    return;
  }
  await pool.execute(
    `INSERT INTO trips (id, user_email, label, location, lat, lon, start_date, end_date, tz, feed_key, notes, source, event_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calendar', ?, ?)`,
    [randomUUID(), email, t.label, t.location, t.lat, t.lon, t.startDate, t.endDate, null, feedKey, null, t.eventId, new Date()],
  );
}

// Best-effort prune of trips whose end date is well in the past, so the table
// stays small. Keeps ~1 year of history for reference.
export async function pruneOldTrips(): Promise<void> {
  try {
    const pool = await getDb();
    const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    await pool.execute("DELETE FROM trips WHERE end_date < ?", [cutoff]);
  } catch { /* best-effort */ }
}
