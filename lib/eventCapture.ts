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
    });
  }
  if (!events.length) return { ok: false, error: "No valid events (need https permalinks + headlines)." };
  return { ok: true, events, source, skipped };
}
