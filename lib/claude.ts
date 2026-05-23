import Anthropic from "@anthropic-ai/sdk";

export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

// Module-level singleton — only instantiated when first imported at request time,
// not during Next.js build-time page data collection.
let _client: Anthropic | undefined;
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    if (!_client) _client = getAnthropic();
    return (_client as unknown as Record<string | symbol, unknown>)[prop];
  },
});
