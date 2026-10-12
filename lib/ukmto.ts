// UKMTO recent incidents — server-only. Judgement is in lib/ukmtoParse.ts
// (pure, tested); this owns the network and the merge with the store.
//
// Two doors, because the host's reachability is UNKNOWN from here:
//   1. The direct fetch of https://www.ukmto.org/recent-incidents (browser
//      User-Agent, 12-s timeout, 15-min cache). The host is unreachable from
//      the dev sandbox and from the fetcher, and a third-party maritime
//      tracker reports that UKMTO blocks automated access — so this may
//      simply 403 in production. `?diag=1` on /api/osint/ukmto says which.
//   2. The browser capture (tools/x-auto-capture/ukmto.js → POST
//      /api/capture/ukmto), the LiveUAMap / MOFCOM pattern: the user's own
//      browser renders the page and posts its text; lib/ukmtoStore keeps it.
// Both land in captured_ukmto; a read merges the live parse (when any) with
// the store, so an incident captured yesterday is still on the board when
// today's fetch is refused. Fail-safe: a failed fetch is `live: false` with
// its reason, never an empty list pretending to be a quiet sea.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseUkmtoHtml, mergeUkmto, UKMTO_URL, type UkmtoIncident } from "./ukmtoParse";
import { getStoredUkmto, upsertUkmto, getUkmtoStoreStatus } from "./ukmtoStore";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL = 15 * 60_000;
const FETCH_TIMEOUT_MS = 12_000;

export interface UkmtoFetchStatus {
  /** The direct fetch answered 2xx and parsed at least one entry. */
  live: boolean;
  status: number;
  parsed: number;
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

async function fetchLive(): Promise<{ status: UkmtoFetchStatus; incidents: UkmtoIncident[]; snippet: string; bytes: number }> {
  const at = new Date().toISOString();
  try {
    const res = await fetchWithTimeout(UKMTO_URL, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-GB,en;q=0.8" },
      cache: "no-store",
    }, FETCH_TIMEOUT_MS);
    const html = await res.text();
    const incidents = res.ok ? parseUkmtoHtml(html) : [];
    const reason = !res.ok
      ? `HTTP ${res.status}${res.status === 403 ? " — the host refuses this address (capture the page with the extension)" : ""}`
      : incidents.length === 0 ? "page answered but no entries parsed (markup changed, or the list is rendered by script — capture the page with the extension)" : null;
    return { status: { live: res.ok && incidents.length > 0, status: res.status, parsed: incidents.length, reason, at }, incidents, snippet: html.slice(0, 200), bytes: html.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: { live: false, status: 0, parsed: 0, reason: /abort/i.test(msg) ? `timed out after ${FETCH_TIMEOUT_MS / 1000} s` : msg.slice(0, 160), at }, incidents: [], snippet: "", bytes: 0 };
  }
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
        incidents: stored, fetch: { live: false, status: 0, parsed: 0, reason: "assembly failed", at: new Date().toISOString() },
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

/** Owner-only diagnostic: the real fetch from production, with the status,
 *  bytes, parsed count and a body snippet — how "blocked" gets proven. */
export async function diagnoseUkmto(): Promise<{ url: string; status: number; ms: number; bytes: number; parsed: number; reason: string | null; snippet: string; store: UkmtoBody["store"] }> {
  const t0 = Date.now();
  const live = await fetchLive();
  const store = await getUkmtoStoreStatus().catch(() => ({ count: 0, newest: null, captured: 0, fetched: 0 }));
  return { url: UKMTO_URL, status: live.status.status, ms: Date.now() - t0, bytes: live.bytes, parsed: live.status.parsed, reason: live.status.reason, snippet: live.snippet, store };
}
