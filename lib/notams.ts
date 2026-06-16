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
  end?: string;        // ISO, from the C) field if present
  runwaysClosed?: string[];
  raimWindows?: string[]; // "1200-1400Z" style outage windows
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

// NOTAM end time from the ICAO `C)` field: YYMMDDHHMM Zulu → ISO. "PERM"/no
// field → undefined.
export function parseNotamEnd(text: string): string | undefined {
  const m = text.match(/\bC\)\s*(\d{10})\b/);
  if (!m) return undefined;
  const s = m[1];
  const yy = Number(s.slice(0, 2)), mo = Number(s.slice(2, 4)), da = Number(s.slice(4, 6)), hh = Number(s.slice(6, 8)), mi = Number(s.slice(8, 10));
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59) return undefined;
  return new Date(Date.UTC(2000 + yy, mo - 1, da, hh, mi)).toISOString();
}

// Build a structured Notam from raw text + its station.
export function buildNotam(icao: string, text: string): Notam {
  const { category, rank } = categorizeNotam(text);
  const end = parseNotamEnd(text);
  const runwaysClosed = category === "runway" ? parseRunwayClosure(text) : [];
  const raimWindows = category === "gps_raim" ? parseRaimWindows(text) : [];
  return {
    icao: icao.toUpperCase(), category, rank, text: text.slice(0, 500),
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

// Pull NOTAM texts out of whatever DAIP returns (JSON array/objects or a text
// blob) defensively — the precise schema is confirmed on deploy.
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

  const byIcao: Record<string, Notam[]> = {};
  let anyOk = false;
  await Promise.all(icaos.map(async (icao) => {
    try {
      const raw = await daipPost(JSON.stringify({ type: "LOCATION", designatorsForLocation: icao }), ca);
      const texts = extractNotamTexts(raw);
      byIcao[icao] = texts.map((t) => buildNotam(icao, t)).sort((a, b) => a.rank - b.rank).slice(0, 40);
      anyOk = true;
    } catch {
      /* this station failed — leave it out; overall live reflects anyOk */
    }
  }));
  return { configured: true, live: anyOk, byIcao };
}
