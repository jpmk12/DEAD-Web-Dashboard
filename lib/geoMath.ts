// Great-circle distance — PURE, dependency-free, client-safe. The ONE home
// (housekeeping 2026-11-04: six byte-equivalent copies). Dependency-free on
// purpose: lib/airfields.ts is imported by client components and must not
// drag lib/disasters.ts (rss-parser) into the client bundle, which is why its
// copy was inlined in the first place.

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
