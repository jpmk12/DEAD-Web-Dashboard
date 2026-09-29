// Client-side "I opened this" — one fire-and-forget POST per (surface, id),
// throttled per page so a re-render or a toggle cannot inflate a count. The
// surfaces are the palette's entity kinds (base / board / country); the
// server only counts, the palette only ranks.

import type { OpenSurface } from "./openSignal";

const THROTTLE_MS = 60_000;
const recent = new Map<string, number>();

export function noteOpen(surface: OpenSurface, id: string): void {
  if (typeof window === "undefined" || !id) return;
  const key = `${surface}:${id}`;
  const now = Date.now();
  const last = recent.get(key) ?? 0;
  if (now - last < THROTTLE_MS) return;
  recent.set(key, now);
  try {
    fetch("/api/opens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface, id }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}
