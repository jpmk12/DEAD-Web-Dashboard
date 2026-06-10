// ACLED (Armed Conflict Location & Event Data) — structured, human-coded
// conflict events for the Crisis map's high-fidelity "ACLED" layer. Unlike the
// GDELT density read (keyless, headline-scraped), ACLED gives precise
// coordinates, an event/sub-event taxonomy (e.g. "Air/drone strike",
// "Shelling/artillery/missile attack"), named actors, and fatality counts.
//
// Access (set via env — see .env.example / CLAUDE.md):
//   ACLED_EMAIL    — the email you registered at acleddata.com
//   ACLED_PASSWORD — that account's password
// ACLED retired the old email+key query-param scheme; programmatic access is
// now OAuth (password grant). We exchange the credentials for a 24 h bearer
// token at /oauth/token, cache it, and call /api/acled/read with it. If the
// env vars are absent the whole layer is simply off (getAcledEvents → []).
//
// Attribution: ACLED's license requires citing ACLED wherever its data is
// shown — the Crisis map labels the layer "ACLED" and credits it in popups +
// the sources line. Keep that attribution if you touch the UI.

const TOKEN_URL = "https://acleddata.com/oauth/token";
const READ_URL = "https://acleddata.com/api/acled/read";

// The kinetic slice we surface: armed clashes + the remote-violence bucket that
// holds air/drone/missile strikes and shelling. (ACLED's other top-level types
// — protests, riots, strategic developments, violence against civilians — are
// out of scope for the strike picture.)
const KINETIC_TYPES = ["Battles", "Explosions/Remote violence"];

const DATA_TTL = 30 * 60 * 1000;   // re-pull events at most every 30 min
const TOKEN_SKEW = 60 * 1000;      // refresh the token a minute before expiry
const WINDOW_DAYS = 7;
const PER_TYPE_LIMIT = 300;
const MAX_EVENTS = 400;

export interface AcledEvent {
  id: string;
  date: string;       // event_date (YYYY-MM-DD)
  type: string;       // event_type
  subType: string;    // sub_event_type — e.g. "Air/drone strike"
  lat: number;
  lon: number;
  country: string;
  admin1: string;
  location: string;
  notes: string;
  fatalities: number;
  source: string;
  actors: string;     // "actor1 vs actor2"
}

let tokenCache: { token: string; expires: number } | null = null;
let dataCache: { events: AcledEvent[]; expires: number } | null = null;

export function acledConfigured(): boolean {
  return Boolean(process.env.ACLED_EMAIL && process.env.ACLED_PASSWORD);
}

async function getToken(): Promise<string | null> {
  if (!acledConfigured()) return null;
  if (tokenCache && tokenCache.expires > Date.now()) return tokenCache.token;

  const email = process.env.ACLED_EMAIL!;
  const body = new URLSearchParams();
  // ACLED's docs are inconsistent on whether the identity field is "username"
  // or "email" — send both (OAuth servers ignore unknown params) so it works
  // either way.
  body.set("username", email);
  body.set("email", email);
  body.set("password", process.env.ACLED_PASSWORD!);
  body.set("grant_type", "password");
  body.set("client_id", "acled");
  body.set("scope", "authenticated");

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[acled] token request failed:", res.status, res.statusText);
      return null;
    }
    const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    const token = j?.access_token;
    if (!token) { console.error("[acled] token response had no access_token"); return null; }
    const ttl = (Number(j?.expires_in) || 86400) * 1000;
    tokenCache = { token, expires: Date.now() + ttl - TOKEN_SKEW };
    return token;
  } catch (e) {
    console.error("[acled] token error:", e);
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

function normalize(raw: Record<string, unknown>): AcledEvent | null {
  const lat = Number(raw.latitude), lon = Number(raw.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const a1 = String(raw.actor1 ?? "").trim(), a2 = String(raw.actor2 ?? "").trim();
  const actors = a1 && a2 ? `${a1} vs ${a2}` : (a1 || a2 || "");
  return {
    id: String(raw.event_id_cnty ?? `${raw.event_date}-${lat}-${lon}`),
    date: String(raw.event_date ?? ""),
    type: String(raw.event_type ?? ""),
    subType: String(raw.sub_event_type ?? ""),
    lat, lon,
    country: String(raw.country ?? ""),
    admin1: String(raw.admin1 ?? ""),
    location: String(raw.location ?? ""),
    notes: String(raw.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
    fatalities: Number(raw.fatalities ?? 0) || 0,
    source: String(raw.source ?? "").slice(0, 120),
    actors: actors.slice(0, 120),
  };
}

async function readType(token: string, type: string, from: string, to: string): Promise<AcledEvent[]> {
  const params = new URLSearchParams();
  params.set("event_date", `${from}|${to}`);
  params.set("event_date_where", "BETWEEN");
  params.set("event_type", type);
  params.set("fields", "event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|admin1|location|latitude|longitude|fatalities|notes|source");
  params.set("limit", String(PER_TYPE_LIMIT));
  params.set("_format", "json");

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${READ_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 401) { tokenCache = null; } // token rejected — force re-auth next cycle
    if (!res.ok) { console.error("[acled] read failed:", type, res.status); return []; }
    const j = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
    const rows = Array.isArray(j?.data) ? j!.data : [];
    const out: AcledEvent[] = [];
    for (const r of rows) { const e = normalize(r as Record<string, unknown>); if (e) out.push(e); }
    return out;
  } catch (e) {
    console.error("[acled] read error:", type, e);
    return [];
  } finally {
    clearTimeout(tid);
  }
}

export async function getAcledEvents(): Promise<AcledEvent[]> {
  if (!acledConfigured()) return [];
  if (dataCache && dataCache.expires > Date.now()) return dataCache.events;

  const token = await getToken();
  if (!token) return [];

  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 3600_000);
  const results = await Promise.all(KINETIC_TYPES.map((t) => readType(token, t, ymd(from), ymd(to))));
  const merged = results.flat();
  merged.sort((a, b) => b.date.localeCompare(a.date)); // newest first
  const events = merged.slice(0, MAX_EVENTS);

  // Only cache a non-empty pull — an empty result is usually a transient auth/
  // network blip, and caching it would blank the layer for 30 min.
  if (events.length > 0) dataCache = { events, expires: Date.now() + DATA_TTL };
  return events;
}
