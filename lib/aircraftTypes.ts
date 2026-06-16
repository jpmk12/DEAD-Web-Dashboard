// Classify an ADS-B aircraft type designator (tar1090 `t` field, e.g. "C17",
// "K35R", "C30J") as air-mobility-relevant — strategic/tactical airlift, aerial
// refueling, and operational-support/VIP transport, plus common allied/foreign
// heavy lift. Used by the Crisis map's "Mil air" layer to cut the dense fighter/
// ISR/trainer noise down to the movers an AMC planner cares about.
//
// Pure + unit-tested. Matches an explicit designator set first, then a few prefix
// rules to catch variants we didn't enumerate. Deliberately conservative on the
// exclude side (fighters, AWACS/ISR, bombers, recon, helos, trainers → false).

const MOBILITY_EXACT = new Set([
  // US strategic airlift
  "C17", "C5", "C5M",
  // C-130 family (airlift + tanker/special that share the airframe)
  "C130", "C30J", "C130J", "KC130", "HC130", "MC130", "EC130", "LC130", "WC130", "AC130",
  // Aerial refueling
  "KC135", "K35R", "K35E", "KC10", "KC46", "K46", "DC10", "KC30",
  // Operational support / VIP transport
  "C40", "C32", "C37", "C21", "C20", "C12", "UC35", "C26", "VC25", "C9",
  // Allied / foreign airlift + tankers
  "A400", "A332", "A330", "A310", "C160", "C27J", "C295", "CN35",
  "IL76", "IL78", "A124", "AN124", "AN12", "AN22", "AN26", "AN32", "AN72", "AN70",
  "C2", "KA6",
]);

export function isMobilityType(type: string): boolean {
  const t = (type ?? "").trim().toUpperCase();
  if (!t) return false; // unknown type → not a confident mobility match
  if (MOBILITY_EXACT.has(t)) return true;
  // Prefix rules for variants not enumerated above.
  if (/^KC/.test(t)) return true;           // KC135 / KC46 / KC10 / KC130 / KC30…
  if (/^C130|^C30/.test(t)) return true;     // C-130 J/legacy variants
  if (/^C17/.test(t)) return true;           // C-17
  if (/^C5/.test(t)) return true;            // C-5 / C-5M
  if (/^IL7/.test(t)) return true;           // Il-76 / Il-78
  if (/^AN(1|2|7)/.test(t)) return true;     // An-12/22/26/32/70/72/124
  if (/^A40/.test(t)) return true;           // A400M
  return false;
}
