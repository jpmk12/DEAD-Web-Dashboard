// ACLED (Armed Conflict Location & Event Data) — structured, human-coded
// conflict events for the Crisis map's high-fidelity "ACLED" layer. Unlike the
// GDELT density read (keyless, headline-scraped), ACLED gives precise
// coordinates, an event/sub-event taxonomy (e.g. "Air/drone strike",
// "Shelling/artillery/missile attack"), named actors, and fatality counts.
//
// Access — credentials resolve in this order:
//   1. Settings (Preferences → Sources & feeds → ACLED), stored server-side in
//      user_prefs and read via getAcledCredentials().
//   2. Env vars ACLED_EMAIL / ACLED_PASSWORD, which OVERRIDE settings when set
//      (lets an operator pin credentials without the UI).
//
// Auth — ACLED uses a Drupal SESSION-COOKIE login (NOT OAuth, NOT the old
// email+key query param). We POST {name,pass} JSON to /user/login?_format=json;
// ACLED replies with a session cookie (Set-Cookie). We capture that cookie and
// send it on the /api/acled/read GET — no bearer token is passed. The session is
// cached and reused, re-established on expiry or a 401/403. If neither source
// supplies credentials the layer is simply off (getAcledEvents → []).
//
// Attribution: ACLED's license requires citing ACLED wherever its data is
// shown — the Crisis map labels the layer "ACLED" and credits it in popups +
// the sources line. Keep that attribution if you touch the UI.

import { aorFromCoords } from "./aor";
import { recordDailySignals } from "./trends";

const LOGIN_URL = "https://acleddata.com/user/login?_format=json";
const READ_URL = "https://acleddata.com/api/acled/read";

// The kinetic slice we surface: armed clashes + the remote-violence bucket that
// holds air/drone/missile strikes and shelling. (ACLED's other top-level types
// — protests, riots, strategic developments, violence against civilians — are
// out of scope for the strike picture.)
const KINETIC_TYPES = ["Battles", "Explosions/Remote violence"];

const DATA_TTL = 30 * 60 * 1000;        // re-pull events at most every 30 min
const SESSION_TTL = 12 * 60 * 60 * 1000; // re-login at most every 12h (or on 401/403)
// ACLED has a reporting lag, so the most recent couple of days are sparse — a
// 14-day window keeps the kinetic layer populated without going stale.
const WINDOW_DAYS = 14;
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

interface Creds { email: string; password: string }

let sessionCache: { cookie: string; expires: number; email: string } | null = null;
let dataCache: { events: AcledEvent[]; expires: number } | null = null;

// Env overrides settings. Imported lazily so the settings path (DB) isn't hit
// when env credentials are present, and so this module stays import-safe.
async function resolveCreds(): Promise<Creds | null> {
  const envEmail = process.env.ACLED_EMAIL, envPw = process.env.ACLED_PASSWORD;
  if (envEmail && envPw) return { email: envEmail, password: envPw };
  const { getAcledCredentials } = await import("./userPrefs");
  return getAcledCredentials().catch(() => null);
}

export async function acledConfigured(): Promise<boolean> {
  return (await resolveCreds()) !== null;
}

// Drop cached session + data — call after credentials change so the next pull
// re-authenticates with the new account instead of reusing a stale session.
export function resetAcledCache(): void {
  sessionCache = null;
  dataCache = null;
}

// Pull the name=value pairs out of a login response's Set-Cookie header(s) and
// join them into a Cookie header for subsequent reads. undici exposes
// getSetCookie() (one entry per cookie); fall back to the combined header.
function cookieHeaderFrom(res: Response): string | null {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === "function"
    ? h.getSetCookie()
    : (h.get("set-cookie") ? [h.get("set-cookie") as string] : []);
  const pairs: string[] = [];
  for (const c of list) {
    const first = c.split(";")[0]?.trim();
    if (first && first.includes("=")) pairs.push(first);
  }
  return pairs.length ? pairs.join("; ") : null;
}

// Log in with the credentials and return the session Cookie header, or null.
// Per ACLED's docs: POST {name,pass} JSON to /user/login?_format=json; the
// session cookie comes back in Set-Cookie, and reads then rely on that cookie.
async function login(creds: Creds): Promise<{ cookie: string } | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: creds.email, pass: creds.password }),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error("[acled] login failed:", res.status, res.statusText);
      return null;
    }
    const cookie = cookieHeaderFrom(res);
    if (!cookie) {
      console.error("[acled] login returned no session cookie");
      return null;
    }
    return { cookie };
  } catch (e) {
    console.error("[acled] login error:", e);
    return null;
  } finally {
    clearTimeout(tid);
  }
}

// Verify a candidate email/password without disturbing the cache — used by the
// settings endpoint to tell the user whether their credentials authenticate.
export async function verifyAcledCredentials(email: string, password: string): Promise<boolean> {
  return (await login({ email, password })) !== null;
}

async function getSession(creds: Creds): Promise<string | null> {
  if (sessionCache && sessionCache.email === creds.email && sessionCache.expires > Date.now()) return sessionCache.cookie;
  const res = await login(creds);
  if (!res) return null;
  sessionCache = { cookie: res.cookie, expires: Date.now() + SESSION_TTL, email: creds.email };
  return res.cookie;
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

// One read per event type. PER_TYPE_LIMIT (300) stays well under ACLED's
// 5000-events-per-call default, so a single page suffices and there's no
// timeout/pagination concern; if it ever needs to grow past 5000, add
// &page=N paging (which ACLED exempts from rate limits).
async function readType(cookie: string, type: string, from: string): Promise<AcledEvent[]> {
  const params = new URLSearchParams();
  // ACLED's event_date is a single-date '=' filter; a range uses the _where
  // operator. ">=" returns everything on/after `from` (no upper bound needed —
  // no future-dated events). The old pipe-BETWEEN form is NOT honored by the
  // current API (returns 0). See ACLED API "Query filters".
  params.set("event_date", from);
  params.set("event_date_where", ">=");
  params.set("event_type", type);
  params.set("fields", "event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|admin1|location|latitude|longitude|fatalities|notes|source");
  params.set("limit", String(PER_TYPE_LIMIT));
  params.set("_format", "json");

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${READ_URL}?${params.toString()}`, {
      headers: { Cookie: cookie, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) { sessionCache = null; } // session rejected — force re-login next cycle
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
  const creds = await resolveCreds();
  if (!creds) return [];
  if (dataCache && dataCache.expires > Date.now()) return dataCache.events;

  const cookie = await getSession(creds);
  if (!cookie) return [];

  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 3600_000);
  const results = await Promise.all(KINETIC_TYPES.map((t) => readType(cookie, t, ymd(from))));
  const merged = results.flat();
  merged.sort((a, b) => b.date.localeCompare(a.date)); // newest first
  const events = merged.slice(0, MAX_EVENTS);

  // Only cache a non-empty pull — an empty result is usually a transient auth/
  // network blip, and caching it would blank the layer for 30 min.
  if (events.length > 0) dataCache = { events, expires: Date.now() + DATA_TTL };

  // Trend recorder (P1): strike region/AOR/sub-type counted once per ACLED
  // event id, on fresh pulls only (cache hits return above). Fire-and-forget.
  if (events.length > 0) {
    recordDailySignals(events.map((e) => ({
      id: `acled|${e.id}`,
      terms: [
        { kind: "category" as const, term: e.subType || e.type },
        ...(e.country ? [{ kind: "region" as const, term: e.country }] : []),
        { kind: "aor" as const, term: aorFromCoords(e.lat, e.lon) },
      ].filter((t) => t.term && t.term !== "UNKNOWN"),
    }))).catch(() => {});
  }
  return events;
}

// Live end-to-end probe for the settings UI: tests the login AND a real read
// (verify-on-save only tests login, so a login-OK-but-read-fails account looked
// "connected" yet showed no data). Bypasses the caches so it reflects the
// current truth. Never throws. `tokenOk` = the login (session) succeeded.
export interface AcledDiag {
  configured: boolean;
  source: "env" | "settings" | "none";
  tokenOk: boolean;
  readStatus?: number;
  count?: number;
  sample?: string;
  error?: string;
  note?: string;
}

export async function diagnoseAcled(): Promise<AcledDiag> {
  const creds = await resolveCreds();
  if (!creds) return { configured: false, source: "none", tokenOk: false, note: "No credentials set — enter them above and Save." };
  const source: AcledDiag["source"] = (process.env.ACLED_EMAIL && process.env.ACLED_PASSWORD) ? "env" : "settings";

  const sess = await login(creds);
  if (!sess) {
    return { configured: true, source, tokenOk: false, error: "Login request failed", note: "Email/password rejected, or the ACLED account email isn't verified yet. Sign in at acleddata.com to confirm the account works." };
  }
  const cookie = sess.cookie;

  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 3600_000);
  const params = new URLSearchParams();
  params.set("event_date", ymd(from));
  params.set("event_date_where", ">=");
  params.set("event_type", "Battles");
  params.set("limit", "5");
  params.set("_format", "json");

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${READ_URL}?${params.toString()}`, {
      headers: { Cookie: cookie, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON */ }
    const data = Array.isArray(body?.data) ? (body!.data as Record<string, unknown>[]) : null;
    const count = data?.length;
    // ACLED's own words from the body — for a 403 this usually states exactly
    // what's missing (e.g. "no active subscription"/"accept terms"). Falls back
    // to a cleaned snippet of whatever was returned.
    const apiError = body && (body.success === false || body.error || body.message)
      ? String(body.error ?? body.message ?? "ACLED returned success:false")
      : (res.status >= 400 ? text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) || undefined : undefined);
    const first = data && data[0];
    const sample = first ? `${first.event_date} · ${first.event_type} · ${first.country}` : undefined;

    let note: string | undefined;
    if (res.status === 401 || res.status === 403) {
      note = "Login works but the READ endpoint refused the session — your myACLED account most likely doesn't have API data access enabled yet. Log in at acleddata.com → check API access / accept the data-access terms, then retry.";
    } else if (apiError) {
      note = `ACLED rejected the query: ${apiError}`;
    } else if (count === 0) {
      note = "Authenticated and the read succeeded, but 0 events came back for the last 7 days — unusual for global Battles. Likely an access tier with no rows, or a query the API didn't like.";
    } else if ((count ?? 0) > 0) {
      note = "Working — events are flowing. If the map is still empty, toggle the ACLED layer on (Standard/Contested preset) and check the AOR filter isn't excluding them.";
    }
    return { configured: true, source, tokenOk: true, readStatus: res.status, count, sample, error: apiError, note };
  } catch (e) {
    return { configured: true, source, tokenOk: true, error: "Read request failed: " + (e instanceof Error ? e.message : String(e)) };
  } finally {
    clearTimeout(tid);
  }
}
