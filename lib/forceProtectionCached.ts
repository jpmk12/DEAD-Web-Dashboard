// One shared memo over getForceProtection — server-only.
//
// getForceProtection fans out to ~15 feeds. It used to be called separately by
// the /api/force-protection route (which cached it), the alert check, the
// assistant's OE context and now the demand horizon — each paying the fan-out
// on its own clock. This is the single door: keyed on the watched-location
// signature (so editing the list busts it immediately), 10-min TTL, and one
// in-flight promise so concurrent callers share a gather instead of stacking.

import { getForceProtection, type ForceProtectionResult } from "./forceProtection";
import type { CountryWatch, ForceLocation } from "./types";

const TTL = 10 * 60 * 1000;
const STALE_MAX = 30 * 60 * 1000;
let cache: { key: string; at: number; body: ForceProtectionResult } | null = null;
let inflight: { key: string; p: Promise<ForceProtectionResult> } | null = null;

export function forceWatchKey(countries: CountryWatch[], bases: ForceLocation[]): string {
  return [
    ...countries.map((c) => `c:${c.id}:${c.country}`),
    ...bases.map((l) => `b:${l.id}:${l.lat},${l.lon}:${l.icao ?? ""}:${l.start ?? ""}-${l.end ?? ""}`),
  ].join("|");
}

export async function getForceProtectionCached(countries: CountryWatch[], bases: ForceLocation[] = []): Promise<ForceProtectionResult> {
  const key = forceWatchKey(countries, bases);
  if (cache && cache.key === key && Date.now() - cache.at < TTL) return cache.body;
  // Stale-while-revalidate (2026-11-24, the load-time review): the same watch
  // list read under STALE_MAX ago is answered at once while the next gather
  // runs — an expired memo used to hold the page's posture (and the brief,
  // alerts, commands, the demand horizon) for a full cold fan-out, GDELT queue
  // included. A changed watch list never gets the old read.
  if (cache && cache.key === key && Date.now() - cache.at < STALE_MAX) { start(key, countries, bases).catch(() => {}); return cache.body; }
  return start(key, countries, bases);
}

function start(key: string, countries: CountryWatch[], bases: ForceLocation[]): Promise<ForceProtectionResult> {
  if (inflight && inflight.key === key) return inflight.p;
  const p = getForceProtection(countries, bases).then((body) => {
    cache = { key, at: Date.now(), body };
    return body;
  }).finally(() => { if (inflight?.key === key) inflight = null; });
  inflight = { key, p };
  return p;
}

export function resetForceProtectionCache(): void { cache = null; }
