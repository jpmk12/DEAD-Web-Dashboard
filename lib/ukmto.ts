// UKMTO recent incidents — server-only. Judgement is in lib/ukmtoParse.ts
// (pure, tested); this owns the network and the merge with the store.
//
// Three doors, tried in this order:
//   1. The SCCD API — https://sccd.royalnavy.mod.uk/api/ukmto/all — the JSON
//      the recent-incidents page itself fetches (named by the extension's
//      run log, 2026-10-27). Structured, with positions. Its reachability
//      from the host and its record shape are UNVERIFIED (the sandbox cannot
//      reach it); the reader is tolerant and `?diag=1` reports status,
//      records, the first record's keys and a body snippet.
//   2. The direct fetch of https://www.ukmto.org/recent-incidents (browser
//      User-Agent, 12-s timeout). The page's static HTML carries NO
//      incidents (they arrive by the API above), so this door can only ever
//      parse 0 unless the site changes — kept as the fallback it always was.
//   3. The browser capture (tools/x-auto-capture/ukmto.js → POST
//      /api/capture/ukmto): the user's own browser renders the page and posts
//      its text AND the API body it saw; lib/ukmtoStore keeps it.
// All land in captured_ukmto; a read merges the live parse (when any) with
// the store, so an incident captured yesterday is still on the board when
// today's fetch is refused. Fail-safe: a failed fetch is `live: false` with
// its reason, never an empty list pretending to be a quiet sea.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseUkmtoHtml, parseUkmtoApi, mergeUkmto, UKMTO_URL, UKMTO_API_URL, type UkmtoIncident } from "./ukmtoParse";
import { getStoredUkmto, upsertUkmto, getUkmtoStoreStatus } from "./ukmtoStore";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL = 15 * 60_000;
const FETCH_TIMEOUT_MS = 12_000;
const API_MAX_BYTES = 6 * 1024 * 1024;

export interface UkmtoFetchStatus {
  /** A direct door answered 2xx and parsed at least one entry. */
  live: boolean;
  status: number;
  parsed: number;
  /** Which door is live: the SCCD API or the page; null when neither. */
  door: "api" | "page" | null;
  /** Why it is not live, when it is not. */
  reason: string | null;
  at: string;
}

export interface UkmtoBody {
  incidents: UkmtoIncident[];
  fetch: UkmtoFetchStatus;
  store: { count: number; newest: string | null; captured: number; fetched: number };
  /** Something is on the board from SOME door — the map's "source down"
   *  badge keys on the opposite. */
  ok: boolean;
  generatedAt: string;
}

let cache: { at: number; body: UkmtoBody } | null = null;
let inflight: Promise<UkmtoBody> | null = null;

interface DoorResult { status: number; parsed: number; reason: string | null; incidents: UkmtoIncident[]; snippet: string; bytes: number; records?: number; keys?: string[] }

async function fetchApi(): Promise<DoorResult> {
  try {
    const res = await fetchWithTimeout(UKMTO_API_URL, {
      headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-GB,en;q=0.8", Origin: "https://www.ukmto.org", Referer: UKMTO_URL },
      cache: "no-store",
    }, FETCH_TIMEOUT_MS);
    const text = (await res.text()).slice(0, API_MAX_BYTES);
    if (!res.ok) return { status: res.status, parsed: 0, reason: `API HTTP ${res.status}${res.status === 403 ? " — the host refuses this address" : ""}`, incidents: [], snippet: text.slice(0, 300), bytes: text.length };
    let json: unknown;
    try { json = JSON.parse(text); } catch { return { status: res.status, parsed: 0, reason: "API answered but not JSON", incidents: [], snippet: text.slice(0, 300), bytes: text.length }; }
    const p = parseUkmtoApi(json);
    const reason = p.records === 0 ? "API answered but no records found (shape changed — see keys)" : p.incidents.length === 0 ? "API records carry no reference the reader recognises (see keys)" : null;
    return { status: res.status, parsed: p.incidents.length, reason, incidents: p.incidents, snippet: text.slice(0, 300), bytes: text.length, records: p.records, keys: p.keys };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, parsed: 0, reason: /abort/i.test(msg) ? `API timed out after ${FETCH_TIMEOUT_MS / 1000} s` : `API ${msg.slice(0, 160)}`, incidents: [], snippet: "", bytes: 0 };
  }
}

async function fetchPage(): Promise<DoorResult> {
  try {
    const res = await fetchWithTimeout(UKMTO_URL, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-GB,en;q=0.8" },
      cache: "no-store",
    }, FETCH_TIMEOUT_MS);
    const html = await res.text();
    const incidents = res.ok ? parseUkmtoHtml(html) : [];
    const reason = !res.ok
      ? `page HTTP ${res.status}${res.status === 403 ? " — the host refuses this address (capture the page with the extension)" : ""}`
      : incidents.length === 0 ? "page answered but carries no entries (they are loaded by script from the SCCD API — capture the page with the extension)" : null;
    return { status: res.status, parsed: incidents.length, reason, incidents, snippet: html.slice(0, 200), bytes: html.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, parsed: 0, reason: /abort/i.test(msg) ? `page timed out after ${FETCH_TIMEOUT_MS / 1000} s` : `page ${msg.slice(0, 160)}`, incidents: [], snippet: "", bytes: 0 };
  }
}

async function fetchLive(): Promise<{ status: UkmtoFetchStatus; incidents: UkmtoIncident[]; api: DoorResult; page: DoorResult | null }> {
  const at = new Date().toISOString();
  const api = await fetchApi();
  if (api.parsed > 0) return { status: { live: true, status: api.status, parsed: api.parsed, door: "api", reason: null, at }, incidents: api.incidents, api, page: null };
  const page = await fetchPage();
  if (page.parsed > 0) return { status: { live: true, status: page.status, parsed: page.parsed, door: "page", reason: null, at }, incidents: page.incidents, api, page };
  return { status: { live: false, status: api.status || page.status, parsed: 0, door: null, reason: [api.reason, page.reason].filter(Boolean).join("; "), at }, incidents: [], api, page };
}

async function compute(): Promise<UkmtoBody> {
  const live = await fetchLive();
  if (live.incidents.length) await upsertUkmto(live.incidents, "fetch").catch(() => {});
  const stored = await getStoredUkmto().catch(() => [] as UkmtoIncident[]);
  const incidents = mergeUkmto(stored, live.incidents);
  const store = await getUkmtoStoreStatus().catch(() => ({ count: 0, newest: null, captured: 0, fetched: 0 }));
  return {
    incidents,
    fetch: live.status,
    store,
    ok: live.status.live || incidents.length > 0,
    generatedAt: new Date().toISOString(),
  };
}

/** The merged incident list (live parse + store), 15-min cached, in-flight
 *  deduped. Never throws. */
export async function getUkmtoIncidents(): Promise<UkmtoBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = compute()
    .then((b) => { cache = { at: Date.now(), body: b }; return b; })
    .catch(async () => {
      const stored = await getStoredUkmto().catch(() => [] as UkmtoIncident[]);
      const b: UkmtoBody = {
        incidents: stored, fetch: { live: false, status: 0, parsed: 0, door: null, reason: "assembly failed", at: new Date().toISOString() },
        store: { count: stored.length, newest: null, captured: 0, fetched: 0 }, ok: stored.length > 0, generatedAt: new Date().toISOString(),
      };
      cache = { at: Date.now() - TTL + 60_000, body: b }; // retry in a minute
      return b;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Drop the cache (a capture just landed). */
export function resetUkmtoCache(): void { cache = null; }

/** Owner-only diagnostic: the real fetches from production — the SCCD API
 *  (status, bytes, records, the first record's keys, a snippet) and the
 *  page — plus the store. How "blocked" / "shape changed" gets proven. */
export async function diagnoseUkmto(): Promise<{
  door: UkmtoFetchStatus["door"]; parsed: number; reason: string | null; ms: number;
  api: { url: string; status: number; bytes: number; records: number; parsed: number; keys: string[]; reason: string | null; snippet: string; sample: string[] };
  page: { url: string; status: number; bytes: number; parsed: number; reason: string | null; snippet: string } | null;
  store: UkmtoBody["store"];
}> {
  const t0 = Date.now();
  const live = await fetchLive();
  const store = await getUkmtoStoreStatus().catch(() => ({ count: 0, newest: null, captured: 0, fetched: 0 }));
  return {
    door: live.status.door, parsed: live.status.parsed, reason: live.status.reason, ms: Date.now() - t0,
    api: {
      url: UKMTO_API_URL, status: live.api.status, bytes: live.api.bytes, records: live.api.records ?? 0, parsed: live.api.parsed, keys: live.api.keys ?? [],
      reason: live.api.reason, snippet: live.api.snippet,
      sample: live.api.incidents.slice(0, 5).map((i) => `${i.ref} | ${i.label} | ${i.date ?? "-"} ${i.time ?? ""} | ${i.placement ?? "unplaced"}${i.lat != null ? ` ${i.lat.toFixed(2)},${i.lon!.toFixed(2)}` : ""} | ${i.text.slice(0, 80)}`),
    },
    page: live.page ? { url: UKMTO_URL, status: live.page.status, bytes: live.page.bytes, parsed: live.page.parsed, reason: live.page.reason, snippet: live.page.snippet } : null,
    store,
  };
}
