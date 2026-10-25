// Why a model call failed, in words a panel may show. The Anthropic SDK
// throws typed errors (status codes, connection / timeout classes) and our
// own parser throws `ModelJsonError`; a route used to collapse all of them
// into one "analysis failed" and log the detail where nobody reads it, so
// "it happens from time to time" could never be attributed. This names the
// CLASS of failure — never the raw message, which can carry request ids,
// hostnames or a slice of the prompt.
//
// PURE, dependency-free, tested in tests/modelFailure.test.ts.

export type ModelFailureKind =
  | "timeout"        // the call outran its deadline
  | "overloaded"     // 529 / 503 — the API is shedding load
  | "rate-limited"   // 429 on the API side
  | "api-error"      // another 4xx / 5xx from the API
  | "network"        // connection refused / reset / DNS
  | "cut-off"        // reply truncated and unrepairable
  | "not-json"       // reply parsed to nothing object-shaped
  | "empty"          // no text block at all
  | "unknown";

export interface ModelFailure {
  kind: ModelFailureKind;
  /** One short sentence safe to show. */
  text: string;
  /** Worth retrying without a change (transient)? */
  transient: boolean;
}

const TEXT: Record<ModelFailureKind, string> = {
  timeout: "the model call timed out",
  overloaded: "the model API is overloaded",
  "rate-limited": "the model API rate-limited the call",
  "api-error": "the model API returned an error",
  network: "the model API could not be reached",
  "cut-off": "the model reply was cut off and could not be repaired",
  "not-json": "the model reply was not JSON",
  empty: "the model returned no text",
  unknown: "the analysis failed",
};

const TRANSIENT = new Set<ModelFailureKind>(["timeout", "overloaded", "rate-limited", "network", "api-error", "unknown"]);

export function classifyModelFailure(err: unknown): ModelFailure {
  const kind = kindOf(err);
  return { kind, text: TEXT[kind], transient: TRANSIENT.has(kind) };
}

function kindOf(err: unknown): ModelFailureKind {
  if (!err || typeof err !== "object") return "unknown";
  const e = err as { name?: unknown; status?: unknown; message?: unknown; reason?: unknown; code?: unknown };
  const name = typeof e.name === "string" ? e.name : "";
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (name === "ModelJsonError") return e.reason === "empty" ? "empty" : "not-json";
  if (name === "APIConnectionTimeoutError" || /timed? ?out/.test(msg)) return "timeout";
  if (name === "APIConnectionError" || /econnre|enotfound|fetch failed|socket hang up|network/.test(msg)) return "network";
  const status = typeof e.status === "number" ? e.status : NaN;
  if (status === 529 || status === 503 || /overloaded/.test(msg)) return "overloaded";
  if (status === 429) return "rate-limited";
  if (Number.isFinite(status) && status >= 400) return "api-error";
  if (/cut off|truncat/.test(msg)) return "cut-off";
  return "unknown";
}
