// Server fetchers for the Crisis map's two hazard-area layers — SIGMETs (NWS
// Aviation Weather Center) and NGA navigational warnings. Server-only,
// fail-safe (a dead fetch is `live:false` with the reason — UNKNOWN, never
// "no hazards"), cached, in-flight deduped; a failed read is held 60 s.
// Both hosts are blocked from the dev sandbox, so each carries a diag
// (`/api/osint/sigmets?diag=1`, `/api/osint/navwarnings?diag=1`, owner-only)
// that runs the real fetch from production and returns status, bytes, what
// parsed and the first raw row — the contract fix is one paste away.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseSigmets, type Sigmet } from "./sigmetParse";
import { parseNavWarnings, type NavWarning } from "./navWarnParse";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FAIL_HOLD_MS = 60_000;

export const AWC_ISIGMET_URL = "https://aviationweather.gov/api/data/isigmet?format=json";
export const AWC_AIRSIGMET_URL = "https://aviationweather.gov/api/data/airsigmet?format=json";
export const NGA_WARN_URL = "https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active";

async function getJson(url: string, ms: number, maxBytes: number): Promise<{ status: number; body: unknown; bytes: number; text: string; error: string | null }> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store" }, ms);
    const text = (await res.text()).slice(0, maxBytes);
    if (!res.ok) return { status: res.status, body: null, bytes: text.length, text, error: `HTTP ${res.status}` };
    try { return { status: res.status, body: JSON.parse(text), bytes: text.length, text, error: null }; }
    catch { return { status: res.status, body: null, bytes: text.length, text, error: "not JSON" }; }
  } catch (e) {
    return { status: 0, body: null, bytes: 0, text: "", error: e instanceof Error ? e.message.slice(0, 160) : "fetch failed" };
  }
}

// ── SIGMETs ──
export interface SigmetBody { live: boolean; reason: string | null; sigmets: Sigmet[]; noGeometry: number; asOf: string }
const SIG_TTL = 10 * 60 * 1000;
let sigCache: { at: number; body: SigmetBody } | null = null;
let sigInflight: Promise<SigmetBody> | null = null;

async function loadSigmets(): Promise<SigmetBody> {
  const now = Date.now();
  const [intl, dom] = await Promise.all([getJson(AWC_ISIGMET_URL, 12_000, 4_000_000), getJson(AWC_AIRSIGMET_URL, 12_000, 4_000_000)]);
  const a = intl.body != null ? parseSigmets(intl.body, "international", now) : null;
  const b = dom.body != null ? parseSigmets(dom.body, "domestic", now) : null;
  const sigmets = [...(a?.sigmets ?? []), ...(b?.sigmets ?? [])];
  const failed = [intl.error && `international: ${intl.error}`, dom.error && `domestic: ${dom.error}`].filter(Boolean) as string[];
  return {
    live: !!(a || b),
    reason: failed.length ? failed.join("; ") : null,
    sigmets,
    noGeometry: (a?.noGeometry ?? 0) + (b?.noGeometry ?? 0),
    asOf: new Date(now).toISOString(),
  };
}

export async function getSigmets(): Promise<SigmetBody> {
  if (sigCache && Date.now() - sigCache.at < SIG_TTL) return sigCache.body;
  if (sigInflight) return sigInflight;
  sigInflight = loadSigmets()
    .then((b) => { sigCache = { at: b.live ? Date.now() : Date.now() - SIG_TTL + FAIL_HOLD_MS, body: b }; return b; })
    .finally(() => { sigInflight = null; });
  return sigInflight;
}

// ── NGA navigational warnings ──
export interface NavWarnBody { live: boolean; reason: string | null; warnings: NavWarning[]; byClass: Record<string, number>; unplaced: number; asOf: string }
const NAV_TTL = 30 * 60 * 1000;
let navCache: { at: number; body: NavWarnBody } | null = null;
let navInflight: Promise<NavWarnBody> | null = null;

async function loadNav(): Promise<NavWarnBody> {
  const r = await getJson(NGA_WARN_URL, 15_000, 12_000_000);
  const p = r.body != null ? parseNavWarnings(r.body) : null;
  return {
    live: !!p && p.rows > 0,
    reason: r.error ?? (p && p.rows === 0 ? "the feed answered with no rows — check the response shape" : null),
    warnings: p?.warnings ?? [],
    byClass: p?.byClass ?? {},
    unplaced: p?.unplaced ?? 0,
    asOf: new Date().toISOString(),
  };
}

export async function getNavWarnings(): Promise<NavWarnBody> {
  if (navCache && Date.now() - navCache.at < NAV_TTL) return navCache.body;
  if (navInflight) return navInflight;
  navInflight = loadNav()
    .then((b) => { navCache = { at: b.live ? Date.now() : Date.now() - NAV_TTL + FAIL_HOLD_MS, body: b }; return b; })
    .finally(() => { navInflight = null; });
  return navInflight;
}

// ── Diags ──
function firstRaw(body: unknown, pickRows: (b: unknown) => unknown[]): string | null {
  const rows = pickRows(body);
  return rows.length ? JSON.stringify(rows[0]).slice(0, 1200) : null;
}

export async function diagnoseSigmets(): Promise<unknown> {
  const now = Date.now();
  const out = [];
  for (const [kind, url] of [["international", AWC_ISIGMET_URL], ["domestic", AWC_AIRSIGMET_URL]] as const) {
    const r = await getJson(url, 15_000, 4_000_000);
    const p = r.body != null ? parseSigmets(r.body, kind, now) : null;
    const { sigmetRows } = await import("./sigmetParse");
    out.push({
      kind, url, status: r.status, bytes: r.bytes, error: r.error,
      rows: p?.rows ?? 0, parsed: p?.sigmets.length ?? 0, noGeometry: p?.noGeometry ?? 0, airmets: p?.airmets ?? 0, expired: p?.expired ?? 0,
      sample: p?.sigmets.slice(0, 5).map((x) => `${x.fir ?? "?"} | ${x.hazard} | ${x.points.length} pts | ${x.fromISO ?? "?"} → ${x.toISO ?? "?"}`) ?? [],
      rawFirst: r.body != null ? firstRaw(r.body, sigmetRows) : null,
      snippet: r.body == null ? r.text.slice(0, 300) : null,
    });
  }
  return { sources: out };
}

/** An HTML error page → its title and the first visible words, so a diag
 *  can tell an outage ("Service Unavailable", "maintenance") from a refusal
 *  ("Request Rejected", "Access Denied", a support ID). */
export function htmlPageSummary(text: string): { title: string | null; text: string } {
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
  const body = text
    .replace(/<(script|style|noscript|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
  return { title, text: body.slice(0, 400) };
}

async function probe(url: string, headers: Record<string, string>): Promise<{ url: string; as: string; status: number; bytes: number; json: boolean; page: { title: string | null; text: string } | null; error: string | null }> {
  const as = headers["User-Agent"] === UA ? "browser UA" : headers["User-Agent"] ?? "no UA";
  try {
    const res = await fetchWithTimeout(url, { headers, cache: "no-store" }, 15_000);
    const text = (await res.text()).slice(0, 200_000);
    let json = false;
    try { JSON.parse(text); json = true; } catch { /* not JSON */ }
    return { url, as, status: res.status, bytes: text.length, json, page: json ? null : htmlPageSummary(text), error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { url, as, status: 0, bytes: 0, json: false, page: null, error: e instanceof Error ? e.message.slice(0, 160) : "fetch failed" };
  }
}

export async function diagnoseNavWarnings(): Promise<unknown> {
  const r = await getJson(NGA_WARN_URL, 20_000, 12_000_000);
  const p = r.body != null ? parseNavWarnings(r.body) : null;
  const { navWarnRows } = await import("./navWarnParse");
  // When the main request is refused, two variants say whether it is the
  // request (a header the host's filter dislikes) or the host (every request
  // refused = an outage or an IP block).
  const variants = r.body == null
    ? await Promise.all([
      probe(NGA_WARN_URL, { "User-Agent": "dead-dashboard/1.0", Accept: "*/*" }),
      probe("https://msi.nga.mil/api/publications/broadcast-warn?navArea=4&status=active&output=json", { "User-Agent": UA, Accept: "application/json" }),
      probe("https://msi.nga.mil/", { "User-Agent": UA, Accept: "text/html" }),
    ])
    : [];
  return {
    url: NGA_WARN_URL, status: r.status, bytes: r.bytes, error: r.error,
    rows: p?.rows ?? 0, drawn: p?.warnings.length ?? 0, unplaced: p?.unplaced ?? 0, byClass: p?.byClass ?? {},
    sample: p?.warnings.slice(0, 6).map((w) => `${w.area} ${w.number} | ${w.cls} | ${w.shapes.map((s) => `${s.kind}:${s.points.length}`).join(",")} | ${w.where.slice(0, 80)}`) ?? [],
    rawFirst: r.body != null ? firstRaw(r.body, navWarnRows) : null,
    page: r.body == null && r.text ? htmlPageSummary(r.text) : null,
    variants,
    read: r.body != null ? "the feed answered JSON"
      : variants.length && variants.every((v) => v.status >= 500 || v.status === 0) ? "every request refused, the site's home page included — an outage or a block of this server's address, not the query"
      : variants.some((v) => v.json) ? "a variant answered JSON — the main request's headers or query are what the host refuses"
      : "the API refused while the host answered — read `page` and `variants`",
  };
}
