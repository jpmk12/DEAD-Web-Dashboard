// NOTAMs for force-protection: runway/approach/airspace closures + GPS-RAIM
// outage windows at the watched bases. Source: DoD DAIP (keyless), per the
// aviation-data knowledge transfer. Two halves:
//
//   1. PURE parsing/categorization (categorizeNotam, parseRunwayClosure,
//      parseRaimWindows, parseNotamEnd) — deterministic, unit-tested, no network.
//   2. getNotams() — the DAIP fetch. DAIP serves a DoD-PKI server cert whose CA
//      is NOT in the public trust store, so we trust the DoD CA bundle SCOPED to
//      this request (node:https Agent `ca`), supplied by the operator via
//      DOD_CA_PEM (inline PEM) or DOD_CA_PATH (file). Without it — or on ANY
//      failure — getNotams returns live:false so the scorer marks the affected
//      categories UNKNOWN, never a false "clear" (the cardinal RAIM safety rule).
//
// The exact DAIP request/response schema must be confirmed against the live
// endpoint on deploy; parsing is deliberately defensive (operate on NOTAM text
// blobs however they arrive) and the whole thing fails safe to UNKNOWN.

import https from "node:https";
import { readFileSync } from "node:fs";
import { DOD_CA_PEM_BUNDLED } from "./certs/dodCa";

export type NotamCategory =
  | "runway" | "approach" | "gps_raim" | "lighting" | "obstacle"
  | "airspace" | "bird" | "taxiway" | "navaid" | "services" | "other";

export interface Notam {
  icao: string;
  category: NotamCategory;
  rank: number;        // lower = more operationally significant
  text: string;
  start?: string;      // ISO, from the B) field if present (effective time)
  end?: string;        // ISO, from the C) field if present (expiry)
  runwaysClosed?: string[];
  raimWindows?: string[]; // "1200-1400Z" style outage windows
}

export type NotamTimeState = "active" | "upcoming" | "expired";

// Active now / starts later / already ended, given the parsed B)/C) times. Takes
// only the time fields so it works for any NOTAM-like shape (e.g. AirspaceNotam).
export function notamTimeState(n: { start?: string; end?: string }, nowMs: number): NotamTimeState {
  if (n.end) { const e = Date.parse(n.end); if (Number.isFinite(e) && e < nowMs) return "expired"; }
  if (n.start) { const s = Date.parse(n.start); if (Number.isFinite(s) && s > nowMs) return "upcoming"; }
  return "active";
}

// Compact "starts in …" for an upcoming NOTAM (null if active/started).
export function startsInLabel(n: Notam, nowMs: number): string | null {
  if (!n.start) return null;
  const ms = Date.parse(n.start) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

// First-match-wins, ordered by operational significance. RWY…CLSD is bumped to
// the very top by the caller (rank 0); the bare category ranks follow.
// Order matters (first match wins). Approach-specific NOTAMs (ILS/RNAV U/S)
// almost always mention a RWY, so they MUST be tested before the generic runway
// rule — otherwise an "ILS RWY 25 U/S" mislabels as a runway NOTAM. A runway
// *closure* still outranks both (special-cased to rank 0 in categorizeNotam).
const CATEGORY_RULES: { category: NotamCategory; rank: number; re: RegExp }[] = [
  { category: "approach", rank: 2,  re: /\bILS\b|\bRNAV\b|\bLOC\b|\bGLIDE\s?SLOPE\b|\bGS\b|\bVOR\b.*\bAPP|\bAPPROACH\b/i },
  { category: "runway",   rank: 1,  re: /\bRWY\b|\bRUNWAY\b/i },
  { category: "gps_raim", rank: 3,  re: /\bGPS\b|\bRAIM\b|\bGNSS\b|\bWAAS\b/i },
  { category: "lighting", rank: 4,  re: /\bLGT\b|\bLIGHTING\b|\bPAPI\b|\bVASI\b|\bREIL\b|\bALS\b/i },
  { category: "obstacle", rank: 5,  re: /\bOBST\b|\bOBSTACLE\b|\bCRANE\b|\bTOWER\b/i },
  { category: "airspace", rank: 6,  re: /\bAIRSPACE\b|\bTFR\b|\bRESTRICTED\b|\bPROHIBITED\b|\bMOA\b|\bCLSD\s+AIRSPACE\b|\bGND\s+\d|\bFL\d/i },
  { category: "bird",     rank: 7,  re: /\bBIRD\b|\bWILDLIFE\b/i },
  { category: "taxiway",  rank: 8,  re: /\bTWY\b|\bTAXIWAY\b/i },
  { category: "navaid",   rank: 9,  re: /\bNDB\b|\bDME\b|\bTACAN\b|\bNAVAID\b/i },
  { category: "services", rank: 10, re: /\bFUEL\b|\bSVC\b|\bSERVICE\b|\bATC\b|\bTWR\s+CLSD\b/i },
];

// Categorize a NOTAM by its text. A runway *closure* outranks everything.
export function categorizeNotam(text: string): { category: NotamCategory; rank: number } {
  const t = text.toUpperCase();
  if (/\bRWY\s+[0-9LRC/]+\s+(?:CLSD|CLOSED)/.test(t)) return { category: "runway", rank: 0 };
  for (const r of CATEGORY_RULES) if (r.re.test(t)) return { category: r.category, rank: r.rank };
  return { category: "other", rank: 11 };
}

// Runway designators in a closure NOTAM, e.g. "RWY 09/27 CLSD" → ["09/27"].
export function parseRunwayClosure(text: string): string[] {
  const out: string[] = [];
  const re = /\bRWY\s+([0-9LRC/]+)\s+(?:CLSD|CLOSED)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

// GPS/RAIM outage windows as "HHMM-HHMM" (Zulu). Only meaningful on a NOTAM
// already categorized gps_raim. Returns [] if none parse — which, on a feed that
// IS live, means "no outage in this NOTAM"; a DOWN feed must be UNKNOWN upstream.
export function parseRaimWindows(text: string): string[] {
  const out: string[] = [];
  const re = /\b([0-2]\d[0-5]\d)\s*[-–]\s*([0-2]\d[0-5]\d)\s*Z?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(`${m[1]}-${m[2]}Z`);
  return out;
}

// Decode an ICAO NOTAM YYMMDDHHMM Zulu group → ISO (or undefined if invalid).
function decodeNotam10(s: string): string | undefined {
  const yy = Number(s.slice(0, 2)), mo = Number(s.slice(2, 4)), da = Number(s.slice(4, 6)), hh = Number(s.slice(6, 8)), mi = Number(s.slice(8, 10));
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59) return undefined;
  return new Date(Date.UTC(2000 + yy, mo - 1, da, hh, mi)).toISOString();
}

// NOTAM effective start from the ICAO `B)` field.
export function parseNotamStart(text: string): string | undefined {
  const m = text.match(/\bB\)\s*(\d{10})\b/);
  return m ? decodeNotam10(m[1]) : undefined;
}

// NOTAM end time from the ICAO `C)` field. "PERM"/no field → undefined.
export function parseNotamEnd(text: string): string | undefined {
  const m = text.match(/\bC\)\s*(\d{10})\b/);
  return m ? decodeNotam10(m[1]) : undefined;
}

// Build a structured Notam from raw text + its station.
export function buildNotam(icao: string, text: string): Notam {
  const { category, rank } = categorizeNotam(text);
  const start = parseNotamStart(text);
  const end = parseNotamEnd(text);
  const runwaysClosed = category === "runway" ? parseRunwayClosure(text) : [];
  const raimWindows = category === "gps_raim" ? parseRaimWindows(text) : [];
  return {
    icao: icao.toUpperCase(), category, rank, text: text.slice(0, 500),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(runwaysClosed.length ? { runwaysClosed } : {}),
    ...(raimWindows.length ? { raimWindows } : {}),
  };
}

// ── DAIP fetch (network; fails safe to live:false / UNKNOWN) ─────────────────

// The DoD CA bundle used to validate DAIP's TLS chain. Resolution order: an
// operator override via DOD_CA_PEM (inline) or DOD_CA_PATH (file), else the
// bundled DoD Root CA 6 (committed — a public root cert). So NOTAMs work
// out-of-the-box; overrides exist only to supply a fuller/updated chain.
function dodCaBundle(): string | null {
  const inline = process.env.DOD_CA_PEM?.trim();
  if (inline) return inline;
  const path = process.env.DOD_CA_PATH?.trim();
  if (path) { try { return readFileSync(path, "utf8"); } catch { /* fall back to bundled */ } }
  return DOD_CA_PEM_BUNDLED;
}

const DAIP_HOST = "www.daip.jcs.mil";
const DAIP_PATH = "/daip/mobile/query";

// Working DAIP mobile/query contract (confirmed 200 via the diagnostic): the
// ICAO(s) go in a `locations` array. Returns { group: [{ name, notams: [...] }] }.
function daipPayload(icao: string): string {
  return JSON.stringify({ type: "LOCATION", locations: [icao.toUpperCase()] });
}

// Raw POST to DAIP with the DoD CA trusted *for this request only*.
function daipPost(body: string, ca: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: DAIP_HOST, path: DAIP_PATH, method: "POST", ca, timeout: 12_000,
        headers: { "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) { res.resume(); reject(new Error(`daip ${res.statusCode}`)); return; }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("daip timeout")));
    req.write(body);
    req.end();
  });
}

// Shared low-level DAIP `/mobile/query` POST. ALL DAIP query classes go through
// this one endpoint (confirmed via the contract capture) — only the `type` field
// differs (LOCATION, FIR_ARTCC, GPS_WAAS, FUEL_NOTAMS, MOA, …) and every type
// returns the same group→notams→list envelope. So this is the single network
// door shared by getNotams (per-base) and lib/airspace.ts (enroute/system).
// Returns the raw JSON string, with `configured:false` when the DoD CA bundle
// isn't available (≠ feed down) and `raw:null` on any request failure — callers
// fail safe to UNKNOWN, never a false "clear".
export async function fetchDaipQuery(payload: Record<string, unknown>): Promise<{ configured: boolean; raw: string | null }> {
  const ca = dodCaBundle();
  if (!ca) return { configured: false, raw: null };
  try { return { configured: true, raw: await daipPost(JSON.stringify(payload), ca) }; }
  catch { return { configured: true, raw: null }; }
}

// DAIP response shape (confirmed live):
//   { group: [ { name, notams: [ { code, name, list: [ {idshow, text, rawtext,
//     alertType, ...} ] } ] } ] }
// The individual NOTAMs live in notams[].list[]. Parse each from its `rawtext`
// (full ICAO format → carries the C) end-date and E) body) and keep the clean
// `text` for display.
export function parseDaipNotams(icao: string, raw: string): Notam[] | null {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return null; }
  const groups = (json as { group?: unknown[] })?.group;
  if (!Array.isArray(groups)) return null;
  const ic = icao.toUpperCase();
  const out: Notam[] = [];
  const pushItem = (item: Record<string, unknown>) => {
    const display = String(item.text ?? "").replace(/\s+/g, " ").trim();
    const rawtext = String(item.rawtext ?? "").trim();
    const basis = rawtext || display; // categorize/parse on the fullest text available
    if (!basis) return;
    const { category, rank } = categorizeNotam(basis);
    const num = String(item.idshow ?? item.id ?? "").trim();
    const start = parseNotamStart(rawtext) ?? parseNotamStart(display);
    const end = parseNotamEnd(rawtext) ?? parseNotamEnd(display);
    const runwaysClosed = category === "runway" ? parseRunwayClosure(basis) : [];
    const raimWindows = category === "gps_raim" ? parseRaimWindows(basis) : [];
    out.push({
      icao: ic, category, rank,
      text: ((num ? `${num} ` : "") + (display || basis)).slice(0, 480),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(runwaysClosed.length ? { runwaysClosed } : {}),
      ...(raimWindows.length ? { raimWindows } : {}),
    });
  };
  for (const g of groups) {
    const wrappers = (g as { notams?: unknown[] })?.notams;
    if (!Array.isArray(wrappers)) continue;
    for (const w of wrappers) {
      if (!w || typeof w !== "object") continue;
      const list = (w as { list?: unknown[] }).list;
      if (Array.isArray(list)) {
        for (const item of list) if (item && typeof item === "object") pushItem(item as Record<string, unknown>);
      } else {
        pushItem(w as Record<string, unknown>); // tolerate a flatter shape
      }
    }
  }
  return out.length ? out : null;
}

// Generic fallback when the response isn't DAIP's group/notams/list shape.
function extractNotamTexts(raw: string): string[] {
  try {
    const json = JSON.parse(raw);
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") { if (/\b(RWY|TWY|ILS|GPS|RAIM|NAV|OBST|AIRSPACE|NOTAM)\b/i.test(v)) out.push(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          if (/notam|text|message|raw|content/i.test(k) && typeof val === "string") out.push(val);
          else walk(val);
        }
      }
    };
    walk(json);
    if (out.length) return out;
  } catch { /* not JSON — fall through to text */ }
  // Plain-text blob: split on blank lines / NOTAM markers.
  return raw.split(/\n{2,}|(?=\b[A-Z]\d{4}\/\d{2}\b)/).map((s) => s.trim()).filter((s) => s.length > 10);
}

// NOTAMs by ICAO. `live:false` whenever the CA isn't configured or the call
// fails — the caller MUST treat that as UNKNOWN, not "no NOTAMs / clear".
export async function getNotams(icaosRaw: string[]): Promise<{ configured: boolean; live: boolean; byIcao: Record<string, Notam[]> }> {
  const icaos = Array.from(new Set(icaosRaw.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{4}$/.test(s)))).slice(0, 12);
  if (icaos.length === 0) return { configured: true, live: true, byIcao: {} };
  const ca = dodCaBundle();
  // Not configured (no CA bundle) ≠ feed down: the caller omits the airspace
  // category entirely rather than showing a perpetual blind spot.
  if (!ca) return { configured: false, live: false, byIcao: {} };

  const now = Date.now();
  const STATE_RANK: Record<NotamTimeState, number> = { active: 0, upcoming: 1, expired: 2 };
  const byIcao: Record<string, Notam[]> = {};
  let anyOk = false;
  await Promise.all(icaos.map(async (icao) => {
    try {
      const raw = await daipPost(daipPayload(icao), ca);
      const parsed = parseDaipNotams(icao, raw) ?? extractNotamTexts(raw).map((t) => buildNotam(icao, t));
      // Drop expired NOTAMs; order by significance (rank), then active-before-
      // upcoming, then soonest start — so a live closure outranks a next-week one.
      byIcao[icao] = parsed
        .map((n) => ({ n, st: notamTimeState(n, now) }))
        .filter((x) => x.st !== "expired")
        .sort((a, b) => a.n.rank - b.n.rank || STATE_RANK[a.st] - STATE_RANK[b.st] || (Date.parse(a.n.start ?? "0") - Date.parse(b.n.start ?? "0")))
        .slice(0, 40)
        .map((x) => x.n);
      anyOk = true;
    } catch {
      /* this station failed — leave it out; overall live reflects anyOk */
    }
  }));
  return { configured: true, live: anyOk, byIcao };
}
