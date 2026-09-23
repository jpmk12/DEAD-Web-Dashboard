import Anthropic from "@anthropic-ai/sdk";
import { recordAiOk, recordAiFail } from "./aiHealth";

export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
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
