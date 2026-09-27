import Anthropic from "@anthropic-ai/sdk";
import { recordAiOk, recordAiFail } from "./aiHealth";

export function getAnthropic(): Anthropic {
  // TRIM is load-bearing, not hygiene. The hosting env UI is known to append a
  // trailing newline to pasted values — it already broke the Gmail secondary
  // redirect_uri, where Google's byte-for-byte match failed on an invisible
  // character. The same paste path feeds this key, and an untrimmed one is
  // rejected 401 on every call, which each route then swallows into its own
  // placeholder ("No key facts extracted", "Couldn't generate a thesis").
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

// Shape of the configured key, for the owner-only diagnostic in AI Controls.
// Never returns the key — only what is wrong with it.
export type KeyFormat = "missing" | "whitespace" | "unexpected-prefix" | "ok";

export function keyFormat(): KeyFormat {
  const raw = process.env.ANTHROPIC_API_KEY ?? "";
  if (!raw.trim()) return "missing";
  if (raw !== raw.trim()) return "whitespace";
  if (!raw.startsWith("sk-ant-")) return "unexpected-prefix";
  return "ok";
}

// Module-level singleton — only instantiated when first imported at request time,
// not during Next.js build-time page data collection.
//
// The proxy also records the outcome of every messages.create() into aiHealth.
// Doing it HERE rather than at the 22 call sites is deliberate: each route
// catches its own failure and degrades to a placeholder, so without a central
// hook a rejected API key looks exactly like a quiet news day. One wrapper
// covers every existing route and every future one for free.
let _client: Anthropic | undefined;

function wrapMessages(messages: Anthropic["messages"]): Anthropic["messages"] {
  return new Proxy(messages, {
    get(target, prop, receiver) {
      const inner = Reflect.get(target, prop, receiver);
      if (prop !== "create" || typeof inner !== "function") {
        return typeof inner === "function" ? (inner as (...a: unknown[]) => unknown).bind(target) : inner;
      }
      return (...args: unknown[]) => {
        const result = (inner as (...a: unknown[]) => unknown).apply(target, args);
        // Both the plain and stream:true forms return a thenable; an auth or
        // transport failure rejects it before any tokens flow. Errors thrown
        // mid-stream are the route's to handle and are not health signals.
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          (result as Promise<unknown>).then(recordAiOk, recordAiFail);
        }
        return result;
      };
    },
  }) as Anthropic["messages"];
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    if (!_client) _client = getAnthropic();
    const value = (_client as unknown as Record<string | symbol, unknown>)[prop];
    if (prop === "messages" && value) return wrapMessages(value as Anthropic["messages"]);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(_client) : value;
  },
});
