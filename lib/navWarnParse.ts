// NGA navigational warnings for the Crisis map — PURE, client-safe, tested in
// tests/navWarnParse.test.ts.
//
// Source: NGA Maritime Safety Information broadcast warnings (keyless JSON,
// `msi.nga.mil/api/publications/broadcast-warn?output=json&status=active`) —
// NAVAREA IV (western Atlantic) and XII (eastern Pacific), which the U.S.
// coordinates, plus HYDROLANT / HYDROPAC for the rest of the world's oceans.
// They are the published hazard areas at sea: missile and gunnery firings,
// rocket-launch debris zones, GNSS interference tests, mine danger areas and
// security warnings. The contract is pinned from the API's published shape
// and UNVERIFIED from the sandbox (host blocked); the route's diag carries
// the first raw row.
//
// Disciplines:
//   • Positions come from the text ("34-30.00N 032-00.00E", "3430N 03200E");
//     a warning with no readable position is counted, never placed. An "AREA
//     BOUND BY" list of ≥3 positions is a polygon; "WITHIN n MILES OF" one
//     position is a circle; otherwise the positions are points (≤6).
//   • Only OPERATIONAL classes are drawn (firing, launch debris, GNSS,
//     mines / ordnance, security). Routine navigation hazards — unlit lights,
//     wrecks, drifting buoys — are thousands of rows and are counted, not drawn.
//   • The warning's own time windows are free text: shown verbatim, never
//     parsed into a guessed schedule.

export type NavWarnClass = "firing" | "launch debris" | "gnss" | "mines / ordnance" | "security" | "nav hazard" | "other";

export interface NavWarnShape {
  kind: "polygon" | "circle" | "points";
  /** [lat, lon] — the polygon ring, the circle centre, or the points. */
  points: [number, number][];
  radiusNm?: number;
}

export interface NavWarning {
  id: string;
  /** "NAVAREA IV", "NAVAREA XII", "HYDROLANT", "HYDROPAC" or the code as given. */
  area: string;
  number: string;
  cls: NavWarnClass;
  /** First line of the text: the place ("EASTERN MEDITERRANEAN SEA. CYPRUS."). */
  where: string;
  issued: string | null;
  shapes: NavWarnShape[];
  text: string;
  tone: "red" | "amber" | "slate";
}

const AREA_NAME: Record<string, string> = { "4": "NAVAREA IV", "12": "NAVAREA XII", A: "HYDROLANT", P: "HYDROPAC", C: "HYDROARC", IV: "NAVAREA IV", XII: "NAVAREA XII" };

// DD-MM.mm[N|S] DDD-MM.mm[E|W] (also without the dash, without decimals).
const POS_RX = /\b(\d{1,2})-?(\d{2}(?:\.\d+)?)\s?([NS])\s*,?\s*(\d{1,3})-?(\d{2}(?:\.\d+)?)\s?([EW])\b/g;

export function navPositions(text: string): { at: [number, number]; index: number }[] {
  const out: { at: [number, number]; index: number }[] = [];
  for (const m of text.toUpperCase().matchAll(POS_RX)) {
    const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === "S" ? -1 : 1);
    const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === "W" ? -1 : 1);
    if (Number(m[2]) >= 60 || Number(m[5]) >= 60 || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ at: [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4], index: m.index ?? 0 });
  }
  return out;
}

export function navWarnClass(text: string): NavWarnClass {
  const t = text.toUpperCase();
  if (/\b(PIRACY|PIRATE|HIJACK|ARMED ROBBERY|ATTACK(ED)?|SUSPICIOUS APPROACH|SECURITY THREAT|HOSTILE)\b/.test(t)) return "security";
  if (/\b(MINE|MINES|MINEFIELD|MINE DANGER|UNEXPLODED|EXPLOSIVE ORDNANCE|ORDNANCE|UXO)\b/.test(t)) return "mines / ordnance";
  if (/\b(GPS|GNSS)\b.*\b(TEST|TESTING|INTERFERENCE|JAMMING|UNRELIABLE|UNAVAILABLE)\b|\b(JAMMING|SPOOFING)\b/.test(t)) return "gnss";
  if (/\b(ROCKET LAUNCH(?:ING|ES)?|SPACE (?:LAUNCH|DEBRIS)|LAUNCH VEHICLE|FALLING DEBRIS|ROCKET DEBRIS|SPACE VEHICLE|SATELLITE LAUNCH|RE-?ENTRY)\b/.test(t)) return "launch debris";
  if (/\b(MISSILE|ROCKET FIRING|GUNNERY|GUNFIRE|LIVE FIRE|LIVE FIRING|FIRING EXERCISE|FIRING|HAZARDOUS OPERATIONS|MILITARY EXERCISE|NAVAL EXERCISE|BOMBING|DROPPING)\b/.test(t)) return "firing";
  if (/\b(UNLIT|LIGHT\b.*\b(INOPERATIVE|UNLIT|EXTINGUISHED)|WRECK|DERELICT|DRIFTING|ADRIFT|BUOY|OBSTRUCTION|SUBMERGED|SHOAL|CABLE OPERATIONS|PIPELINE|SURVEY OPERATIONS|DREDGING|TOWING)\b/.test(t)) return "nav hazard";
  return "other";
}

export const DRAWN_CLASSES: NavWarnClass[] = ["firing", "launch debris", "gnss", "mines / ordnance", "security"];

export function navWarnTone(c: NavWarnClass): NavWarning["tone"] {
  if (c === "security" || c === "mines / ordnance") return "red";
  if (c === "firing" || c === "launch debris" || c === "gnss") return "amber";
  return "slate";
}

/** The text → shapes: one polygon per "BOUND BY" list of ≥3 positions, one
 *  circle per "WITHIN n MILES OF" position, the rest as points (≤6). */
export function navShapes(text: string): NavWarnShape[] {
  const up = text.toUpperCase();
  const pos = navPositions(up);
  if (!pos.length) return [];
  const used = new Set<number>();
  const shapes: NavWarnShape[] = [];
  // Circles: "WITHIN 5 MILES OF 34-30.00N 032-00.00E" / "5 NM RADIUS OF".
  for (const m of up.matchAll(/(?:WITHIN|IN AREA WITHIN)\s+(\d+(?:\.\d+)?)\s*(?:NAUTICAL\s+)?(?:MILES?|NM)\s+(?:RADIUS\s+)?OF\b|(\d+(?:\.\d+)?)\s*(?:NM|MILE)\s+RADIUS\s+OF\b/g)) {
    const at = m.index ?? 0;
    const next = pos.findIndex((p) => p.index > at && p.index - at < 80);
    if (next >= 0 && !used.has(next)) {
      used.add(next);
      shapes.push({ kind: "circle", points: [pos[next].at], radiusNm: Number(m[1] ?? m[2]) });
    }
  }
  // Polygons: the positions after each "BOUND(ED) BY", up to the next marker.
  const bounds = [...up.matchAll(/\bBOUND(?:ED)?\s+BY\b/g)].map((m) => m.index ?? 0);
  bounds.forEach((start, i) => {
    const end = bounds[i + 1] ?? up.length;
    // "AREAS BOUND BY: A. p, p, p. B. p, p, p." — each lettered area is its
    // own ring (a letter after whitespace, never the E of "124-41E.").
    const cuts = [start, ...[...up.slice(start, end).matchAll(/(?:^|\s)[A-Z]\.\s/g)].map((m) => start + (m.index ?? 0)), end];
    for (let k = 0; k < cuts.length - 1; k++) {
      const ring: [number, number][] = [];
      pos.forEach((p, j) => { if (p.index > cuts[k] && p.index < cuts[k + 1] && !used.has(j)) { ring.push(p.at); used.add(j); } });
      if (ring.length >= 3) shapes.push({ kind: "polygon", points: ring });
      else ring.forEach((pt) => shapes.push({ kind: "points", points: [pt] }));
    }
  });
  const rest = pos.filter((_, j) => !used.has(j)).slice(0, 6).map((p) => p.at);
  if (rest.length) shapes.push({ kind: "points", points: rest });
  return shapes;
}

function str(v: unknown): string { return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""; }

/** The response body → its rows (`broadcast-warn` array, a bare array, or the
 *  first array under a known key). */
export function navWarnRows(body: unknown): Record<string, unknown>[] {
  const pickArr = (v: unknown) => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : null);
  if (Array.isArray(body)) return pickArr(body)!;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const k of ["broadcast-warn", "broadcastWarn", "warnings", "data", "items"]) { const a = pickArr(o[k]); if (a) return a; }
    for (const v of Object.values(o)) { const a = pickArr(v); if (a && a.length) return a; }
  }
  return [];
}

export function parseNavWarning(o: Record<string, unknown>): NavWarning | null {
  const text = str(o.text ?? o.msgText ?? o.message);
  if (!text) return null;
  const status = str(o.status).toUpperCase();
  if (status && status !== "A" && status !== "ACTIVE") return null;
  const code = str(o.navArea ?? o.navarea ?? o.area).toUpperCase();
  const area = AREA_NAME[code] ?? (code || "NGA");
  const number = [str(o.msgNumber ?? o.number), str(o.msgYear ?? o.year)].filter(Boolean).join("/");
  const cls = navWarnClass(text);
  const firstLine = text.split(/\r?\n|(?<=\.)\s+(?=\d+\.\s)/)[0].trim();
  return {
    id: `${area}|${number || text.slice(0, 40)}`,
    area, number: number || "—", cls,
    where: firstLine.slice(0, 160),
    issued: str(o.issueDate ?? o.issued) || null,
    shapes: navShapes(text),
    text: text.slice(0, 1500),
    tone: navWarnTone(cls),
  };
}

export interface NavWarnParse { warnings: NavWarning[]; rows: number; byClass: Record<string, number>; unplaced: number }

/** Every active row parsed; `warnings` = the DRAWN classes with a position.
 *  Everything else is counted by class (and unplaced) for the diag. */
export function parseNavWarnings(body: unknown): NavWarnParse {
  const rows = navWarnRows(body);
  const byClass: Record<string, number> = {};
  let unplaced = 0;
  const warnings: NavWarning[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const w = parseNavWarning(r);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    byClass[w.cls] = (byClass[w.cls] ?? 0) + 1;
    if (!DRAWN_CLASSES.includes(w.cls)) continue;
    if (!w.shapes.length) { unplaced++; continue; }
    warnings.push(w);
  }
  return { warnings, rows: rows.length, byClass, unplaced };
}
