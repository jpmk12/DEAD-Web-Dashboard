// Marking mail read without tripping Gmail's per-user limit — PURE (the
// Gmail calls are injected), tested in tests/gmailMark.test.ts.
//
// The old path sent one messages.modify per id, ten at a time; each costs
// quota units and a long "mark all read" burst past the per-user rate, so
// some ids came back refused and the operator had to press the button again
// (2026-11-09, "I have to retry several times"). Now: ONE batchModify per
// chunk of up to 1,000 ids (a single call); only when a chunk is refused for
// a reason other than auth does it fall back to one-by-one, a few at a time,
// with one retry after a pause on a rate limit. The ids still refused at the
// end are returned so the caller reports them — never a silent success.

export const BATCH_CHUNK = 1000;
export const SINGLE_CONCURRENCY = 4;
export const RATE_RETRY_MS = 1200;

export interface MarkDeps {
  /** One batchModify call; throws when Gmail refuses the chunk. */
  batch: (ids: string[]) => Promise<void>;
  /** One messages.modify call; throws when refused. */
  single: (id: string) => Promise<void>;
  /** True when the error is Gmail's per-user rate limit. */
  isRate: (err: unknown) => boolean;
  /** True when the error is an auth refusal — retrying cannot help. */
  isAuth: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Returns the ids Gmail REFUSED (empty = every id marked). */
export async function markReadWithFallback(ids: string[], deps: MarkDeps): Promise<string[]> {
  const sleep = deps.sleep ?? wait;
  const uniq = [...new Set(ids.filter(Boolean))];
  const failed: string[] = [];
  for (let i = 0; i < uniq.length; i += BATCH_CHUNK) {
    const chunk = uniq.slice(i, i + BATCH_CHUNK);
    try {
      await deps.batch(chunk);
      continue;
    } catch (err) {
      if (deps.isAuth(err)) { failed.push(...chunk); continue; }
      if (deps.isRate(err)) await sleep(RATE_RETRY_MS);
      // One more batch try after a rate-limit pause — the cheap path again.
      if (deps.isRate(err)) {
        try { await deps.batch(chunk); continue; } catch { /* fall through to one-by-one */ }
      }
    }
    // One by one, a few at a time, each retried once on a rate limit.
    let next = 0;
    const worker = async () => {
      while (next < chunk.length) {
        const id = chunk[next++];
        try {
          await deps.single(id);
        } catch (err) {
          if (deps.isRate(err)) {
            await sleep(RATE_RETRY_MS);
            try { await deps.single(id); continue; } catch { /* refused twice */ }
          }
          failed.push(id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SINGLE_CONCURRENCY, chunk.length) }, worker));
  }
  return failed;
}
