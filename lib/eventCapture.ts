// Pure parser/validator for a captured EVENT stream (geolocated conflict/incident
// events from a public map like LiveUAMap that blocks datacenter IPs, so it's
// captured in the user's own browser). Client-safe, no DB. Counterpart to
// lib/xImport / lib/articleCapture.

export interface StoredEventDraft {
  id: string;
  url: string;
  title: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  source: string;      // region label, e.g. "iran"
  capturedAt: string;
  /** The event's REPORTED coordinates when the page carried them (extension
   *  1.2.3+ reads data-lat / data-lng); null when it did not. A null is
   *  never filled in here — lib/kineticEvents places an unplaced event by
   *  the country its title or region names, and says so. */
  lat: number | null;
  lon: number | null;
}

export type ParseEventsResult =
  | { ok: true; events: StoredEventDraft[]; source: string; skipped: number }
  | { ok: false; error: string };

const MAX_ITEMS = 300;

function httpsOrNull(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  try { const u = new URL(s); return u.protocol === "https:" ? u.href.slice(0, 600) : null; } catch { return null; }
}
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "ev_" + h.toString(36);
}
function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
const num = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
/** A coordinate pair when both halves are finite and in range and the pair
 *  is not the 0/0 placeholder; else nulls. `lng` / `long` / `longitude` and
 *  `latitude` are accepted beside `lat` / `lon`. */
export function coordsOf(o: Record<string, unknown>): { lat: number | null; lon: number | null } {
  const lat = num(o.lat ?? o.latitude);
  const lon = num(o.lon ?? o.lng ?? o.long ?? o.longitude);
  if (lat == null || lon == null) return { lat: null, lon: null };
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return { lat: null, lon: null };
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
}

export function parseEventsCapture(raw: string, nowIso = new Date().toISOString()): ParseEventsResult {
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return { ok: false, error: "Invalid JSON." }; }
  if (j.format !== "dead-events") return { ok: false, error: "Not a dead-events capture." };

  const src = j.source as { label?: unknown } | undefined;
  const source = (typeof src?.label === "string" ? src.label : "").trim().slice(0, 80) || "events";
  const rawItems = Array.isArray(j.items) ? j.items : [];
  if (!rawItems.length) return { ok: false, error: "No events in the capture." };

  const seen = new Set<string>();
  const events: StoredEventDraft[] = [];
  let skipped = 0;
  for (const it of rawItems.slice(0, MAX_ITEMS * 2)) {
    if (events.length >= MAX_ITEMS) break;
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const url = httpsOrNull(o.url);
    const title = (typeof o.title === "string" ? o.title : "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!url || title.length < 10) { skipped++; continue; }         // an event needs a permalink + real headline
    const id = hashId(url);
    if (seen.has(id)) { skipped++; continue; }
    seen.add(id);
    events.push({
      id, url, title,
      sourceUrl: httpsOrNull(o.sourceUrl),
      publishedAt: isoOrNull(o.time) ?? isoOrNull(o.publishedAt),
      source,
      capturedAt: isoOrNull(j.capturedAt) ?? nowIso,
      ...coordsOf(o),
    });
  }
  if (!events.length) return { ok: false, error: "No valid events (need https permalinks + headlines)." };
  return { ok: true, events, source, skipped };
}
