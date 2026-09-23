// Why the AI went quiet.
//
// Every AI route in this app degrades gracefully on failure — newsletters fall
// back to "No key facts extracted", triage to a neutral pill, the SITREP read
// to its deterministic fallback. That is correct behaviour (a dead model must
// never blank a board) but it makes every cause look identical from the UI: a
// rejected API key, an overloaded model, a blown rate limit and a feature
// toggle switched off all render the same empty state. Diagnosing the last one
// took reading source.
//
// So: record the outcome of the most recent model call centrally and let the
// owner see it. No extra API calls, no cost — this is a by-product of traffic
// that already happens.
//
// Scope: in-process and best-effort. It resets on restart and is per-instance,
// which is fine for a single-instance deploy and must not be mistaken for an
// audit trail — `anthropic_usage` is the durable ledger.

export type AiFailureKind = "auth" | "rate" | "overloaded" | "network" | "error";

export interface AiHealth {
  lastOkMs: number | null;
  lastFail: { kind: AiFailureKind; status: number | null; message: string; atMs: number } | null;
  // Consecutive failures since the last success — one blip is noise, a run is an outage.
  failStreak: number;
}

let lastOkMs: number | null = null;
let lastFail: AiHealth["lastFail"] = null;
let failStreak = 0;

function classify(status: number | null, message: string): AiFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate";
  if (status === 529 || (status !== null && status >= 500)) return "overloaded";
  if (status === null && /fetch|network|ECONN|ETIMEDOUT|socket/i.test(message)) return "network";
  return "error";
}

export function recordAiOk(): void {
  lastOkMs = Date.now();
  failStreak = 0;
}

export function recordAiFail(err: unknown): void {
  const e = err as { status?: unknown; message?: unknown; error?: { error?: { message?: unknown } } };
  const status = typeof e?.status === "number" ? e.status : null;
  // Prefer the API's own message ("invalid x-api-key") over the SDK wrapper's.
  const apiMsg = e?.error?.error?.message;
  const message = String(
    (typeof apiMsg === "string" && apiMsg) || (typeof e?.message === "string" && e.message) || "unknown error",
  ).slice(0, 300);
  failStreak += 1;
  lastFail = { kind: classify(status, message), status, message, atMs: Date.now() };
}

export function getAiHealth(): AiHealth {
  return { lastOkMs, lastFail, failStreak };
}

// One line the UI can render as-is. null = nothing worth saying.
export function aiHealthLine(h: AiHealth): string | null {
  if (!h.lastFail) return null;
  // A failure followed by a success is ordinary — only speak up while the
  // streak is live. Gate on failStreak, NOT on comparing timestamps: recordAiOk
  // and recordAiFail can land in the same millisecond, and ms granularity then
  // reports a recovered outage as ongoing.
  if (h.failStreak === 0) return null;
  const n = h.failStreak > 1 ? ` (${h.failStreak} in a row)` : "";
  switch (h.lastFail.kind) {
    case "auth":
      return `API key rejected — Anthropic returned ${h.lastFail.status}. Check ANTHROPIC_API_KEY in the hosting env, then restart so the process picks it up${n}.`;
    case "rate":
      return `Rate limited by Anthropic (429)${n}. AI output will be thin until it clears.`;
    case "overloaded":
      return `Anthropic unavailable (${h.lastFail.status ?? "5xx"})${n}. Usually transient.`;
    case "network":
      return `Could not reach Anthropic${n}: ${h.lastFail.message}`;
    default:
      return `Last AI call failed${n}: ${h.lastFail.message}`;
  }
}
