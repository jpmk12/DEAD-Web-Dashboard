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
import { classifyModelFailure } from "@/lib/modelFailure";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

// "Ask the board" (docs/PLAN-SPACE-CYBER-ASK.md §4): one question answered
// from the dashboard's OWN picture — every surface the app keeps about the
// actors the question names, packed by lib/askPack (bounded, no new fetch)
// and read by one on-tap model call under a fixed contract (lib/askFormat
// ASK_SYSTEM): BLUF in the board's vocabulary, evidence by indicator with
// the surface named, what is NOT observed, what would change the call,
// confidence — and no bare probability. Sonnet by default, Opus on request.
// Cached 15 min per (user × normalised question × evidence fingerprint): a repeat
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

// LATENCY RULE (code review 2026-10-28): the pack is a fan-out across a dozen
// cached surfaces and the model call can take a minute, so neither runs on
// the request path. POST starts ONE background job per (user × model ×
// question × evidence) — a second POST for the same thing joins it — waits
// `WAIT_MS`, and otherwise answers 202 `{ pending, ticket }`; the client
// polls GET `?ticket=` (scoped to the asking user). The cache key carries the
// user because the pack does: "what changed since YOUR last look" and the
// user's own docs are per-user, so one crew member's answer must never be
// replayed to another.
const WAIT_MS = 20_000;
const JOB_TTL = 10 * 60_000;
interface Job { email: string; at: number; done: boolean; body?: AskAnswer; error?: string; status?: number }
const jobs = new Map<string, Job>();

function sweepJobs(now = Date.now()): void {
  for (const [k, j] of jobs) if (now - j.at > JOB_TTL) jobs.delete(k);
}

function jobReply(ticket: string, j: Job): Response {
  if (!j.done) return NextResponse.json({ pending: true, ticket, note: "Reading the board and asking the model…" }, { status: 202 });
  if (j.body) return NextResponse.json(j.body);
  return NextResponse.json({ error: j.error ?? "Could not answer from the board this pass." }, { status: j.status ?? 502 });
}

async function waitFor(j: Job, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!j.done && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  const ticket = new URL(req.url).searchParams.get("ticket") ?? "";
  const j = jobs.get(ticket);
  if (!j || j.email !== email) return NextResponse.json({ error: "That question has expired — ask it again." }, { status: 404 });
  await waitFor(j, 8_000);
  return jobReply(ticket, j);
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

  sweepJobs();
  // The ticket is the question for this user before the pack exists; the
  // evidence fingerprint is folded into the ANSWER cache below.
  const ticket = createHash("sha256").update(`${email}|${which}|${normalizeQuestion(question)}`).digest("hex").slice(0, 24);
  const running = jobs.get(ticket);
  if (running && !running.done) { await waitFor(running, WAIT_MS); return jobReply(ticket, running); }
  // A job that finished in the last two minutes is the answer the client gave
  // up waiting for ("ask again and it will be waiting") — hand it over.
  if (running?.body && Date.now() - running.at < 2 * 60_000) return jobReply(ticket, running);

  // The rate limit guards STARTING a job, never joining one or a replay.
  const job: Job = { email, at: Date.now(), done: false };
  jobs.set(ticket, job);
  void runJob(job, { question, email, which, model }).catch((e) => { job.done = true; job.error = "Could not answer from the board this pass."; console.error("ask job failed:", e); });
  await waitFor(job, WAIT_MS);
  return jobReply(ticket, job);
}

async function runJob(job: Job, a: { question: string; email: string; which: "sonnet" | "opus"; model: string }): Promise<void> {
  const { question, email, which, model } = a;
  const finish = (patch: Partial<Job>) => { Object.assign(job, patch, { done: true }); };
  // The pack first — cheap and deterministic — so the answer cache key can
  // include the evidence fingerprint: a repeat against a changed picture
  // re-asks; against the same picture it is free.
  const pack = await buildAskPack(question, email, { maxWaitMs: 9_000 });
  const key = `${email}|${which}|${normalizeQuestion(question)}|${pack.fingerprint}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return finish({ body: { ...hit.body, cached: true } });

  if (!checkRateLimit(`ask:${email}`, 8_000)) return finish({ error: "One question every 8 s — try again in a moment.", status: 429 });

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
    if (!answer) return finish({ error: "The model returned an empty answer — please retry.", status: 502 });
    const out: AskAnswer = {
      answer, model: which, entities,
      surfaces: pack.sections.map((s) => ({ label: s.surface, door: s.door, unavailable: s.unavailable })),
      unavailable: pack.unavailable, atISO: pack.atISO,
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
    };
    cache.set(key, { at: Date.now(), body: out });
    if (cache.size > 60) { const oldest = [...cache.entries()].sort((x, y) => x[1].at - y[1].at)[0]; if (oldest) cache.delete(oldest[0]); }
    finish({ body: out });
  } catch (e) {
    console.error("ask failed:", e);
    finish({ error: classifyModelFailure(e).text, status: 502 });
  }
}
