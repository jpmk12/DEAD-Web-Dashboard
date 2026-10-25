// What a NOTAM is ABOUT — the asset named first, not the first keyword found.
//
// ICAO item E) leads with the subject ("TWY A CLSD BTN RWY 06/24 AND TWY B";
// "ILS RWY 24 U/S"; "RWY 06/24 CLSD EXC TWY A CROSSING"). The runways,
// approach aids and hold lines that follow locate the closed segment; they are
// not what closed. Keyword-first readers got this backwards: a taxiway
// closure that mentioned an ILS hold line read as an approach outage, and
// with forecast IFR the airfield derived NMC — "no usable precision
// approach" — from a shut taxiway. The runway is the primary driver of
// airfield capability; a taxiway caps throughput at PMC and nothing else.
//
// PURE, dependency-free, client-safe: imported by the server-only NOTAM
// categoriser (lib/notams) AND the client-safe SITREP signals, which must not
// import each other.

export type NotamSubject = "airfield" | "runway" | "taxiway" | "navaid" | "apron";

// Aerodrome closed — the whole field. A taxiway lettered "AD" ("TWY AD CLSD")
// is a taxiway, so the match may not sit directly after a TWY token.
export const AD_CLSD_RE = /(?<!\bTWY\s)(?<!\bTAXIWAY\s)\bAD\s+CLSD\b|\bAERODROME\s+CLSD\b/i;

const SUBJECT_TOKENS: { subject: NotamSubject; re: RegExp }[] = [
  { subject: "runway",  re: /\b(?:RWY|RUNWAY)\b/i },
  { subject: "taxiway", re: /\b(?:TWY|TAXIWAY)\b/i },
  { subject: "navaid",  re: /\b(?:ILS|LOC|VOR|TACAN|NDB|RNAV|DME|GLIDE\s?SLOPE|GS|PAPI|VASI|ALS|APCH|APPROACH)\b/i },
  { subject: "apron",   re: /\b(?:APRON|RAMP)\b/i },
];

/**
 * The first asset the text names, or null when it names none. "AD CLSD" is
 * the airfield whatever else follows. Ties cannot occur — positions are
 * distinct characters.
 */
export function notamSubject(text: string): NotamSubject | null {
  if (AD_CLSD_RE.test(text)) return "airfield";
  let best: { subject: NotamSubject; at: number } | null = null;
  for (const { subject, re } of SUBJECT_TOKENS) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.at)) best = { subject, at: m.index };
  }
  return best?.subject ?? null;
}

/** True when the text is about a taxiway — the runways / aids it mentions only place it. */
export function isTaxiwayNotam(text: string): boolean {
  return notamSubject(text) === "taxiway";
}
