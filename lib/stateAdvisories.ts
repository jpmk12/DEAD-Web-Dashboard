// U.S. State Department travel advisories → NEO (noncombatant evacuation) watch.
//
// Embassy "ordered departure" / "authorized departure" and Level-4 ("Do Not
// Travel") advisories are the real-world triggers for evacuation airlift, an AMC
// mission. We pull the official State RSS feed, keep the high-threat /
// departure items, and tag each with a COCOM AOR so they can be fused into the
// Glance "Global Reach Watch".
//
// Coarse situational awareness, not authoritative tasking. The RSS description
// is often truncated, so departure language detection is best-effort; Level and
// recency backstop it.

import Parser from "rss-parser";
import { aorFromName } from "./aor";
import type { TravelAdvisory } from "./types";

const FEED_URL = "https://travel.state.gov/_res/rss/TAsTWs.xml";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TTL_MS = 30 * 60 * 1000;
let cache: { data: TravelAdvisory[]; expires: number } | null = null;

const parser = new Parser();

// Threat level lives variously in the title, a <category>, or the description.
function levelFrom(parts: string[]): number | null {
  const m = parts.join(" ").match(/Level\s*([1-4])/i);
  return m ? Number(m[1]) : null;
}

// "Haiti Travel Advisory" / "Haiti - Level 4: Do Not Travel" → "Haiti".
function countryFrom(title: string): string {
  const cleaned = title
    .replace(/\bTravel (Advisory|Warning|Alert)\b/i, "")
    .replace(/[-–—:]\s*Level\s*[1-4].*$/i, "")
    .replace(/[-–—:].*$/, "")
    .trim();
  return cleaned || title.trim();
}

// Pure parse of feed XML → advisories of NEO interest. Exported for unit tests.
export async function parseAdvisories(xml: string): Promise<TravelAdvisory[]> {
  const feed = await parser.parseString(xml);
  const out: TravelAdvisory[] = [];
  for (const item of feed.items ?? []) {
    const title = (item.title ?? "").trim();
    if (!title) continue;
    // The State feed carries the threat level in an ATTRIBUTED category
    // (<category domain="Threat-Level">Level 4: Do Not Travel</category>).
    // rss-parser returns attributed elements as objects ({ _: text, $: attrs }),
    // sometimes with a null prototype — coercing those in a template literal
    // throws "Cannot convert object to primitive value", which previously killed
    // the whole parse and blanked every advisory. Normalize categories to strings.
    const cats = (Array.isArray(item.categories) ? item.categories : [])
      .map((c) => (typeof c === "string" ? c : c && typeof c === "object" && "_" in (c as object) ? String((c as { _: unknown })._ ?? "") : ""))
      .filter(Boolean);
    const body = item.contentSnippet ?? item.content ?? (item as { summary?: string }).summary ?? "";
    const text = `${title} ${cats.join(" ")} ${body}`;
    const level = levelFrom([title, ...cats, body]);
    // State writes both the noun ("Ordered Departure status") and the verb
    // ("ordered the departure of family members"), so allow an optional "the".
    const orderedDeparture = /order(?:ed)?\s+(?:the\s+)?departure/i.test(text);
    const authorizedDeparture = /authoriz(?:ed)?\s+(?:the\s+)?departure/i.test(text);
    // Keep anything with a usable level (1-4) OR a departure signal. The NEO
    // accessor narrows to hot spots; the force-protection accessor wants all
    // levels so a base in a Level-2/3 country can score its civil axis.
    if (!(level != null || orderedDeparture || authorizedDeparture)) continue;
    const country = countryFrom(title);
    out.push({
      country,
      level,
      aor: aorFromName(country),
      orderedDeparture,
      authorizedDeparture,
      title,
      link: item.link ?? FEED_URL,
      pubDate: item.isoDate ?? item.pubDate ?? "",
    });
  }
  // Ordered departure (active evac) first, then authorized, then Level 4;
  // newer within a tier first.
  const rank = (a: TravelAdvisory) => (a.orderedDeparture ? 0 : a.authorizedDeparture ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b) || Date.parse(b.pubDate || "0") - Date.parse(a.pubDate || "0"));
  return out;
}

// Owner-only diagnostic: did the fetch reach travel.state.gov, and did the parse
// yield rows? Distinguishes a 403/unreachable feed (datacenter blocking, like
// Stooq/Yahoo) from a parse failure. Network — gate behind owner auth.
export async function diagnoseStateAdvisories(): Promise<{
  status: number; ok: boolean; bytes: number; parsed: number; withLevel: number; sample?: string; error?: string;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response, xml: string;
    try {
      res = await fetch(FEED_URL, { signal: controller.signal, headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" }, cache: "no-store" });
      xml = await res.text();
    } finally { clearTimeout(timer); }
    let parsed = 0, withLevel = 0, sample: string | undefined;
    if (res.ok) {
      const advs = await parseAdvisories(xml).catch(() => [] as TravelAdvisory[]);
      parsed = advs.length;
      withLevel = advs.filter((a) => a.level != null).length;
      const f = advs[0];
      if (f) sample = `${f.country} · L${f.level ?? "?"}${f.orderedDeparture ? " · ordered-dep" : ""}`;
    }
    return { status: res.status, ok: res.ok, bytes: xml.length, parsed, withLevel, ...(sample ? { sample } : {}) };
  } catch (e) {
    return { status: 0, ok: false, bytes: 0, parsed: 0, withLevel: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// Hot-spots only (Level 4 / embassy departure) — the NEO/evacuation watch used
// by the Crisis demand read and the Glance "Global Reach Watch". Unchanged
// behaviour for those callers.
export async function getStateAdvisories(): Promise<TravelAdvisory[]> {
  const all = await getAllStateAdvisories();
  return all.filter((a) => a.level === 4 || a.orderedDeparture || a.authorizedDeparture);
}

// Every current advisory with a level (1-4) or departure signal — used by the
// Force Protection scorer to colour the civil/diplomatic axis even at Level 2/3.
export async function getAllStateAdvisories(): Promise<TravelAdvisory[]> {
  if (cache && cache.expires > Date.now()) return cache.data;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let xml: string;
    try {
      const res = await fetch(FEED_URL, {
        signal: controller.signal,
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const data = await parseAdvisories(xml);
    // Only cache a non-empty parse. State always has Level-4s in practice, so
    // an empty result almost certainly means a feed-format change — caching it
    // would blank the NEO watch for 30 min instead of retrying next call.
    if (data.length > 0) cache = { data, expires: Date.now() + TTL_MS };
    return data;
  } catch {
    return cache?.data ?? []; // unreachable/parse failure → last good or empty
  }
}
