// Server fetchers for the Crisis map's "Conflict zones" layer (FAA KICZ /
// SFAR + EASA CZIBs). Server-only, fail-safe (a dead door is `live:false`
// with its reason — UNKNOWN, never "no restrictions"), cached 1 h, in-flight
// deduped, a failed read held 5 min. Parsers: lib/conflictZones.ts (pure).
//
// Doors (all UNVERIFIED from the build sandbox — `/api/osint/conflict-zones
// ?diag=1`, owner-only, runs every one from production):
//   FAA 1  DAIP LOCATION query for "KICZ" — the FAA's conflict-zone NOTAMs
//          (the full text: FIR, altitude, prohibited / advisory). Same DoD-CA
//          door the SITREP NOTAMs use, already verified in production.
//   FAA 2  the FAA "Prohibitions, Restrictions and Notices" page — its KICZ
//          document links fill any NOTAM the DAIP read did not return.
//   EASA   the CZIB listing (number, title, dates, status) + each active
//          bulletin's own page (FIRs, recommendation, validity; ≤20, 24-h
//          cache per page).

import { fetchWithTimeout } from "./fetchTimeout";
import { fetchDaipQuery } from "./notams";
import { runLimited } from "./concurrency";
import { htmlToText } from "./ukmtoParse";
import { htmlPageSummary } from "./mapHazards";
import {
  parseKiczNotam, parseFaaRestrictionsPage, mergeFaaZones, parseCzibListing, parseCzibPage, czibMainContent, czibZone, sortZones,
  type ConflictZone, type CzibEntry, type CzibPage,
} from "./conflictZones";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const FAA_RESTRICTIONS_URL = "https://www.faa.gov/air_traffic/publications/us_restrictions";
export const EASA_CZIB_URLS = [
  "https://www.easa.europa.eu/en/domains/air-operations/czibs",
  "https://www.easa.europa.eu/en/conflict-zone-information-bulletin-czibs",
];
const TTL = 60 * 60_000;
const FAIL_HOLD = 5 * 60_000;
const PAGE_TTL = 24 * 60 * 60_000;
const MAX_PAGES = 20;

export interface ConflictZonesBody {
  live: boolean;
  faa: { live: boolean; configured: boolean; notams: number; page: number; reason: string | null };
  easa: { live: boolean; entries: number; active: number; pagesRead: number; pagesOf: number; reason: string | null };
  zones: ConflictZone[];
  unplaced: number;
  asOf: string;
}

async function getText(url: string, ms: number, maxBytes = 3_000_000): Promise<{ status: number; text: string; error: string | null }> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, cache: "no-store" }, ms);
    const text = (await res.text()).slice(0, maxBytes);
    return { status: res.status, text, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { status: 0, text: "", error: e instanceof Error ? e.message.slice(0, 160) : "fetch failed" };
  }
}

/** DAIP's group → notams → list envelope → { text, start, end } per NOTAM
 *  (rawtext preferred — it carries the FIR code and the B)/C) times). */
function daipItems(raw: string): { text: string; start?: string; end?: string }[] {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return []; }
  const out: { text: string; start?: string; end?: string }[] = [];
  const groups = (j as { group?: unknown[] })?.group;
  if (!Array.isArray(groups)) return out;
  const take = (it: Record<string, unknown>) => {
    const id = String(it.idshow ?? it.id ?? "").trim();
    const body = String(it.rawtext ?? "").trim() || String(it.text ?? "").trim();
    if (!body) return;
    const text = id && !body.includes(id) ? `${id} ${body}` : body;
    out.push({ text, start: typeof it.startdate === "string" ? it.startdate : undefined, end: typeof it.enddate === "string" ? it.enddate : undefined });
  };
  for (const g of groups) {
    const ws = (g as { notams?: unknown[] })?.notams;
    if (!Array.isArray(ws)) continue;
    for (const w of ws) {
      if (!w || typeof w !== "object") continue;
      const list = (w as { list?: unknown[] }).list;
      if (Array.isArray(list)) { for (const it of list) if (it && typeof it === "object") take(it as Record<string, unknown>); }
      else take(w as Record<string, unknown>);
    }
  }
  return out;
}

/** C) YYMMDDHHMM → ISO; PERM / EST / absent → undefined. */
function notamTimeIso(text: string, field: "B" | "C"): string | undefined {
  const m = text.match(new RegExp(`\\b${field}\\)\\s*(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})`));
  if (!m) return undefined;
  return `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`;
}

async function faaFromDaip(nowMs: number): Promise<{ configured: boolean; live: boolean; zones: ConflictZone[]; rows: number; raw: string | null }> {
  const { configured, raw } = await fetchDaipQuery({ type: "LOCATION", locations: ["KICZ"] });
  if (!configured || raw == null) return { configured, live: false, zones: [], rows: 0, raw };
  const items = daipItems(raw);
  const zones: ConflictZone[] = [];
  for (const it of items) {
    const start = notamTimeIso(it.text, "B") ?? it.start;
    const end = notamTimeIso(it.text, "C") ?? it.end;
    if (end && Date.parse(end) < nowMs) continue;
    const z = parseKiczNotam(it.text, { start, end });
    if (z) zones.push(z);
  }
  // A body that parsed as DAIP's envelope is live even with no NOTAM in it.
  let envelope = false;
  try { envelope = Array.isArray((JSON.parse(raw) as { group?: unknown }).group); } catch { /* not JSON */ }
  return { configured, live: envelope, zones, rows: items.length, raw };
}

const pageCache = new Map<string, { at: number; page: CzibPage | null }>();

async function czibPage(url: string): Promise<CzibPage | null> {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < (hit.page ? PAGE_TTL : FAIL_HOLD)) return hit.page;
  const r = await getText(url, 8_000, 1_500_000);
  const page = r.error ? null : parseCzibPage(r.text);
  pageCache.set(url, { at: Date.now(), page });
  return page;
}

async function easaListing(): Promise<{ entries: CzibEntry[]; url: string; status: number; text: string; error: string | null }> {
  let last = { entries: [] as CzibEntry[], url: EASA_CZIB_URLS[0], status: 0, text: "", error: "not tried" as string | null };
  for (const url of EASA_CZIB_URLS) {
    const r = await getText(url, 12_000);
    const entries = r.error ? [] : parseCzibListing(r.text, url);
    last = { entries, url, status: r.status, text: r.text, error: r.error ?? (entries.length ? null : "listing answered but no CZIB number found (layout changed — see the diag)") };
    if (entries.length) return last;
  }
  return last;
}

const todayYmd = () => new Date().toISOString().slice(0, 10);

async function load(): Promise<ConflictZonesBody> {
  const now = Date.now();
  const [daip, faaPage, listing] = await Promise.all([
    faaFromDaip(now).catch(() => ({ configured: true, live: false, zones: [] as ConflictZone[], rows: 0, raw: null })),
    getText(FAA_RESTRICTIONS_URL, 12_000),
    easaListing(),
  ]);
  const pageZones = faaPage.error ? [] : parseFaaRestrictionsPage(faaPage.text);
  const faaZones = mergeFaaZones(daip.zones, pageZones);
  const faaLive = daip.live || (!faaPage.error && pageZones.length > 0);
  const faaReason = [
    !daip.configured ? "DAIP: DoD CA not configured" : !daip.live ? "DAIP KICZ query did not answer" : null,
    faaPage.error ? `FAA page: ${faaPage.error}` : !pageZones.length ? "FAA page: no KICZ links found" : null,
  ].filter(Boolean).join("; ") || null;

  const today = todayYmd();
  const candidates = listing.entries.filter((e) => !["withdrawn", "superseded", "expired"].includes(e.status ?? "") && !(e.validTo && e.validTo < today));
  const withUrl = candidates.filter((e) => e.url).slice(0, MAX_PAGES);
  const pages = new Map<string, CzibPage | null>();
  await runLimited(withUrl, 4, async (e) => { pages.set(e.key, await czibPage(e.url!)); });
  const easaZones = candidates.map((e) => czibZone(e, pages.get(e.key) ?? null, today)).filter((z): z is ConflictZone => !!z);
  const easaLive = listing.entries.length > 0;

  const zones = sortZones([...faaZones, ...easaZones]);
  return {
    live: faaLive || easaLive,
    faa: { live: faaLive, configured: daip.configured, notams: daip.zones.length, page: pageZones.length, reason: faaReason },
    easa: { live: easaLive, entries: listing.entries.length, active: easaZones.length, pagesRead: [...pages.values()].filter(Boolean).length, pagesOf: withUrl.length, reason: easaLive ? null : listing.error },
    zones: zones.filter((z) => z.points.length),
    unplaced: zones.filter((z) => !z.points.length).length,
    asOf: new Date(now).toISOString(),
  };
}

let cache: { at: number; ttl: number; body: ConflictZonesBody } | null = null;
let inflight: Promise<ConflictZonesBody> | null = null;

export async function getConflictZones(): Promise<ConflictZonesBody> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.body;
  if (inflight) return inflight;
  inflight = load()
    .then((b) => {
      // Keep the last good doors when one fails this pass.
      const prev = cache?.body;
      const body = prev && !b.live ? { ...prev, live: false, faa: { ...prev.faa, live: false, reason: b.faa.reason }, easa: { ...prev.easa, live: false, reason: b.easa.reason } } : b;
      cache = { at: Date.now(), ttl: b.faa.live && b.easa.live ? TTL : FAIL_HOLD, body };
      return body;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function resetConflictZonesCache(): void { cache = null; pageCache.clear(); }

const ascii = (s: string) => s.replace(/[–—]/g, "-").replace(/[^\x20-\x7e]/g, "");
const zoneLine = (z: ConflictZone) => ascii(`${z.id} | ${z.level} | ${z.altitude ?? "-"} | FIR ${z.firs.join(",") || "-"} | ${z.countries.join(",") || "-"} | placed ${z.points.map((p) => `${p.by}:${p.name}`).join(";") || "UNPLACED"} | valid ${z.validTo ?? "-"}`);

/** Owner-only diag: every door from production, with what parsed and the
 *  raw text to pin a renamed field from one paste. */
export async function diagnoseConflictZones(): Promise<unknown> {
  const now = Date.now();
  const t0 = Date.now();
  const [daip, faaPage, listing] = await Promise.all([
    faaFromDaip(now).catch((e) => ({ configured: true, live: false, zones: [] as ConflictZone[], rows: 0, raw: null, error: String(e) })),
    getText(FAA_RESTRICTIONS_URL, 15_000),
    easaListing(),
  ]);
  const pageZones = faaPage.error ? [] : parseFaaRestrictionsPage(faaPage.text);
  const listText = listing.text ? htmlToText(listing.text) : "";
  const firstCzib = listText.search(/\bCZIB[\s-]*20\d{2}|\b20\d{2}-\d{2}-?R\d/i);
  const firstUrl = listing.entries.find((e) => e.url && e.status !== "withdrawn")?.url ?? null;
  let bulletin: unknown = null;
  if (firstUrl) {
    const r = await getText(firstUrl, 10_000, 1_500_000);
    const main = r.text ? czibMainContent(r.text) : "";
    const hasMain = r.text ? /<main\b/i.test(r.text) : false;
    bulletin = { url: firstUrl, status: r.status, error: r.error, hasMain, mainChars: main.length, parsed: r.error ? null : parseCzibPage(r.text), excerpt: ascii(main.slice(0, 1500)) };
  }
  return {
    ms: Date.now() - t0,
    faaDaip: {
      configured: daip.configured, live: daip.live, bytes: daip.raw?.length ?? 0, rows: daip.rows, parsed: daip.zones.length,
      sample: daip.zones.slice(0, 6).map(zoneLine),
      rawFirst: daip.raw ? ascii(daip.raw.slice(0, 1500)) : null,
    },
    faaPage: {
      url: FAA_RESTRICTIONS_URL, status: faaPage.status, error: faaPage.error, bytes: faaPage.text.length, parsed: pageZones.length,
      sample: pageZones.slice(0, 8).map(zoneLine),
      page: faaPage.error ? htmlPageSummary(faaPage.text) : null,
      kiczLinks: (faaPage.text.match(/href\s*=\s*["'][^"']*kicz[^"']*["']/gi) ?? []).slice(0, 5),
    },
    easaListing: {
      url: listing.url, status: listing.status, error: listing.error, bytes: listing.text.length, parsed: listing.entries.length,
      entries: listing.entries.slice(0, 12).map((e) => ascii(`${e.label} | ${e.status ?? "status ?"} | ${e.title || "-"} | issued ${e.issued ?? "-"} | valid ${e.validTo ?? "-"} | ${e.url ? "link" : "no link"}`)),
      page: listing.entries.length ? null : htmlPageSummary(listing.text),
      segment: firstCzib >= 0 ? ascii(listText.slice(firstCzib, firstCzib + 900)) : null,
    },
    easaBulletin: bulletin,
  };
}
