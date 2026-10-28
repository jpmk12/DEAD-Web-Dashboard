// MARAD MSCI advisories — server-only fetch of the first-party RSS feed
// (keyless), parsed by lib/maradParse (pure, tested). 1-h cache (MARAD
// issues one or two advisories a month); fail-safe: a dead feed reads
// `live:false` with the reason and every surface says UNKNOWN, never "no
// advisory in effect". The host is UNREACHABLE from the build sandbox (egress
// blocks maritime.dot.gov), so the feed shape is pinned from the published
// RSS and `diagnoseMarad()` (owner-only, `/api/osint/marad?diag=1`) runs the
// real fetch from production and returns status / bytes / items / parsed /
// snippet — a restyled feed shows there as `parsed: 0` beside a 200.
//
// "In effect" is decided from the advisory PAGE, not the feed date: the
// feed's pubDate is the node's creation date and a reissue ("2026-001A")
// leaves it alone, so the age proxy alone called an in-effect Hormuz
// advisory expired (2026-10-26). Each candidate's page is read once a day
// (≤10 pages, 8 s each, in parallel under the 1-h feed cache) for its
// Cancellation paragraph's expiry and its issue date; `maradInEffect`
// (pure) applies the page's word first and the age proxy only without one,
// and the diag says which decided every row.

import { fetchFeed } from "./rss";
import { fetchWithTimeout } from "./fetchTimeout";
import { htmlToText } from "./ukmtoParse";
import { parseMaradItems, parseMaradTitle, parseMaradPage, maradInEffect, maradPageExcerpts, MARAD_FEED_URL, type MaradAdvisory, type MaradSkipped, type MaradPageInfo, type MaradFeedItem } from "./maradParse";

export interface MaradBody {
  advisories: MaradAdvisory[];
  live: boolean;
  reason: string | null;
  fetchedAt: string;
  /** Advisory pages read for their expiry this pass (cache hits included) / candidates. */
  pages: { read: number; of: number };
}

const TTL = 60 * 60 * 1000;
// A failed read is held a minute (it carries the last good rows forward),
// so an outage upstream does not refetch on every caller (code review
// 2026-10-28).
const FAIL_HOLD_MS = 60_000;
let cache: { at: number; body: MaradBody } | null = null;
let inflight: Promise<MaradBody> | null = null;

export function resetMaradCache(): void { cache = null; pageCache.clear(); }

export async function getMaradAdvisories(): Promise<MaradBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = load().then((b) => { cache = { at: b.live ? Date.now() : Date.now() - TTL + FAIL_HOLD_MS, body: b }; return b; }).finally(() => { inflight = null; });
  return inflight;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PAGE_TTL = 24 * 60 * 60 * 1000;
const PAGE_FAIL_TTL = 60 * 60 * 1000;
const PAGE_MAX = 10;
const pageCache = new Map<string, { at: number; info: MaradPageInfo | null }>();

/** The advisory page's expiry / issue date / cancellation, cached a day
 *  (an hour on failure). Null = the page could not be read — the age proxy
 *  then decides and says so. */
async function pageInfo(url: string): Promise<MaradPageInfo | null> {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < (hit.info ? PAGE_TTL : PAGE_FAIL_TTL)) return hit.info;
  let info: MaradPageInfo | null = null;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, cache: "no-store" }, 8_000);
    if (res.ok) {
      const html = (await res.text()).slice(0, 600_000);
      info = parseMaradPage(htmlToText(html));
    }
  } catch { info = null; }
  pageCache.set(url, { at: Date.now(), info });
  return info;
}

/** Feed items → in-effect advisories, every page consulted. Shared by the
 *  read and the diag so they cannot disagree. */
async function assemble(items: MaradFeedItem[], today: string, skipped: MaradSkipped[]): Promise<{ advisories: MaradAdvisory[]; pages: { read: number; of: number } }> {
  // No age cap here: superseding by region only. The page decides age.
  const cands = parseMaradItems(items, today, Infinity, skipped).slice(0, PAGE_MAX);
  const infos = await Promise.all(cands.map((c) => pageInfo(c.url)));
  const advisories: MaradAdvisory[] = [];
  let read = 0;
  cands.forEach((c, i) => {
    const info = infos[i];
    if (info) read += 1;
    const d = maradInEffect(c, info, today);
    if (!d.keep) { skipped.push({ title: c.title.slice(0, 160), reason: d.reason ?? "expired", note: d.note }); return; }
    advisories.push({ ...c, date: info?.issued ?? c.date, expires: d.expires, expirySource: d.source });
  });
  return { advisories, pages: { read, of: cands.length } };
}

async function load(): Promise<MaradBody> {
  const fetchedAt = new Date().toISOString();
  try {
    const r = await fetchFeed(MARAD_FEED_URL, "MARAD", "maritime");
    if (!r.ok) return { advisories: cache?.body.advisories ?? [], live: false, reason: r.error ?? "feed unreachable", fetchedAt, pages: { read: 0, of: 0 } };
    const skipped: MaradSkipped[] = [];
    const { advisories, pages } = await assemble(r.items.map((n) => ({ title: n.title, link: n.link, pubDate: n.pubDate })), fetchedAt.slice(0, 10), skipped);
    // A feed that answered but parsed nothing is a changed title shape, not
    // an empty threat picture — report it as not live. (Every item expired
    // or cancelled is a real, if unlikely, answer: live with none.)
    const titled = skipped.filter((s) => s.reason !== "title shape" && s.reason !== "foreign link").length + advisories.length;
    if (r.items.length > 0 && titled === 0) return { advisories: [], live: false, reason: "feed answered but no advisory title parsed — check the title shape", fetchedAt, pages };
    return { advisories, live: true, reason: null, fetchedAt, pages };
  } catch (e) {
    return { advisories: cache?.body.advisories ?? [], live: false, reason: e instanceof Error ? e.message : String(e), fetchedAt, pages: { read: 0, of: 0 } };
  }
}

export interface MaradPageDiag {
  number: string; url: string | null; status: number; ms: number; chars: number;
  info: MaradPageInfo | null;
  /** The page's own sentences around expire / cancel / in effect / supersede / issued. */
  excerpts: string[];
  error?: string;
}

/** Owner-only: ONE advisory's page, as text excerpts around the words that
 *  decide "in effect" — the capture-then-build door for a page the sandbox
 *  cannot reach. `number` is matched against the feed's titles
 *  (`2026-001A`, case-insensitive); the page is fetched fresh. */
export async function diagnoseMaradPage(number: string): Promise<MaradPageDiag> {
  const t0 = Date.now();
  const want = number.trim().toUpperCase();
  try {
    const r = await fetchFeed(MARAD_FEED_URL, "MARAD", "maritime");
    if (!r.ok) return { number: want, url: null, status: 0, ms: Date.now() - t0, chars: 0, info: null, excerpts: [], error: r.error ?? "feed unreachable" };
    const all = parseMaradItems(r.items.map((n) => ({ title: n.title, link: n.link, pubDate: n.pubDate })), new Date().toISOString().slice(0, 10), Infinity);
    // parseMaradItems keeps one per region; search the raw titles too so a
    // superseded number can still be inspected.
    const hit = all.find((a) => a.number.toUpperCase() === want)
      ?? r.items.map((n) => ({ p: parseMaradTitle(String(n.title ?? "")), link: String(n.link ?? "") })).find((x) => x.p?.number.toUpperCase() === want);
    const url = hit ? ("url" in hit ? hit.url : hit.link) : null;
    if (!url) return { number: want, url: null, status: 0, ms: Date.now() - t0, chars: 0, info: null, excerpts: [], error: `no feed item numbered ${want} (feed has ${r.items.length} items)` };
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, cache: "no-store" }, 12_000);
    const html = (await res.text()).slice(0, 600_000);
    const text = htmlToText(html);
    return { number: want, url, status: res.status, ms: Date.now() - t0, chars: text.length, info: res.ok ? parseMaradPage(text) : null, excerpts: maradPageExcerpts(text) };
  } catch (e) {
    return { number: want, url: null, status: 0, ms: Date.now() - t0, chars: 0, info: null, excerpts: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export interface MaradDiag {
  url: string; status: number; ms: number; bytes: number; items: number; parsed: number; snippet: string; error?: string;
  /** Advisory pages read for their expiry / of candidates. */
  pages: { read: number; of: number };
  /** Items the parser set aside and why — the next diag explains itself. */
  skipped: MaradSkipped[];
  advisories: { number: string; region: string; topic: string; date: string | null; expires: string | null; expirySource: "page" | "proxy" | null; chokepoints: string[]; read: string | null }[];
}

/** Owner-only: the real fetch from production, raw, plus the page reads. */
export async function diagnoseMarad(): Promise<MaradDiag> {
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(MARAD_FEED_URL, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, cache: "no-store" }, 15_000);
    const text = await res.text();
    const items = (text.match(/<item>/g) ?? []).length;
    const r = await fetchFeed(MARAD_FEED_URL, "MARAD", "maritime");
    const skipped: MaradSkipped[] = [];
    const { advisories, pages } = r.ok
      ? await assemble(r.items.map((n) => ({ title: n.title, link: n.link, pubDate: n.pubDate })), new Date().toISOString().slice(0, 10), skipped)
      : { advisories: [] as MaradAdvisory[], pages: { read: 0, of: 0 } };
    return {
      url: MARAD_FEED_URL, status: res.status, ms: Date.now() - t0, bytes: text.length, items, parsed: advisories.length, snippet: text.slice(0, 300),
      ...(r.ok ? {} : { error: r.error ?? "feed parse failed" }), pages, skipped,
      advisories: advisories.map((a) => ({ number: a.number, region: a.region, topic: a.topic, date: a.date, expires: a.expires ?? null, expirySource: a.expirySource ?? null, chokepoints: a.chokepoints, read: a.read ? `${a.read.cls} · ${a.read.modality} · “${a.read.phrase}”` : null })),
    };
  } catch (e) {
    return { url: MARAD_FEED_URL, status: 0, ms: Date.now() - t0, bytes: 0, items: 0, parsed: 0, snippet: "", error: e instanceof Error ? e.message : String(e), pages: { read: 0, of: 0 }, skipped: [], advisories: [] };
  }
}
