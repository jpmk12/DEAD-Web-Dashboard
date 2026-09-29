// Foreign counter-measures — server-only fetch of the EU consolidated
// financial-sanctions list and the UK sanctions list (both keyless CSVs),
// parsed by lib/foreignSanctionsParse and reduced to NEW-listing waves per
// regime. Cached 24 h (both lists publish daily at most); fail-safe: a dead
// source is named in `failed` and reads UNKNOWN on the board, never "no
// foreign action". The URLs are pinned from the publishers' public pages and
// COULD NOT BE VERIFIED from the build sandbox (egress blocks both hosts):
// `diagnoseForeignSanctions()` (owner-only, ?diag=1 on the economic-warfare
// route) runs the real fetches from production and returns status + a
// header snippet + parsed count per source, so a moved file shows there
// rather than as a silently empty strip.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseEuCsv, parseUkCsv, type ForeignDesignation } from "./foreignSanctionsParse";

// EU FSF "full" CSV (the public download token is a fixed public string, not
// a credential — it is embedded in the Commission's own download links).
export const EU_FSF_CSV_URL = "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";
// UK OFSI consolidated list, 2022 CSV format.
export const UK_CONLIST_CSV_URL = "https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv";

export interface ForeignSanctionsResult {
  rows: ForeignDesignation[];
  live: { EU: boolean; UK: boolean };
  failed: string[];
  fetchedAt: string;
}

const TTL = 24 * 60 * 60 * 1000;
let cache: { at: number; data: ForeignSanctionsResult } | null = null;
let inflight: Promise<ForeignSanctionsResult> | null = null;

const UA = "DEAD-Dashboard/1.0 (+economic-warfare; contact via app)";

export function resetForeignSanctionsCache(): void { cache = null; }

export async function getForeignSanctions(): Promise<ForeignSanctionsResult> {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  if (inflight) return inflight;
  inflight = fetchAll().then((d) => { if (d.live.EU || d.live.UK) cache = { at: Date.now(), data: d }; return d; }).finally(() => { inflight = null; });
  return inflight;
}

async function fetchText(url: string, ms: number): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "text/csv,text/plain,*/*" }, cache: "no-store" }, ms);
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function fetchAll(): Promise<ForeignSanctionsResult> {
  const [eu, uk] = await Promise.all([fetchText(EU_FSF_CSV_URL, 25_000), fetchText(UK_CONLIST_CSV_URL, 25_000)]);
  const euRows = eu ? parseEuCsv(eu) : [];
  const ukRows = uk ? parseUkCsv(uk) : [];
  const failed: string[] = [];
  if (!eu || euRows.length === 0) failed.push("EU");
  if (!uk || ukRows.length === 0) failed.push("UK");
  return { rows: [...euRows, ...ukRows], live: { EU: euRows.length > 0, UK: ukRows.length > 0 }, failed, fetchedAt: new Date().toISOString() };
}

export interface ForeignSanctionsDiag { source: "EU" | "UK"; url: string; status: number; ms: number; bytes: number; parsed: number; snippet: string }

export async function diagnoseForeignSanctions(): Promise<ForeignSanctionsDiag[]> {
  const probe = async (source: "EU" | "UK", url: string): Promise<ForeignSanctionsDiag> => {
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA }, cache: "no-store" }, 25_000);
      const text = await res.text();
      const parsed = source === "EU" ? parseEuCsv(text).length : parseUkCsv(text).length;
      return { source, url, status: res.status, ms: Date.now() - t0, bytes: text.length, parsed, snippet: text.slice(0, 300) };
    } catch (e) {
      return { source, url, status: 0, ms: Date.now() - t0, bytes: 0, parsed: 0, snippet: e instanceof Error ? e.message : String(e) };
    }
  };
  return Promise.all([probe("EU", EU_FSF_CSV_URL), probe("UK", UK_CONLIST_CSV_URL)]);
}
