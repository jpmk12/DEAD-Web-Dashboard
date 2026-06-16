// Force health protection: WHO Disease Outbreak News (DON), the authoritative
// keyless feed of significant outbreaks, matched to a base's country. Coarse SA
// for crew RON / force-health posture — not medical guidance.
//
// Fails safe: an unreachable/unparseable feed reports live:false so the caller
// treats it as "couldn't check", never "no outbreaks".

import Parser from "rss-parser";

const FEED_URL = "https://www.who.int/feeds/entity/csr/don/en/rss.xml";
const UA = "DEAD-Dashboard (https://github.com/jpmk12/dead-web-dashboard)";
const TTL_MS = 6 * 60 * 60 * 1000; // outbreak news is low-frequency
const MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000; // keep ~4 months of items

let cache: { data: HealthEvent[]; live: boolean; expires: number } | null = null;
const parser = new Parser();

export interface HealthEvent {
  disease: string;
  country: string;
  title: string;
  link: string;
  pubDate: string;
}

// WHO DON titles read "Disease – Country" / "Disease - Country – place", e.g.
// "Cholera – Islamic Republic of Afghanistan". Split on the first dash variant.
export function parseHealthTitle(title: string): { disease: string; country: string } {
  const parts = title.split(/\s+[–—-]\s+/);
  const disease = (parts[0] ?? title).trim();
  const country = (parts[1] ?? "").trim();
  return { disease, country };
}

// Pure parse of feed XML → recent outbreak events. Exported for unit tests.
export function parseHealthFeed(xmlItems: { title?: string; link?: string; isoDate?: string; pubDate?: string }[], nowMs: number): HealthEvent[] {
  const out: HealthEvent[] = [];
  for (const item of xmlItems) {
    const title = (item.title ?? "").trim();
    if (!title) continue;
    const when = item.isoDate ?? item.pubDate ?? "";
    const t = Date.parse(when);
    if (Number.isFinite(t) && nowMs - t > MAX_AGE_MS) continue; // stale outbreak
    const { disease, country } = parseHealthTitle(title);
    if (!country) continue; // multi-country / unparseable → skip (no false match)
    out.push({ disease, country, title, link: item.link ?? FEED_URL, pubDate: when });
  }
  return out;
}

export async function getHealthEvents(): Promise<{ live: boolean; events: HealthEvent[] }> {
  if (cache && cache.expires > Date.now()) return { live: cache.live, events: cache.data };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let xml: string;
    try {
      const res = await fetch(FEED_URL, { signal: controller.signal, headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, */*" }, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const feed = await parser.parseString(xml);
    const data = parseHealthFeed(feed.items ?? [], Date.now());
    if (data.length > 0) cache = { data, live: true, expires: Date.now() + TTL_MS };
    return { live: true, events: data };
  } catch {
    // Serve last-good if present; otherwise not-live so the scorer doesn't claim
    // "no outbreaks" when it simply couldn't check.
    if (cache) return { live: cache.live, events: cache.data };
    return { live: false, events: [] };
  }
}
