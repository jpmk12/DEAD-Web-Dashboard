// Private mode for the Tools tab — PURE, client-safe, tested
// (tests/toolsPrivacy.test.ts).
//
// The planner's arithmetic (Julian, H-hour, DTG, light and moon) is pure
// and needs nothing from the network. The two things the tab otherwise does
// beyond that — fetch the tracked places and the H-hour considerations, and
// remember the anchor in localStorage — are exactly the trail a planner may
// not want to leave for an exercise or a real event. Private mode switches
// both off AT THE ONLY DOORS the tab has: `toolsFetch` (every request) and
// `saveH` (every write), which the test pins as the only `fetch(` and the
// only `localStorage.setItem(` in the component. While private the anchor
// lives in React state alone, the place is typed as coordinates, and the
// At-H panel shows what the browser can compute by itself — never a cached
// or stale read dressed up as live.
//
// The flag itself sits in sessionStorage: it survives a reload (a reload
// must not silently fall back to fetching) and dies with the tab, so the
// mode leaves no trail either. The scope is THIS TAB — the rest of the
// dashboard keeps its own polling, and the UI says so.

export const TOOLS_PRIVATE_KEY = "tools.private";

/** What private mode blocks, in the words the switch shows. */
export const PRIVATE_BLOCKS: readonly string[] = [
  "no requests from this tab (places, forecast, TAF, NOTAMs, posture, holidays, space weather, zone)",
  "nothing written to this browser (the H-hour and the place live in memory only — a reload or a close clears them)",
  "coordinates typed by hand; light and moon computed here",
];

export function readPrivate(): boolean {
  try { return typeof sessionStorage !== "undefined" && sessionStorage.getItem(TOOLS_PRIVATE_KEY) === "1"; } catch { return false; }
}

export function writePrivate(on: boolean): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (on) sessionStorage.setItem(TOOLS_PRIVATE_KEY, "1"); else sessionStorage.removeItem(TOOLS_PRIVATE_KEY);
  } catch { /* a blocked store only means the choice is not remembered across a reload */ }
}

export interface LatLon { lat: number; lon: number }

const DEC_RX = /^\s*([+-]?\d{1,2}(?:\.\d+)?)\s*[, ]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$/;
// 31°49'N 36°47'E · 31 49 N 36 47 E · N31 49.5 E036 47.2 · 3149N 03647E
const DM_RX = /^\s*([NS])?\s*(\d{1,2})(?:[°\s:]\s*|(?=\d{2}))(\d{1,2}(?:\.\d+)?)?['′]?\s*([NS])?\s*[, ]?\s*([EW])?\s*(\d{1,3})(?:[°\s:]\s*|(?=\d{2}))(\d{1,2}(?:\.\d+)?)?['′]?\s*([EW])?\s*$/i;

/** Read a typed position: a decimal pair ("31.826, 36.782" / "31.826 -74.59")
 *  or degrees-minutes with hemisphere letters in either place. Null for
 *  anything else or out of range — a place is never guessed. */
export function parseLatLon(text: string): LatLon | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  let m = DEC_RX.exec(s);
  if (m) {
    const lat = Number(m[1]), lon = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  }
  m = DM_RX.exec(s);
  if (m) {
    const ns = (m[1] ?? m[4] ?? "N").toUpperCase(), ew = (m[5] ?? m[8] ?? "E").toUpperCase();
    const latMin = m[3] != null ? Number(m[3]) : 0, lonMin = m[7] != null ? Number(m[7]) : 0;
    if (latMin >= 60 || lonMin >= 60) return null;
    const lat = (Number(m[2]) + latMin / 60) * (ns === "S" ? -1 : 1);
    const lon = (Number(m[6]) + lonMin / 60) * (ew === "W" ? -1 : 1);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 } : null;
  }
  return null;
}
