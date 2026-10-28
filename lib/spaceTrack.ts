// Space-Track (18th Space Defense Squadron's public catalogue) — SERVER-ONLY.
// The element-set history behind the counterspace indicator: where the May
// 2026 plane change of the Kosmos 2612 group was visible four months before
// the wire (docs/PLAN-SPACE-CYBER-ASK.md §1). Parsing and judgement live in
// lib/counterspace.ts (pure, tested).
//
// Access: a free account, SPACETRACK_USER / SPACETRACK_PASS in the env. Login
// is a form POST to /ajaxauth/login that answers with a session cookie (the
// ACLED pattern — captured via undici's getSetCookie and sent on every
// query); the session is cached in-process and re-established on a 401.
// Rate limits per the site's terms: ≤30 requests/minute, ≤300/hour. This
// module makes at most THREE queries per pass (satcat name resolution, fleet
// GP history, asset GP) and caches for a day, so a 15-minute poll never
// comes near them.
//
// UNREACHABLE FROM THE SANDBOX (connect refused) and unverified from
// production: `/api/spectrum?diag=1` carries a Space-Track row. Without
// credentials the fetchers answer `live:false` with "not configured" — the
// counterspace indicator then runs on reporting alone and says so. Nothing
// here probes anything but Space-Track's own API.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseGpRows, INSPECTOR_FLEET, type ElementSet, type AssetOfInterest, type FleetEntry } from "./counterspace";

const BASE = "https://www.space-track.org";
const LOGIN_URL = `${BASE}/ajaxauth/login`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function spaceTrackConfigured(): boolean {
  return !!(process.env.SPACETRACK_USER && process.env.SPACETRACK_PASS);
}

let session: { cookie: string; expires: number } | null = null;
const SESSION_TTL = 6 * 3600_000;

function cookieHeaderFrom(res: Response): string | null {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === "function" ? h.getSetCookie() : (h.get("set-cookie") ? [h.get("set-cookie") as string] : []);
  const pairs: string[] = [];
  for (const c of list) { const first = c.split(";")[0]?.trim(); if (first && first.includes("=")) pairs.push(first); }
  return pairs.length ? pairs.join("; ") : null;
}

let loginInflight: Promise<string | null> | null = null;

/** One login at a time — concurrent passes share it (code review 2026-10-28). */
async function login(): Promise<string | null> {
  if (session && Date.now() < session.expires) return session.cookie;
  if (loginInflight) return loginInflight;
  loginInflight = doLogin().finally(() => { loginInflight = null; });
  return loginInflight;
}

async function doLogin(): Promise<string | null> {
  const user = process.env.SPACETRACK_USER, pass = process.env.SPACETRACK_PASS;
  if (!user || !pass) return null;
  try {
    const body = new URLSearchParams({ identity: user, password: pass });
    const res = await fetchWithTimeout(LOGIN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body, cache: "no-store", redirect: "manual" }, 15_000);
    const cookie = cookieHeaderFrom(res);
    if (!cookie || (res.status >= 400)) { console.error(`[space-track] login failed: HTTP ${res.status}`); return null; }
    session = { cookie, expires: Date.now() + SESSION_TTL };
    return cookie;
  } catch (e) {
    console.error("[space-track] login error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface StResult<T> { live: boolean; status: number; data: T; reason: string | null }

/** One query against /basicspacedata; re-logs once on a 401/403. */
async function query<T>(path: string, parse: (json: unknown) => T, empty: T, timeoutMs = 25_000): Promise<StResult<T>> {
  if (!spaceTrackConfigured()) return { live: false, status: 0, data: empty, reason: "not configured (SPACETRACK_USER / SPACETRACK_PASS)" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const cookie = await login();
    if (!cookie) return { live: false, status: 0, data: empty, reason: "login failed" };
    try {
      const res = await fetchWithTimeout(`${BASE}/basicspacedata/query/${path}`, { headers: { Cookie: cookie, Accept: "application/json", "User-Agent": UA }, cache: "no-store" }, timeoutMs);
      if ((res.status === 401 || res.status === 403) && attempt === 0) { session = null; continue; }
      if (!res.ok) return { live: false, status: res.status, data: empty, reason: `HTTP ${res.status}` };
      const json = await res.json().catch(() => null);
      return { live: true, status: res.status, data: parse(json), reason: null };
    } catch (e) {
      return { live: false, status: 0, data: empty, reason: e instanceof Error ? e.message.slice(0, 120) : String(e) };
    }
  }
  return { live: false, status: 0, data: empty, reason: "login rejected twice" };
}

// ─── satcat name resolution ───────────────────────────────────────────────────

export interface SatcatRow { noradId: number; name: string; decayed: boolean; launch: string | null }

function parseSatcat(json: unknown): SatcatRow[] {
  const rows = Array.isArray(json) ? json : [];
  const out: SatcatRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = Number(o.NORAD_CAT_ID);
    const name = typeof o.OBJECT_NAME === "string" ? o.OBJECT_NAME.trim() : typeof o.SATNAME === "string" ? o.SATNAME.trim() : "";
    if (!Number.isInteger(id) || !name) continue;
    out.push({ noradId: id, name, decayed: !!(typeof o.DECAY === "string" && o.DECAY) , launch: typeof o.LAUNCH === "string" ? o.LAUNCH : null });
  }
  return out;
}

// Keyed caches, not single slots (code review 2026-10-28): the fleet and the
// assets resolve different pattern sets, and the RUS and CHN passes ask for
// different id sets, so one slot per kind evicted the other every hour and
// re-queried Space-Track several times an hour against "≤3 per pass, a day".
const CACHE_CAP = 16;
function putCapped<V extends { at: number }>(m: Map<string, V>, key: string, v: V): void {
  m.set(key, v);
  if (m.size > CACHE_CAP) { const oldest = [...m.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) m.delete(oldest[0]); }
}
const satcatCache = new Map<string, { at: number; rows: SatcatRow[] }>();
const SATCAT_TTL = 7 * 86_400_000;

/** Catalogue rows whose OBJECT_NAME starts with any of the patterns
 *  (Space-Track's `~~` LIKE operator; `PAYLOAD` only, on orbit only).
 *  ONE request for the whole pattern set, cached a week. */
export async function resolveByName(patterns: string[]): Promise<StResult<SatcatRow[]>> {
  const key = [...new Set(patterns.map((p) => p.trim().toUpperCase()).filter(Boolean))].sort().join("|");
  if (!key) return { live: true, status: 200, data: [], reason: null };
  const sc = satcatCache.get(key);
  if (sc && Date.now() - sc.at < SATCAT_TTL) return { live: true, status: 200, data: sc.rows, reason: null };
  // OBJECT_NAME/~~A,~~B is not supported in one predicate; the OR form is a
  // comma list of LIKE values on the same field.
  const names = key.split("|").map((p) => `~~${encodeURIComponent(p)}`).join(",");
  const r = await query<SatcatRow[]>(`class/satcat/OBJECT_NAME/${names}/DECAY/null-val/OBJECT_TYPE/PAYLOAD/orderby/LAUNCH%20desc/limit/400/format/json`, parseSatcat, []);
  if (r.live) putCapped(satcatCache, key, { at: Date.now(), rows: r.data });
  return r;
}

// ─── element sets ─────────────────────────────────────────────────────────────

const historyCache = new Map<string, { at: number; sets: ElementSet[] }>();
const currentCache = new Map<string, { at: number; sets: ElementSet[] }>();
const GP_TTL = 20 * 3600_000;   // one pull a day; the heartbeat drives it

/** Element-set HISTORY for the fleet ids over the trailing `days`
 *  (gp_history is complete back to the object's launch; ≥30 days gives the
 *  90-day cadence after three pulls). */
export async function fleetHistory(ids: number[], days = 35): Promise<StResult<ElementSet[]>> {
  const list = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  // No fleet object resolved = nothing was observed, never an observed calm
  // day (the caller writes the rpo: series only from a live read).
  if (!list.length) return { live: false, status: 0, data: [], reason: "no fleet object resolved in the catalogue" };
  const key = list.join(",");
  const hc = historyCache.get(key);
  if (hc && Date.now() - hc.at < GP_TTL) return { live: true, status: 200, data: hc.sets, reason: null };
  const r = await query<ElementSet[]>(`class/gp_history/NORAD_CAT_ID/${key}/EPOCH/%3Enow-${days}/orderby/EPOCH%20asc/format/json`, parseGpRows, [], 40_000);
  if (r.live) putCapped(historyCache, key, { at: Date.now(), sets: r.data });
  return r;
}

/** The CURRENT element set for the given ids (assets need no history). */
export async function currentSets(ids: number[]): Promise<StResult<ElementSet[]>> {
  const list = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  if (!list.length) return { live: true, status: 200, data: [], reason: null };
  const key = list.join(",");
  const cc = currentCache.get(key);
  if (cc && Date.now() - cc.at < GP_TTL) return { live: true, status: 200, data: cc.sets, reason: null };
  const r = await query<ElementSet[]>(`class/gp/NORAD_CAT_ID/${key}/orderby/NORAD_CAT_ID/format/json`, parseGpRows, [], 30_000);
  if (r.live) putCapped(currentCache, key, { at: Date.now(), sets: r.data });
  return r;
}

export function resetSpaceTrackCaches(): void { session = null; satcatCache.clear(); historyCache.clear(); currentCache.clear(); }

// ─── resolution of the catalogue ─────────────────────────────────────────────

export interface ResolvedFleet { entries: (FleetEntry & { noradId: number })[]; unresolved: string[] }
export interface ResolvedAssets { objects: { noradId: number; name: string; asset: AssetOfInterest }[]; unresolved: string[] }

/** Fleet entries with ids: the curated id when given, else the satcat row
 *  whose name matches exactly (never a prefix — "COSMOS 2612" must not
 *  resolve to COSMOS 2612's debris). */
export async function resolveFleet(): Promise<{ fleet: ResolvedFleet; live: boolean; reason: string | null }> {
  const need = INSPECTOR_FLEET.filter((f) => f.noradId == null).map((f) => f.name);
  const r = need.length ? await resolveByName(need) : { live: true, status: 200, data: [] as SatcatRow[], reason: null };
  const byName = new Map<string, SatcatRow[]>();
  for (const row of r.data) { const k = row.name.toUpperCase(); (byName.get(k) ?? byName.set(k, []).get(k)!).push(row); }
  const entries: ResolvedFleet["entries"] = [];
  const unresolved: string[] = [];
  for (const f of INSPECTOR_FLEET) {
    if (f.noradId != null) { entries.push({ ...f, noradId: f.noradId }); continue; }
    const rows = byName.get(f.name.toUpperCase())?.filter((x) => !x.decayed) ?? [];
    if (rows.length === 1) entries.push({ ...f, noradId: rows[0].noradId });
    else unresolved.push(f.name);
  }
  return { fleet: { entries, unresolved }, live: r.live, reason: r.reason };
}

/** Declared assets → on-orbit catalogue objects (prefix match for a
 *  constellation name, exact id when given). */
export async function resolveAssets(assets: AssetOfInterest[]): Promise<{ assets: ResolvedAssets; live: boolean; reason: string | null }> {
  const patterns = assets.filter((a) => a.noradId == null).map((a) => a.name);
  const r = patterns.length ? await resolveByName(patterns) : { live: true, status: 200, data: [] as SatcatRow[], reason: null };
  const objects: ResolvedAssets["objects"] = [];
  const seen = new Set<number>();
  for (const a of assets) {
    if (a.noradId != null) { if (!seen.has(a.noradId)) { seen.add(a.noradId); objects.push({ noradId: a.noradId, name: a.name, asset: a }); } continue; }
    for (const row of r.data) {
      if (row.decayed || seen.has(row.noradId)) continue;
      if (row.name.toUpperCase().startsWith(a.name.toUpperCase())) { seen.add(row.noradId); objects.push({ noradId: row.noradId, name: row.name, asset: a }); }
    }
  }
  const unresolved = assets.filter((a) => !objects.some((o) => o.asset === a)).map((a) => a.name);
  return { assets: { objects, unresolved }, live: r.live, reason: r.reason };
}

// ─── diagnostics ──────────────────────────────────────────────────────────────

export async function diagnoseSpaceTrack(): Promise<{ configured: boolean; login: { ok: boolean; status: number; reason: string | null }; satcat: { status: number; rows: number; reason: string | null; ms: number } }> {
  const t0 = Date.now();
  if (!spaceTrackConfigured()) return { configured: false, login: { ok: false, status: 0, reason: "SPACETRACK_USER / SPACETRACK_PASS not set" }, satcat: { status: 0, rows: 0, reason: "not configured", ms: 0 } };
  session = null;
  const cookie = await login();
  const r = cookie ? await query<SatcatRow[]>("class/satcat/OBJECT_NAME/~~COSMOS%202558/format/json", parseSatcat, []) : null;
  return {
    configured: true,
    login: { ok: !!cookie, status: cookie ? 200 : 0, reason: cookie ? null : "login failed — check credentials and that the host answers this address" },
    satcat: { status: r?.status ?? 0, rows: r?.data.length ?? 0, reason: r?.reason ?? (cookie ? null : "no session"), ms: Date.now() - t0 },
  };
}
