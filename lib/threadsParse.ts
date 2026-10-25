// The Threads reply, parsed and validated — PURE, client-safe, tested in
// tests/threadsParse.test.ts. Extracted from /api/threads so the shape rules
// (field caps, trend vocabulary, article ids that must exist in the input)
// are testable and so a cut-off reply is REPAIRED rather than thrown away:
// an Opus read over forty articles can overrun `max_tokens`, and the route
// used to answer "Thread analysis failed" for the whole day's read when the
// last thread's closing brace was missing.

import { parseModelJson } from "./aiJson";
import type { NewsThread, ThreadsResult } from "./types";

const TRENDS = ["rising", "stable", "fading"] as const;

export interface ParsedThreads {
  result: ThreadsResult;
  /** The reply overran the output cap and was repaired — a thread or two may be missing. */
  truncated: boolean;
}

/** Throws `ModelJsonError` when nothing object-shaped survives. */
export function parseThreadsReply(raw: string, validIds: ReadonlySet<string>): ParsedThreads {
  const { value: parsed, truncated } = parseModelJson(raw);
  const threads: NewsThread[] = Array.isArray(parsed.threads)
    ? (parsed.threads as unknown[])
        .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
        .map((t): NewsThread => ({
          label: String(t.label ?? "").slice(0, 30).toUpperCase(),
          headline: String(t.headline ?? "").slice(0, 300),
          summary: String(t.summary ?? "").slice(0, 600),
          amc: typeof t.amc === "string" && t.amc.trim() ? String(t.amc).slice(0, 300) : undefined,
          trend: (TRENDS as readonly string[]).includes(String(t.trend)) ? (t.trend as NewsThread["trend"]) : "stable",
          articleIds: Array.isArray(t.articleIds)
            ? (t.articleIds as unknown[]).map(String).filter((id) => validIds.has(id))
            : [],
          sources: Array.isArray(t.sources) ? (t.sources as unknown[]).map(String).slice(0, 6) : [],
          newsletterContext: t.newsletterContext ? String(t.newsletterContext).slice(0, 300) : undefined,
        }))
        .filter((t) => t.label && t.articleIds.length > 0)
    : [];
  return {
    result: { throughLine: String(parsed.throughLine ?? ""), threads },
    truncated,
  };
}

/** A read with no threads at all is not a read — the day's last one is better. */
export function isEmptyThreads(r: ThreadsResult): boolean {
  return r.threads.length === 0;
}
