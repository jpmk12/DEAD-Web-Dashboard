// Which captured X posts the store keeps — PURE, client-safe, unit-tested.
//
// Before 2026-10-31 the store kept the newest 1,000 posts overall and the
// readers took the newest 400. Two news lists capture ~200 posts each per
// sweep, so the "14-day" chatter and theme windows held about ONE day of X,
// and a low-volume spotter's post (@ArmchairAdml, 28 Oct) was crowded out by
// WSJ and the aggregators inside a day — the read said "0 lift chatter"
// because it never saw the post. Retention is now FAIR BY HANDLE: every
// handle keeps its newest `perHandleFloor` posts inside the window whatever
// the loud handles do, and the rest of the cap fills newest-first.

export interface XRetentionRow {
  id: string;
  handle: string;
  /** Post time, else import time, in ms. */
  ts: number;
}

/** The store's bounds: 14 days, at most `total` rows, and each handle's
 *  newest `perHandleFloor` posts always kept (so the floors can take the
 *  store a little past `total` when many handles post; that is the point). */
export const X_STORE_MAX_DAYS = 14;
export const X_STORE_TOTAL = 5000;
export const X_PER_HANDLE_FLOOR = 25;

/** The ids to KEEP. Rows outside the window are never kept. */
export function fairKeep(
  rows: XRetentionRow[],
  nowMs: number,
  opts: { total?: number; perHandleFloor?: number; maxDays?: number } = {},
): Set<string> {
  const total = opts.total ?? X_STORE_TOTAL;
  const floor = opts.perHandleFloor ?? X_PER_HANDLE_FLOOR;
  const cutoff = nowMs - (opts.maxDays ?? X_STORE_MAX_DAYS) * 86_400_000;
  const sorted = rows.filter((r) => Number.isFinite(r.ts) && r.ts >= cutoff).sort((a, b) => b.ts - a.ts);
  const keep = new Set<string>();
  const perHandle = new Map<string, number>();
  // Pass 1 — each handle's newest posts up to the floor.
  for (const r of sorted) {
    const h = r.handle.toLowerCase();
    const n = perHandle.get(h) ?? 0;
    if (n < floor) { keep.add(r.id); perHandle.set(h, n + 1); }
  }
  // Pass 2 — fill the rest of the cap newest-first.
  for (const r of sorted) {
    if (keep.size >= total) break;
    keep.add(r.id);
  }
  return keep;
}
