// Federal Register — U.S. sanctions, export-control and tariff actions.
// Server-only fetch; judgement is in lib/regulatorySignals.ts (pure, tested).
//
// The Federal Register API (federalregister.gov/api/v1, keyless JSON) is the
// primary record of every U.S. regulatory action. We run one query per
// class in parallel over a 45-day window — OFAC (sanctions), BIS (export
// controls), USTR/CBP/ITC (tariffs), and presidential documents matching the
// sanctions/tariff vocabulary (executive orders and proclamations issue
// from the President, not from the agency that then implements them) — and
// merge by document number. 6-hour cache: the Register publishes once a day.
//
// U.S. ONLY, by construction. Foreign counter-measures do not appear here.
//
// CONTRACT NOT VERIFIABLE FROM THE DEV SANDBOX (egress blocks the host, the
// same wall as DAIP / travel.state.gov): the agency slugs and field names are
// pinned from the public API documentation. The route's owner-only ?diag=1
// runs the real queries FROM PRODUCTION and returns status + a body snippet
// per query, so a renamed slug shows as a 400 there instead of as an empty
// board. Fail-safe: any query that fails is reported in `failed` and the
// board says so — an empty list never reads as "no actions".

import { fetchWithTimeout } from "./fetchTimeout";
import type { RegulatoryDoc } from "./regulatorySignals";

export const FR_BASE = "https://www.federalregister.gov/api/v1/documents.json";
export const WINDOW_DAYS = 45;

interface Query { key: string; params: Record<string, string | string[]> }

const FIELDS = ["title", "type", "abstract", "publication_date", "html_url", "document_number", "agencies"];

function queries(sinceYmd: string): Query[] {
  const base = { "conditions[publication_date][gte]": sinceYmd, order: "newest", per_page: "60" };
  return [
    { key: "ofac", params: { ...base, "conditions[agencies][]": "foreign-assets-control-office" } },
    { key: "bis", params: { ...base, "conditions[agencies][]": "industry-and-security-bureau" } },
    { key: "trade", params: { ...base, "conditions[agencies][]": ["trade-representative-office-of-united-states", "international-trade-commission", "u-s-customs-and-border-protection"], "conditions[term]": "tariff OR duties OR \"section 232\" OR \"section 301\" OR antidumping OR countervailing" } },
    { key: "presidential", params: { ...base, "conditions[type][]": "PRESDOCU", "conditions[term]": "sanctions OR tariff OR \"national emergency\" OR \"Section 232\" OR \"export controls\"" } },
  ];
}

export function buildUrl(q: Query): string {
  const u = new URL(FR_BASE);
  for (const f of FIELDS) u.searchParams.append("fields[]", f);
  for (const [k, v] of Object.entries(q.params)) {
    if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, x);
    else u.searchParams.set(k, v);
  }
  return u.toString();
}

interface RawDoc {
  document_number?: string; title?: string; abstract?: string | null; type?: string;
  publication_date?: string; html_url?: string; agencies?: { name?: string; slug?: string; raw_name?: string }[];
}

export function parseDocs(json: unknown): RegulatoryDoc[] {
  const results = (json as { results?: RawDoc[] })?.results;
  if (!Array.isArray(results)) return [];
  const out: RegulatoryDoc[] = [];
  for (const r of results) {
    if (!r || typeof r.title !== "string" || typeof r.document_number !== "string") continue;
    if (typeof r.publication_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.publication_date)) continue;
    out.push({
      documentNumber: r.document_number,
      title: r.title.trim().slice(0, 300),
      abstract: typeof r.abstract === "string" ? r.abstract.slice(0, 1200) : null,
      type: typeof r.type === "string" ? r.type : "Notice",
      publicationDate: r.publication_date,
      url: typeof r.html_url === "string" && /^https:\/\/www\.federalregister\.gov\//.test(r.html_url) ? r.html_url : `https://www.federalregister.gov/d/${encodeURIComponent(r.document_number)}`,
      agencies: Array.isArray(r.agencies)
        ? r.agencies.filter((a) => a && (typeof a.name === "string" || typeof a.raw_name === "string")).map((a) => ({ name: (a.name ?? a.raw_name ?? "").slice(0, 120), slug: typeof a.slug === "string" ? a.slug : "" }))
        : [],
    });
  }
  return out;
}

export interface FederalRegisterResult {
  docs: RegulatoryDoc[];
  live: boolean;            // at least one query answered
  failed: string[];         // query keys that failed
  fetchedAt: string;
  sinceYmd: string;
}

const TTL = 6 * 60 * 60 * 1000;
let cache: { at: number; data: FederalRegisterResult } | null = null;
let inflight: Promise<FederalRegisterResult> | null = null;

const UA = "DEAD-Dashboard/1.0 (+strategic-economics; contact via app)";

export async function getRegulatoryDocs(): Promise<FederalRegisterResult> {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  if (inflight) return inflight;
  inflight = fetchAll().then((d) => { if (d.live) cache = { at: Date.now(), data: d }; return d; }).finally(() => { inflight = null; });
  return inflight;
}

export function resetFederalRegisterCache(): void { cache = null; }

async function fetchAll(): Promise<FederalRegisterResult> {
  const sinceYmd = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const byNumber = new Map<string, RegulatoryDoc>();
  const failed: string[] = [];
  await Promise.all(queries(sinceYmd).map(async (q) => {
    try {
      const res = await fetchWithTimeout(buildUrl(q), { headers: { Accept: "application/json", "User-Agent": UA }, cache: "no-store" }, 12_000);
      if (!res.ok) { failed.push(q.key); return; }
      for (const d of parseDocs(await res.json())) if (!byNumber.has(d.documentNumber)) byNumber.set(d.documentNumber, d);
    } catch { failed.push(q.key); }
  }));
  return { docs: Array.from(byNumber.values()), live: failed.length < queries(sinceYmd).length, failed, fetchedAt: new Date().toISOString(), sinceYmd };
}

/** Owner-only diagnostic: every query, real fetch, status + snippet. */
export async function diagnoseFederalRegister(): Promise<{ key: string; url: string; status: number; ms: number; count: number | null; snippet: string }[]> {
  const sinceYmd = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return Promise.all(queries(sinceYmd).map(async (q) => {
    const url = buildUrl(q);
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(url, { headers: { Accept: "application/json", "User-Agent": UA }, cache: "no-store" }, 20_000);
      const text = await res.text();
      let count: number | null = null;
      try { const j = JSON.parse(text); count = typeof j?.count === "number" ? j.count : Array.isArray(j?.results) ? j.results.length : null; } catch { /* not json */ }
      return { key: q.key, url, status: res.status, ms: Date.now() - t0, count, snippet: text.slice(0, 200) };
    } catch (e) {
      return { key: q.key, url, status: 0, ms: Date.now() - t0, count: null, snippet: e instanceof Error ? e.message : String(e) };
    }
  }));
}
