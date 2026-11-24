// The one-line rendering of a lift-chatter cluster, in a module of its own so
// Glance can format the server's clusters without loading the whole chatter
// grammar (lib/mobilityChatter.ts, ~50 KB of source) into the first page chunk
// (2026-11-24, the load-time review). Re-exported from mobilityChatter.
import type { ChatterCluster } from "./mobilityChatter";

export function chatterLine(c: ChatterCluster, relTime?: (iso: string) => string): string {
  const parts = [`${c.reports} report${c.reports === 1 ? "" : "s"} from ${c.sources} ${c.sources === 1 ? "handle" : "handles"}`];
  const what = [c.tankers ? `tankers ${c.tankers}` : "", c.airlifters ? `airlift ${c.airlifters}` : ""].filter(Boolean).join(" · ");
  if (what) parts.push(what);
  if (c.count) parts.push(`up to ${c.count} stated`);
  if (c.places.length) parts.push(`${c.direction === "away" ? "from" : "toward"} ${c.places.join(" / ")}`);
  if (relTime) parts.push(`newest ${relTime(c.pubDate)}`);
  return `${c.aor} · ${c.direction === "away" ? "returning" : c.direction === "toward" ? "inbound" : "moving"} — ${parts.join(" · ")}`;
}
