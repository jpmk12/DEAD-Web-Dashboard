// MARAD MSCI advisories — server-only fetch of the first-party RSS feed
// (keyless), parsed by lib/maradParse (pure, tested). 1-h cache (MARAD
// issues one or two advisories a month); fail-safe: a dead feed reads
// `live:false` with the reason and every surface says UNKNOWN, never "no
// advisory in effect". The host is UNREACHABLE from the build sandbox (egress
// blocks maritime.dot.gov), so the feed shape is pinned from the published
// RSS and `diagnoseMarad()` (owner-only, `/api/osint/marad?diag=1`) runs the
// real fetch from production and returns status / bytes / items / parsed /
// snippet — a restyled feed shows there as `parsed: 0` beside a 200.

import { fetchFeed } from "./rss";
import { fetchWithTimeout } from "./fetchTimeout";
import { parseMaradItems, MARAD_FEED_URL, type MaradAdvisory, type MaradSkipped } from "./maradParse";

export interface MaradBody {
  advisories: MaradAdvisory[];
  live: boolean;
  reason: string | null;
  fetchedAt: string;
}

const TTL = 60 * 60 * 1000;
let cache: { at: number; body: MaradBody } | null = null;
let inflight: Promise<MaradBody> | null = null;

export function resetMaradCache(): void { cache = null; }

export async function getMaradAdvisories(): Promise<MaradBody> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inflight) return inflight;
  inflight = load().then((b) => { if (b.live) cache = { at: Date.now(), body: b }; return b; }).finally(() => { inflight = null; });
  return inflight;
}

async function load(): Promise<MaradBody> {
  const fetchedAt = new Date().toISOString();
  try {
    const r = await fetchFeed(MARAD_FEED_URL, "MARAD", "maritime");
    if (!r.ok) return { advisories: cache?.body.advisories ?? [], live: false, reason: r.error ?? "feed unreachable", fetchedAt };
    const advisories = parseMaradItems(r.items.map((n) => ({ title: n.title, link: n.link, pubDate: n.pubDate })), fetchedAt.slice(0, 10));
    // A feed that answered but parsed nothing is a changed title shape, not
    // an empty threat picture — report it as not live.
    if (r.items.length > 0 && advisories.length === 0) return { advisories: [], live: false, reason: "feed answered but no advisory title parsed — check the title shape", fetchedAt };
    return { advisories, live: true, reason: null, fetchedAt };
  } catch (e) {
    return { advisories: cache?.body.advisories ?? [], live: false, reason: e instanceof Error ? e.message : String(e), fetchedAt };
  }
}

export interface MaradDiag { url: string; status: number; ms: number; bytes: number; items: number; parsed: number; snippet: string; error?: string; /** Items the parser set aside and why — the next diag explains itself. */ skipped: MaradSkipped[]; advisories: { number: string; region: string; topic: string; date: string | null; chokepoints: string[]; read: string | null }[] }

/** Owner-only: the real fetch from production, raw. */
export async function diagnoseMarad(): Promise<MaradDiag> {
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(MARAD_FEED_URL, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", Accept: "application/rss+xml, application/xml, text/xml, */*" }, cache: "no-store" }, 15_000);
    const text = await res.text();
    const items = (text.match(/<item>/g) ?? []).length;
    const r = await fetchFeed(MARAD_FEED_URL, "MARAD", "maritime");
    const skipped: MaradSkipped[] = [];
    const parsed = r.ok ? parseMaradItems(r.items.map((n) => ({ title: n.title, link: n.link, pubDate: n.pubDate })), new Date().toISOString().slice(0, 10), undefined, skipped) : [];
    return {
      url: MARAD_FEED_URL, status: res.status, ms: Date.now() - t0, bytes: text.length, items, parsed: parsed.length, snippet: text.slice(0, 300),
      ...(r.ok ? {} : { error: r.error ?? "feed parse failed" }), skipped,
      advisories: parsed.map((a) => ({ number: a.number, region: a.region, topic: a.topic, date: a.date, chokepoints: a.chokepoints, read: a.read ? `${a.read.cls} · ${a.read.modality} · “${a.read.phrase}”` : null })),
    };
  } catch (e) {
    return { url: MARAD_FEED_URL, status: 0, ms: Date.now() - t0, bytes: 0, items: 0, parsed: 0, snippet: "", error: e instanceof Error ? e.message : String(e), skipped: [], advisories: [] };
  }
}
