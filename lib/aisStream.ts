// AISStream client. Holds a long-lived server-side WebSocket connection to
// aisstream.io (Node 22+ global WebSocket) and a module-scoped vessel state
// map. The /api/osint/ships endpoint reads from the map; the connection is
// initialized lazily on first call and re-subscribed when the bounding box
// changes.
//
// Activation: only fires if AISSTREAM_API_KEY is present in the environment.
// Without the key, getStatus() returns { configured: false } and the client
// falls back to the iframe providers.
//
// State liveness: vessels older than VESSEL_TTL_MS are filtered out by
// getVesselsSnapshot — typical AIS PositionReports arrive every 2-10 seconds
// for in-range ships, so 5 minutes is plenty for catching stale entries
// without losing recently-moored ones.

export interface Vessel {
  mmsi: number;
  name: string;
  shipType: number;
  lat: number;
  lon: number;
  cog: number;            // course over ground (deg)
  sog: number;            // speed over ground (kn)
  heading: number | null; // true heading
  updatedAt: number;
}

const VESSEL_TTL_MS = 5 * 60_000;
const RECONNECT_BACKOFF_MS = 10_000;

const vessels = new Map<number, Vessel>();
let ws: WebSocket | null = null;
let connecting = false;
let lastBbox: string | null = null;
let lastError: string | null = null;
let lastConnectAttempt = 0;

function bboxFor(lat: number, lon: number, km: number): [number, number, number, number] {
  const latDelta = km / 111;
  const lonDelta = km / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  return [lat - latDelta, lon - lonDelta, lat + latDelta, lon + lonDelta];
}

function subscribe(apiKey: string, bbox: [number, number, number, number]) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [[[bbox[0], bbox[1]], [bbox[2], bbox[3]]]],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    }),
  );
}

function handleMessage(raw: string) {
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== "object") return;
  const m = msg as { MessageType?: string; MetaData?: { MMSI?: number; ShipName?: string }; Message?: Record<string, unknown> };
  const mmsi = m.MetaData?.MMSI;
  if (typeof mmsi !== "number") return;

  const existing = vessels.get(mmsi) ?? {
    mmsi,
    name: m.MetaData?.ShipName ? String(m.MetaData.ShipName).trim() : "",
    shipType: 0,
    lat: 0, lon: 0,
    cog: 0, sog: 0,
    heading: null,
    updatedAt: 0,
  };

  if (m.MessageType === "PositionReport") {
    const r = m.Message?.PositionReport as undefined | {
      Latitude?: number; Longitude?: number; Cog?: number; Sog?: number; TrueHeading?: number;
    };
    if (r && typeof r.Latitude === "number" && typeof r.Longitude === "number") {
      existing.lat = r.Latitude;
      existing.lon = r.Longitude;
      existing.cog = typeof r.Cog === "number" ? r.Cog : 0;
      existing.sog = typeof r.Sog === "number" ? r.Sog : 0;
      existing.heading = typeof r.TrueHeading === "number" && r.TrueHeading !== 511 ? r.TrueHeading : null;
      existing.updatedAt = Date.now();
      vessels.set(mmsi, existing);
    }
  } else if (m.MessageType === "ShipStaticData") {
    const s = m.Message?.ShipStaticData as undefined | { Name?: string; Type?: number };
    if (s) {
      if (typeof s.Name === "string") existing.name = s.Name.trim();
      if (typeof s.Type === "number") existing.shipType = s.Type;
      vessels.set(mmsi, existing);
    }
  }

  // Bounded growth: if the map exceeds a sane cap, drop the oldest entries.
  if (vessels.size > 5000) {
    const cutoff = Date.now() - VESSEL_TTL_MS;
    for (const [k, v] of vessels) {
      if (v.updatedAt < cutoff) vessels.delete(k);
    }
  }
}

export function ensureAisConnection(lat: number, lon: number, radiusKm: number): { configured: boolean; connected: boolean; error?: string } {
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) return { configured: false, connected: false };

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { configured: true, connected: false, error: "Invalid coords" };
  }

  const bbox = bboxFor(lat, lon, radiusKm);
  const bboxKey = bbox.map((n) => n.toFixed(2)).join(",");

  // Already connected to the right bbox.
  if (ws && ws.readyState === WebSocket.OPEN && lastBbox === bboxKey) {
    return { configured: true, connected: true };
  }

  // Need to (re)subscribe: bbox changed but connection is still open.
  if (ws && ws.readyState === WebSocket.OPEN && lastBbox !== bboxKey) {
    subscribe(apiKey, bbox);
    lastBbox = bboxKey;
    // Clear cached vessels outside the new bbox on the next snapshot read —
    // simplest is just to let them age out via TTL.
    return { configured: true, connected: true };
  }

  // Already in flight.
  if (connecting) return { configured: true, connected: false };

  // Backoff between failed connection attempts.
  if (Date.now() - lastConnectAttempt < RECONNECT_BACKOFF_MS && lastError) {
    return { configured: true, connected: false, error: lastError };
  }
  lastConnectAttempt = Date.now();
  connecting = true;
  lastError = null;

  try {
    if (typeof WebSocket === "undefined") {
      connecting = false;
      lastError = "Node WebSocket unavailable (requires Node 22+)";
      return { configured: true, connected: false, error: lastError };
    }
    ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    ws.addEventListener("open", () => {
      lastBbox = bboxKey;
      subscribe(apiKey, bbox);
      connecting = false;
    });
    ws.addEventListener("message", (ev: MessageEvent) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      if (data) handleMessage(data);
    });
    ws.addEventListener("close", () => {
      ws = null;
      lastBbox = null;
      connecting = false;
    });
    ws.addEventListener("error", () => {
      lastError = "WebSocket error";
      connecting = false;
      try { ws?.close(); } catch { /* noop */ }
      ws = null;
    });
  } catch (e) {
    connecting = false;
    lastError = e instanceof Error ? e.message : "Unknown error";
    return { configured: true, connected: false, error: lastError };
  }

  return { configured: true, connected: false };
}

export function getVesselsSnapshot(): Vessel[] {
  const cutoff = Date.now() - VESSEL_TTL_MS;
  const out: Vessel[] = [];
  for (const v of vessels.values()) {
    if (v.updatedAt >= cutoff) out.push(v);
  }
  return out;
}
