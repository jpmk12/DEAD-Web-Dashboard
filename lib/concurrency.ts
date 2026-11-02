// Run async work with at most `limit` in flight — PURE, client-safe, tested
// (tests/concurrency.test.ts). Results keep the input order. A rejected task
// rejects the whole run, so callers that want per-task failures catch inside
// `fn` (the newsletter fetch does, and reports each failure by name).
export async function runLimited<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  const n = Math.max(1, Math.floor(limit) || 1);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
