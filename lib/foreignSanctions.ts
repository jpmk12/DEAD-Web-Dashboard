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
//
// STREAMED, never buffered (the 502 lesson, 2026-09-30): the EU full list is
// tens of MB. The first cut did `res.text()` then `split("\n")` then a field
// split per line — one giant string, an array of every line, and a burst of
// CPU on the request path — and the production process fell over, which the
// gateway reports as an HTML 502 the board can only call "unavailable". Now
// the body is read chunk by chunk through a TextDecoder, one line at a time
// into the line parser, which keeps only rows inside `KEEP_DAYS`; the loop
// yields to the event loop every few thousand lines, stops at `MAX_BYTES`,
// and a body that cannot finish inside its deadline is reported as NOT live
// (a partial file cannot claim "no new listings" — the rows are unordered).

import { fetchWithTimeout } from "./fetchTimeout";
import { euLineParser, ukLineParser, parseEuCsv, parseUkCsv, type CsvLineParser, type ForeignDesignation } from "./foreignSanctionsParse";

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
/** Rows older than this are dropped at the line — the board's widest window is 45 days. */
export const KEEP_DAYS = 120;
/** Hard byte cap per list; past it the stream is cancelled and the list is not live. */
const MAX_BYTES = 120 * 1024 * 1024;
/** Whole-body deadline per list (headers + stream). Runs in the background
 *  behind the assembler's own 8-s wait, so it may be generous. */
const BODY_DEADLINE_MS = 90_000;
const YIELD_EVERY_LINES = 2000;

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

const keepSinceDay = (): string => new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);

const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

export interface StreamOutcome {
  status: number;
  /** Bytes read before the stream ended, hit the cap, or timed out. */
  bytes: number;
  lines: number;
  /** The whole body was consumed (not capped, not timed out, no read error). */
  complete: boolean;
  /** First ~300 chars, for the diag. */
  snippet: string;
  error?: string;
}

/**
 * Stream one CSV body line by line into `parser`. Never throws. `complete`
 * is false whenever the body was not read to its end, whatever the reason.
 */
export async function streamCsv(url: string, parser: CsvLineParser, deadlineMs = BODY_DEADLINE_MS, maxBytes = MAX_BYTES): Promise<StreamOutcome> {
  const started = Date.now();
  const out: StreamOutcome = { status: 0, bytes: 0, lines: 0, complete: false, snippet: "" };
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "text/csv,text/plain,*/*" }, cache: "no-store" }, Math.min(25_000, deadlineMs));
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return out;
  }
  out.status = res.status;
  if (!res.ok || !res.body) { out.error = `HTTP ${res.status}`; return out; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let carry = "";
  let sinceYield = 0;
  try {
    for (;;) {
      if (Date.now() - started > deadlineMs) { out.error = "body deadline"; await reader.cancel().catch(() => {}); return out; }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        out.bytes += value.byteLength;
        if (out.bytes > maxBytes) { out.error = "byte cap"; await reader.cancel().catch(() => {}); return out; }
        const text = carry + decoder.decode(value, { stream: true });
        if (out.snippet.length < 300) out.snippet = (out.snippet + text).slice(0, 300);
        const parts = text.split(/\r?\n/);
        carry = parts.pop() ?? "";
        for (const line of parts) {
          parser.push(line);
          out.lines++;
          if (++sinceYield >= YIELD_EVERY_LINES) { sinceYield = 0; await yieldLoop(); }
        }
      }
    }
    const tail = carry + decoder.decode();
    if (tail) { parser.push(tail); out.lines++; }
    out.complete = true;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    await reader.cancel().catch(() => {});
  }
  return out;
}

async function fetchAll(): Promise<ForeignSanctionsResult> {
  const since = keepSinceDay();
  const eu = euLineParser(since);
  const uk = ukLineParser(since);
  const [euOut, ukOut] = await Promise.all([streamCsv(EU_FSF_CSV_URL, eu), streamCsv(UK_CONLIST_CSV_URL, uk)]);
  // "Live" means the body was read to the end AND the header was recognised.
  // A truncated stream may simply have missed this week's rows.
  const euLive = euOut.complete && eu.headerFound();
  const ukLive = ukOut.complete && uk.headerFound();
  const failed: string[] = [];
  if (!euLive) failed.push("EU");
  if (!ukLive) failed.push("UK");
  return {
    rows: [...(euLive ? eu.rows() : []), ...(ukLive ? uk.rows() : [])],
    live: { EU: euLive, UK: ukLive },
    failed,
    fetchedAt: new Date().toISOString(),
  };
}

export interface ForeignSanctionsDiag {
  source: "EU" | "UK"; url: string; status: number; ms: number; bytes: number; lines: number;
  /** Rows kept inside KEEP_DAYS (what the board reads). */
  parsed: number;
  /** Rows the parser recognised at all (header + columns found) — a full
   *  list with `parsedAll` 0 means a renamed column. */
  headerFound: boolean;
  complete: boolean;
  snippet: string;
  error?: string;
}

/** Owner-only: streams each list from production exactly as `getForeignSanctions`
 *  does and reports what came back. Real network; never on a page load. */
export async function diagnoseForeignSanctions(): Promise<ForeignSanctionsDiag[]> {
  const since = keepSinceDay();
  const probe = async (source: "EU" | "UK", url: string): Promise<ForeignSanctionsDiag> => {
    const t0 = Date.now();
    const parser = source === "EU" ? euLineParser(since) : ukLineParser(since);
    const o = await streamCsv(url, parser);
    return {
      source, url, status: o.status, ms: Date.now() - t0, bytes: o.bytes, lines: o.lines,
      parsed: parser.rows().length, headerFound: parser.headerFound(), complete: o.complete,
      snippet: o.snippet, ...(o.error ? { error: o.error } : {}),
    };
  };
  return Promise.all([probe("EU", EU_FSF_CSV_URL), probe("UK", UK_CONLIST_CSV_URL)]);
}

// Kept for callers that hold a whole file (tests / fixtures).
export { parseEuCsv, parseUkCsv };
