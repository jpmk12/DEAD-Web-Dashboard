"use client";

// Client side of the zone rule: ask /api/zone once (device zone attached),
// keep the answer for ten minutes, and hand it to whoever formats a time.
// Until the answer arrives the device zone is used, labelled — a label is
// never omitted, even while loading.

import { useEffect, useState } from "react";
import { clientCache } from "./clientCache";
import { zoneLabel, type ZoneSource } from "./effectiveZone";

export interface EffectiveZone {
  zone: string;
  source: ZoneSource;
  label: string;
  device: string | null;
  trip: { label: string; endDate: string; tz: string | null } | null;
}

export const ZONE_CACHE_KEY = "zone:effective";
const TTL = 10 * 60 * 1000;

export function deviceZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

let inflight: Promise<EffectiveZone | null> | null = null;

export function fetchEffectiveZone(): Promise<EffectiveZone | null> {
  const cached = clientCache.peek<EffectiveZone>(ZONE_CACHE_KEY);
  if (cached && clientCache.isFresh(ZONE_CACHE_KEY)) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch(`/api/zone?device=${encodeURIComponent(deviceZone())}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: EffectiveZone | null) => {
      if (j && typeof j.zone === "string") { clientCache.set(ZONE_CACHE_KEY, j, TTL); return j; }
      return null;
    })
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}

/** The zone the brief POSTs should carry: the effective one when known,
 *  else the device's. Synchronous — reads the cache only. */
export function zoneForRequests(): string {
  return clientCache.peek<EffectiveZone>(ZONE_CACHE_KEY)?.zone ?? deviceZone();
}

/** Hook: the effective zone, starting from the device zone so the first
 *  render is labelled, then the server's answer. */
export function useEffectiveZone(): EffectiveZone {
  const [z, setZ] = useState<EffectiveZone>(() => {
    const cached = clientCache.peek<EffectiveZone>(ZONE_CACHE_KEY);
    if (cached) return cached;
    const d = deviceZone();
    return { zone: d, source: "device", label: zoneLabel(d), device: d, trip: null };
  });
  useEffect(() => {
    let alive = true;
    fetchEffectiveZone().then((r) => { if (alive && r) setZ(r); });
    return () => { alive = false; };
  }, []);
  return z;
}
