// UKMTO incident persistence — server-only. Pure parsing lives in
// lib/ukmtoParse; this owns captured_ukmto: idempotent upsert by UKMTO
// reference (a row with a REPORTED position or a date never loses it to a
// later row without one), a rolling prune (180 days / newest 600 — an
// incident is a standing record), and a short read cache. Rows come from
// the direct fetch (`via: "fetch"`) or a browser capture (`via: "capture"`).

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { sortUkmto, type UkmtoIncident } from "./ukmtoParse";

const READ_TTL = 60_000;
let cache: { at: number; items: UkmtoIncident[] } | null = null;

export async function upsertUkmto(incidents: UkmtoIncident[], via: "fetch" | "capture", userEmail = ""): Promise<{ imported: number }> {
  if (!incidents.length) return { imported: 0 };
  const pool = await getDb();
  const now = new Date();
  for (const i of incidents) {
    await pool.execute(
      `INSERT INTO captured_ukmto (ref, label, incident_on, incident_at, reported_by, lat, lon, placement, area, body, url, via, user_email, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         incident_on = COALESCE(VALUES(incident_on), incident_on),
         incident_at = COALESCE(VALUES(incident_at), incident_at),
         reported_by = COALESCE(VALUES(reported_by), reported_by),
         lat = CASE WHEN placement = 'reported' AND VALUES(placement) <> 'reported' THEN lat ELSE COALESCE(VALUES(lat), lat) END,
         lon = CASE WHEN placement = 'reported' AND VALUES(placement) <> 'reported' THEN lon ELSE COALESCE(VALUES(lon), lon) END,
         placement = CASE WHEN placement = 'reported' THEN placement ELSE COALESCE(VALUES(placement), placement) END,
         area = COALESCE(VALUES(area), area),
         body = CASE WHEN CHAR_LENGTH(VALUES(body)) >= CHAR_LENGTH(body) THEN VALUES(body) ELSE body END,
         url = VALUES(url),
         via = VALUES(via),
         captured_at = VALUES(captured_at)`,
      [i.ref, i.label, i.date, i.time, i.reportedBy, i.lat, i.lon, i.placement, i.area, i.text, i.url, via, userEmail, now],
    );
  }
  await pool.execute("DELETE FROM captured_ukmto WHERE captured_at < (NOW(3) - INTERVAL 180 DAY)").catch(() => {});
  await pool.execute(
    `DELETE FROM captured_ukmto WHERE ref NOT IN (SELECT ref FROM (SELECT ref FROM captured_ukmto ORDER BY captured_at DESC LIMIT 600) t)`,
  ).catch(() => {});
  cache = null;
  return { imported: incidents.length };
}

interface Row extends RowDataPacket {
  ref: string; label: string; incident_on: string | null; incident_at: string | null; reported_by: string | null;
  lat: number | null; lon: number | null; placement: string | null; area: string | null; body: string; url: string;
  via: string; captured_at: Date;
}

export interface StoredUkmto extends UkmtoIncident { via: "fetch" | "capture"; capturedAt: string }

export async function getStoredUkmto(limit = 400): Promise<StoredUkmto[]> {
  if (cache && Date.now() - cache.at < READ_TTL) return cache.items as StoredUkmto[];
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>(
    "SELECT ref, label, incident_on, incident_at, reported_by, lat, lon, placement, area, body, url, via, captured_at FROM captured_ukmto ORDER BY COALESCE(incident_on, '') DESC, captured_at DESC LIMIT ?",
    [limit],
  );
  const items: StoredUkmto[] = rows.map((r) => ({
    id: `ukmto-${r.ref}`, ref: r.ref, label: r.label, date: r.incident_on, time: r.incident_at, reportedBy: r.reported_by,
    lat: r.lat, lon: r.lon,
    placement: r.placement === "reported" || r.placement === "area" ? r.placement : null,
    area: r.area, text: r.body, url: r.url,
    via: r.via === "capture" ? "capture" : "fetch",
    capturedAt: r.captured_at.toISOString(),
  }));
  const sorted = sortUkmto(items) as StoredUkmto[];
  cache = { at: Date.now(), items: sorted };
  return sorted;
}

export async function getUkmtoStoreStatus(): Promise<{ count: number; newest: string | null; captured: number; fetched: number }> {
  const items = await getStoredUkmto(600).catch(() => [] as StoredUkmto[]);
  return {
    count: items.length,
    newest: items.reduce<string | null>((m, i) => (!m || i.capturedAt > m ? i.capturedAt : m), null),
    captured: items.filter((i) => i.via === "capture").length,
    fetched: items.filter((i) => i.via === "fetch").length,
  };
}

export async function clearUkmto(): Promise<void> {
  const pool = await getDb();
  await pool.execute("DELETE FROM captured_ukmto");
  cache = null;
}

export function resetUkmtoStoreCache(): void { cache = null; }
