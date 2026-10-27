// Cloudflare Radar — BGP hijack and route-leak events (PURE, client-safe,
// tested in tests/radarBgp.test.ts). Routing security is the half of the
// internet picture the outage sensors cannot see: a prefix announced by the
// wrong network reaches the wrong network, with nothing "down" for IODA or
// an outage annotation to notice. Cloudflare's BGP monitoring publishes the
// events with a CONFIDENCE score (the API's own bands: 1–4 low, 5–7 mid,
// 8–10 high) and names the hijacker and the victims by ASN and country.
//
// Disciplines, the same as the outage read:
//   - a level is EARNED by confidence and recency — a HIGH-confidence hijack
//     against a tracked country's networks that is ongoing or was seen in
//     the last RECENT_HOURS is red; mid confidence, or a route leak that
//     touched the country, is amber; anything older in the window is a note
//     that never colours; low confidence never colours (Cloudflare's own
//     low band is mostly misconfiguration);
//   - a country that appears only as the HIJACKER is listed (it says
//     something about that country's networks) but never earns a level —
//     the read is "against", not "by";
//   - ABSENT means nothing: the CALLER decides green (the feed answered) vs
//     UNKNOWN (it did not);
//   - the contract is pinned from the published reference and UNVERIFIED
//     from the sandbox (api.cloudflare.com is blocked) — `rawFirst` on the
//     diag row is how a renamed field gets corrected after one paste.
//
// Data © Cloudflare, CC BY-NC 4.0 — attribution is rendered wherever shown.

export type BgpBand = "high" | "mid" | "low";
export type BgpLevel = "red" | "amber" | "note";

export interface BgpHijack {
  id: string;
  /** Cloudflare's confidence score, 0–10. */
  confidence: number;
  band: BgpBand;
  hijackerAsn: number | null;
  /** ISO2 of the hijacking network's registration, upper-cased, or null. */
  hijackerCountry: string | null;
  victimAsns: number[];
  /** ISO2 codes of the victims' registration countries. */
  victimCountries: string[];
  prefixes: string[];
  startMs: number;
  /** Last BGP message seen for the event. */
  lastMs: number;
  /** Cloudflare still sees the hijacked route announced. */
  ongoing: boolean;
  stale: boolean;
  tags: string[];
  peerCount: number;
}

export interface BgpLeak {
  id: string;
  leakAsn: number | null;
  /** ISO2 codes the leak involved (origin / leaker / peers' countries). */
  countries: string[];
  originCount: number;
  peerCount: number;
  prefixCount: number;
  leakCount: number;
  startMs: number;
  lastMs: number;
  finished: boolean;
}

export interface BgpAsnInfo { asn: number; country: string | null; org: string }

export interface BgpParse<T> { events: T[]; asnInfo: Record<number, BgpAsnInfo> }

const str = (s: unknown): string => (typeof s === "string" ? s.trim() : "");
const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };
const ms = (s: unknown): number | null => { if (typeof s !== "string" || !s) return null; const t = Date.parse(s); return Number.isFinite(t) ? t : null; };
const iso2 = (s: unknown): string | null => { const c = str(s).toUpperCase(); return /^[A-Z]{2}$/.test(c) ? c : null; };
const iso2List = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(iso2).filter((c): c is string => !!c))] : []);
const asnList = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.map(num).filter((n): n is number => n != null && Number.isInteger(n) && n > 0))] : []);

export function bandOf(confidence: number): BgpBand { return confidence >= 8 ? "high" : confidence >= 5 ? "mid" : "low"; }

function parseAsnInfo(v: unknown): Record<number, BgpAsnInfo> {
  const out: Record<number, BgpAsnInfo> = {};
  if (!Array.isArray(v)) return out;
  for (const r of v as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const asn = num(r.asn);
    if (asn == null || !Number.isInteger(asn) || asn <= 0) continue;
    out[asn] = { asn, country: iso2(r.country_code ?? r.countryCode ?? r.country), org: str(r.org_name ?? r.orgName ?? r.name).slice(0, 80) };
  }
  return out;
}

/** `result.events[]` of /radar/bgp/hijacks/events → hijacks, newest first.
 *  A row with no id or no start time is dropped — never guessed. */
export function parseBgpHijacks(json: unknown): BgpParse<BgpHijack> {
  const result = (json as { result?: Record<string, unknown> } | null)?.result;
  const rows = result?.events;
  const asnInfo = parseAsnInfo(result?.asn_info ?? result?.asnInfo);
  if (!Array.isArray(rows)) return { events: [], asnInfo };
  const events: BgpHijack[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = str(r.id) || (num(r.id) != null ? String(num(r.id)) : "");
    const startMs = ms(r.min_hijack_ts ?? r.minHijackTs ?? r.min_msg_ts ?? r.minMsgTs);
    if (!id || startMs == null) continue;
    const lastMs = ms(r.max_hijack_ts ?? r.maxHijackTs ?? r.max_msg_ts ?? r.maxMsgTs) ?? startMs;
    const confidence = Math.max(0, Math.min(10, num(r.confidence_score ?? r.confidenceScore) ?? 0));
    const onGoing = num(r.on_going_count ?? r.onGoingCount);
    const tags = Array.isArray(r.tags) ? (r.tags as unknown[]).map((t) => (t && typeof t === "object" ? str((t as { name?: unknown }).name) : str(t))).filter(Boolean).slice(0, 8) : [];
    events.push({
      id, confidence, band: bandOf(confidence),
      hijackerAsn: num(r.hijacker_asn ?? r.hijackerAsn),
      hijackerCountry: iso2(r.hijacker_country ?? r.hijackerCountry),
      victimAsns: asnList(r.victim_asns ?? r.victimAsns),
      victimCountries: iso2List(r.victim_countries ?? r.victimCountries),
      prefixes: Array.isArray(r.prefixes) ? (r.prefixes as unknown[]).map(str).filter(Boolean).slice(0, 20) : [],
      startMs, lastMs,
      ongoing: onGoing != null ? onGoing > 0 : false,
      stale: r.is_stale === true || r.isStale === true,
      tags,
      peerCount: num(r.peer_ip_count ?? r.peerIpCount ?? r.peer_count) ?? 0,
    });
  }
  return { events: events.sort((a, b) => b.lastMs - a.lastMs), asnInfo };
}

/** `result.events[]` of /radar/bgp/leaks/events → leaks, newest first. */
export function parseBgpLeaks(json: unknown): BgpParse<BgpLeak> {
  const result = (json as { result?: Record<string, unknown> } | null)?.result;
  const rows = result?.events;
  const asnInfo = parseAsnInfo(result?.asn_info ?? result?.asnInfo);
  if (!Array.isArray(rows)) return { events: [], asnInfo };
  const events: BgpLeak[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const id = str(r.id) || (num(r.id) != null ? String(num(r.id)) : "");
    const startMs = ms(r.min_ts ?? r.minTs ?? r.detected_ts ?? r.detectedTs);
    if (!id || startMs == null) continue;
    events.push({
      id,
      leakAsn: num(r.leak_asn ?? r.leakAsn),
      countries: iso2List(r.countries),
      originCount: num(r.origin_count ?? r.originCount) ?? 0,
      peerCount: num(r.peer_count ?? r.peerCount) ?? 0,
      prefixCount: num(r.prefix_count ?? r.prefixCount) ?? 0,
      leakCount: num(r.leak_count ?? r.leakCount) ?? 0,
      startMs,
      lastMs: ms(r.max_ts ?? r.maxTs) ?? startMs,
      finished: r.finished === true,
    });
  }
  return { events: events.sort((a, b) => b.lastMs - a.lastMs), asnInfo };
}

/** An event seen inside this many hours of `now` is "recent" and can colour. */
export const BGP_RECENT_HOURS = 24;
/** A route leak colours only when it is this big — the first production
 *  page (2026-10-27) held 100 leaks in a few hours, nearly all a handful of
 *  prefixes from one network's misconfiguration; a leak of hundreds of
 *  prefixes is the class that reroutes a country's traffic. */
export const LEAK_SIGNIFICANT_PREFIXES = 100;

/** A hijack is DOMESTIC for a victim country when the hijacking network is
 *  registered in that same country — the first production page was mostly
 *  these (a US network announcing a US prefix), which is a misconfiguration
 *  or a customer dispute, not routing pressure on the country. It is listed,
 *  never a level. Cross-border (or hijacker unknown) earns the level. */
export function isDomesticHijack(h: BgpHijack, victimCountry: string): boolean {
  return h.hijackerCountry != null && h.hijackerCountry === victimCountry;
}

export interface BgpCountryRead {
  code: string;
  level: BgpLevel;
  /** One line — the strongest event. */
  why: string;
  /** Hijacks where the country's networks were the VICTIM. */
  victimOf: BgpHijack[];
  /** Hijacks where the country's network was the HIJACKER — listed, never a level. */
  hijackerIn: BgpHijack[];
  leaks: BgpLeak[];
  ongoing: boolean;
}

const RANK: Record<BgpLevel, number> = { note: 0, amber: 1, red: 2 };
const fmtDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const asnLabel = (asn: number | null, info: Record<number, BgpAsnInfo>) => (asn == null ? "an unknown network" : `AS${asn}${info[asn]?.org ? ` (${info[asn].org})` : ""}`);

/** The level one hijack earns for a VICTIM country at `nowMs`: confidence
 *  AND recency AND cross-border — a domestic hijack is a note whatever its
 *  confidence. */
export function hijackLevel(h: BgpHijack, nowMs: number, victimCountry?: string): BgpLevel {
  const recent = h.ongoing || nowMs - h.lastMs <= BGP_RECENT_HOURS * 3_600_000;
  if (!recent || h.band === "low") return "note";
  if (victimCountry && isDomesticHijack(h, victimCountry)) return "note";
  return h.band === "high" ? "red" : "amber";
}

/** The level one route leak earns for a country it touched: amber only when
 *  it is recent AND big (`LEAK_SIGNIFICANT_PREFIXES`); the rest are notes. */
export function leakLevel(l: BgpLeak, nowMs: number): BgpLevel {
  const recent = !l.finished || nowMs - l.lastMs <= BGP_RECENT_HOURS * 3_600_000;
  return recent && l.prefixCount >= LEAK_SIGNIFICANT_PREFIXES ? "amber" : "note";
}

/**
 * Per-country routing read for the ISO2 codes asked for, over hijacks and
 * leaks inside the window. A country with nothing is absent from the result.
 */
export function bgpReadsFor(hijacks: BgpHijack[], leaks: BgpLeak[], asnInfo: Record<number, BgpAsnInfo>, codes: string[], nowMs: number, windowDays = 7): BgpCountryRead[] {
  const want = new Set(codes.map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)));
  const since = nowMs - windowDays * 86_400_000;
  const by = new Map<string, BgpCountryRead>();
  const get = (code: string) => {
    let r = by.get(code);
    if (!r) { r = { code, level: "note", why: "", victimOf: [], hijackerIn: [], leaks: [], ongoing: false }; by.set(code, r); }
    return r;
  };
  const lift = (r: BgpCountryRead, lvl: BgpLevel, why: string, ongoing: boolean) => {
    if (RANK[lvl] > RANK[r.level] || !r.why) { r.level = lvl; r.why = why; }
    r.ongoing = r.ongoing || ongoing;
  };
  for (const h of hijacks) {
    if (h.lastMs < since) continue;
    const recent = h.ongoing || nowMs - h.lastMs <= BGP_RECENT_HOURS * 3_600_000;
    for (const c of h.victimCountries) {
      if (!want.has(c)) continue;
      const r = get(c);
      r.victimOf.push(h);
      const lvl = hijackLevel(h, nowMs, c);
      const domestic = isDomesticHijack(h, c);
      lift(r, lvl, `${h.band}-confidence hijack of ${h.prefixes.length} prefix${h.prefixes.length === 1 ? "" : "es"} (${h.victimAsns.slice(0, 3).map((a) => asnLabel(a, asnInfo)).join(", ") || "victim networks unnamed"}) by ${asnLabel(h.hijackerAsn, asnInfo)}${h.hijackerCountry ? ` [${h.hijackerCountry}]` : ""} · ${h.ongoing ? "ongoing" : recent ? `last seen ${fmtDay(h.lastMs)}` : `ended ${fmtDay(h.lastMs)}`}${domestic ? " · domestic — likely misconfiguration, not routing pressure" : ""}`, h.ongoing && !domestic);
    }
    if (h.hijackerCountry && want.has(h.hijackerCountry) && !h.victimCountries.includes(h.hijackerCountry)) {
      const r = get(h.hijackerCountry);
      r.hijackerIn.push(h);
      // A hijack BY the country's network is listed, never a level — the
      // read is about what was done to a country's routes, not by them.
      if (!r.why) r.why = `${asnLabel(h.hijackerAsn, asnInfo)} announced ${h.prefixes.length} prefix${h.prefixes.length === 1 ? "" : "es"} of ${h.victimCountries.join("/") || "unnamed victims"} (${h.band} confidence, ${fmtDay(h.lastMs)}) — origin, not victim`;
    }
  }
  for (const l of leaks) {
    if (l.lastMs < since) continue;
    const lvl = leakLevel(l, nowMs);
    for (const c of l.countries) {
      if (!want.has(c)) continue;
      const r = get(c);
      r.leaks.push(l);
      lift(r, lvl, `route leak by ${asnLabel(l.leakAsn, asnInfo)} — ${l.prefixCount} prefix${l.prefixCount === 1 ? "" : "es"} seen by ${l.peerCount} peer${l.peerCount === 1 ? "" : "s"} · ${l.finished ? `ended ${fmtDay(l.lastMs)}` : "ongoing"}${lvl === "note" && l.prefixCount < LEAK_SIGNIFICANT_PREFIXES ? " · small leak, not a level" : ""}`, !l.finished && lvl !== "note");
    }
  }
  return [...by.values()].sort((a, b) => RANK[b.level] - RANK[a.level] || a.code.localeCompare(b.code));
}

/** Ordinal for the daily series (`bgp:<iso2>`, day-peak): 3 red · 2 amber · 1 note · 0 nothing. */
export const BGP_LEVEL_ORDINAL: Record<BgpLevel, number> = { red: 3, amber: 2, note: 1 };
