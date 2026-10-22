import { NextResponse } from "next/server";
import { anthropic } from "@/lib/claude";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { logCall } from "@/lib/anthropicLog";
import { checkRateLimit } from "@/lib/rateLimit";
import { buildAskPack } from "@/lib/askPack";
import { ASK_SYSTEM, renderAskUser, type AskDoor } from "@/lib/askFormat";
import { normalizeQuestion } from "@/lib/askResolve";

export const dynamic = "force-dynamic";

// "Ask the board" (docs/PLAN-SPACE-CYBER-ASK.md §4): one question answered
// from the dashboard's OWN picture — every surface the app keeps about the
// actors the question names, packed by lib/askPack (bounded, no new fetch)
// and read by one on-tap model call under a fixed contract (lib/askFormat
// ASK_SYSTEM): BLUF in the board's vocabulary, evidence by indicator with
// the surface named, what is NOT observed, what would change the call,
// confidence — and no bare probability. Sonnet by default, Opus on request.
// Cached 15 min per (normalised question × evidence fingerprint): a repeat
// question against an unchanged picture is free. Gated on the `chat`
// feature; logged as `ask` in the ledger.

const MODELS = { sonnet: "claude-sonnet-4-6", opus: "claude-opus-4-7" } as const;
const MAX_QUESTION = 600;
const CACHE_TTL = 15 * 60_000;
const cache = new Map<string, { at: number; body: AskAnswer }>();

interface AskAnswer {
  answer: string;
  model: string;
  entities: { countries: string[]; aors: string[]; boards: string[]; unplaced: string[]; wantsProbability: boolean };
  surfaces: { label: string; door?: AskDoor; unavailable?: boolean }[];
  unavailable: string[];
  atISO: string;
  cached?: boolean;
  usage?: { input: number; output: number };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);

  let body: { question?: unknown; model?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, MAX_QUESTION) : "";
  if (question.length < 4) return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  const which = body.model === "opus" ? "opus" : "sonnet";
  const model = MODELS[which];

  const prefs = await getUserPrefs(email).catch(() => null);
  if (!isFeatureEnabled("chat", prefs)) return NextResponse.json({ error: "Chat is disabled in Preferences → AI Controls." }, { status: 403 });

  // The pack first — it is cheap and deterministic — so the cache key can
  // include the evidence fingerprint: a repeat against a changed picture
  // re-asks; against the same picture it is free.
  const pack = await buildAskPack(question, email, { maxWaitMs: 9_000 });
  const key = `${which}|${normalizeQuestion(question)}|${pack.fingerprint}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return NextResponse.json({ ...hit.body, cached: true });

  // The rate limit guards the MODEL call, never a cache replay.
  if (!checkRateLimit(`ask:${email}`, 8_000)) return NextResponse.json({ error: "One question every 8 s — try again in a moment." }, { status: 429 });

  const entities = { countries: pack.resolution.countries, aors: pack.resolution.aors, boards: pack.sections.filter((s) => s.surface.includes("I&W ·")).map((s) => s.surface.split("I&W · ")[1] ?? s.surface), unplaced: pack.resolution.unplaced, wantsProbability: pack.resolution.wantsProbability };
  const t0 = Date.now();
  try {
    const res = await anthropic.messages.create({
      model, max_tokens: 1400,
      system: [{ type: "text", text: ASK_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderAskUser(question, entities, pack.text) }],
    }, { timeout: 120_000, maxRetries: 1 });
    const answer = res.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n").trim();
    logCall({ route: "ask", user: email, model, usage: res.usage, durationMs: Date.now() - t0 }).catch(() => {});
    if (!answer) return NextResponse.json({ error: "The model returned an empty answer — please retry." }, { status: 502 });
    const out: AskAnswer = {
      answer, model: which, entities,
      surfaces: pack.sections.map((s) => ({ label: s.surface, door: s.door, unavailable: s.unavailable })),
      unavailable: pack.unavailable, atISO: pack.atISO,
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
    };
    cache.set(key, { at: Date.now(), body: out });
    if (cache.size > 60) { const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) cache.delete(oldest[0]); }
    return NextResponse.json(out);
  } catch (e) {
    console.error("ask failed:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: /timed? ?out/i.test(msg) ? "The model timed out — try again." : /overloaded|529/i.test(msg) ? "The AI is temporarily busy — try again in a moment." : "Could not answer from the board this pass." }, { status: 502 });
  }
}
