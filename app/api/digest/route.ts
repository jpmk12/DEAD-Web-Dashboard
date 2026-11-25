import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { getUserPrefs, buildUserContext } from "@/lib/userPrefs";
import { readPrefs as readArticlePrefs } from "@/lib/articlePrefs";
import { readPrefs as readNewsletterPrefs } from "@/lib/newsletterPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { logCall } from "@/lib/anthropicLog";
import { normEmail } from "@/lib/allowlist";
import { parseModelJson } from "@/lib/aiJson";
import { getDb } from "@/lib/db";
import type { RowDataPacket } from "mysql2";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are a personal reading analyst. Based on the user's engagement patterns (which keywords and sources they marked useful vs. not useful), generate a weekly digest insight. Return ONLY a JSON object with no markdown:
{
  "topTopics": ["topic 1", "topic 2", "topic 3"],
  "readingInsight": "2-4 substantive sentences about their engagement patterns — call out concrete keywords, sources, and any clear preference shifts",
  "coverageGaps": "1-3 sentences about topics in their stated interests they haven't engaged with, with concrete next-step suggestions",
  "nextWeekRecommendations": ["specific recommendation 1", "specific recommendation 2", "specific recommendation 3"]
}

Be concrete and reference the actual keywords / sources from the user data — vague platitudes ("you read a lot about world events") are unhelpful.`;

// Server-side day cache — the digest summarizes a WEEK of reading patterns,
// so one generation per user per day is more than fresh enough. Without this
// the client prefetch (fires on every mount/focus past its 30-min in-memory
// TTL) ran a full Sonnet call per page reload; this was the app's single
// largest source of silent AI spend.
const DIGEST_TTL_MS = 24 * 60 * 60 * 1000;
const digestCache = new Map<string, { digest: unknown; day: string; expires: number }>();
// One generation per user at a time (two devices loading at once join it),
// and a failure is held five minutes — the client re-primes on every focus,
// so an error used to re-spend a Sonnet call on each tab switch (code review
// 2026-10-28).
const inflight = new Map<string, Promise<unknown>>();
const failedAt = new Map<string, number>();
const FAIL_HOLD_MS = 5 * 60_000;

// The day's digest survives a deploy in `digest_cache` (2026-11-25): the
// in-memory map is the fast path, the row the one a fresh process reads
// before paying for a generation. Both directions are best-effort — a dead
// table costs one Sonnet call, never the digest.
async function readStoredDigest(email: string, day: string): Promise<unknown | null> {
  try {
    const pool = await getDb();
    const [rows] = await pool.query<RowDataPacket[]>("SELECT digest FROM digest_cache WHERE user_email = ? AND day = ?", [email, day]);
    const raw = rows[0]?.digest;
    if (raw == null) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function storeDigest(email: string, day: string, digest: unknown): Promise<void> {
  try {
    const pool = await getDb();
    await pool.query(
      `INSERT INTO digest_cache (user_email, day, digest, generated_at) VALUES (?, ?, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE day = VALUES(day), digest = VALUES(digest), generated_at = VALUES(generated_at)`,
      [email, day, JSON.stringify(digest), Date.now()],
    );
  } catch (err) {
    console.error("Digest store failed:", err instanceof Error ? err.message : err);
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = normEmail(session.user?.email);
  const day = new Date().toISOString().slice(0, 10);
  const hit = digestCache.get(email);
  if (hit && hit.day === day && hit.expires > Date.now()) {
    return NextResponse.json({ digest: hit.digest, cached: true });
  }
  const stored = await readStoredDigest(email, day);
  if (stored) {
    digestCache.set(email, { digest: stored, day, expires: Date.now() + DIGEST_TTL_MS });
    return NextResponse.json({ digest: stored, cached: true });
  }

  const [prefs, articlePrefs, newsletterPrefs] = await Promise.all([
    getUserPrefs(normEmail(session.user?.email)),
    readArticlePrefs(normEmail(session.user?.email)),
    readNewsletterPrefs(normEmail(session.user?.email)),
  ]);

  const userContext = buildUserContext(prefs);

  const topArticleKeywords = Object.entries(articlePrefs.keywords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([kw, score]) => `${kw}: ${score > 0 ? "+" : ""}${score}`)
    .join(", ");

  const topSources = Object.entries(articlePrefs.sources)
    .sort((a, b) => b[1] - a[1])
    .map(([src, score]) => `${src}: ${score > 0 ? "+" : ""}${score}`)
    .join(", ");

  const topNewsletterOpens = Object.entries(newsletterPrefs.openCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([series, count]) => `${series}: opened ${count}x`)
    .join(", ");

  const context = [
    topArticleKeywords && `Article keyword preferences: ${topArticleKeywords}`,
    topSources && `Source preferences: ${topSources}`,
    topNewsletterOpens && `Newsletter engagement: ${topNewsletterOpens}`,
    prefs.priorityTopics.length && `Stated priority topics: ${prefs.priorityTopics.join(", ")}`,
    prefs.watchlist.length && `Watchlist terms: ${prefs.watchlist.join(", ")}`,
  ].filter(Boolean).join("\n");

  if (!context) {
    return NextResponse.json({
      digest: {
        topTopics: [],
        readingInsight: "No engagement data yet. Rate articles and newsletters to build your profile.",
        coverageGaps: "",
        nextWeekRecommendations: [],
      },
    });
  }

  if (!isFeatureEnabled("digest", prefs)) {
    return NextResponse.json(
      { error: "Weekly digest is disabled in Preferences → AI Controls", disabled: true },
      { status: 503 }
    );
  }

  const failed = failedAt.get(email);
  if (failed && Date.now() - failed < FAIL_HOLD_MS) {
    return NextResponse.json({ error: "Digest generation failed a moment ago — it will retry in a few minutes" }, { status: 503 });
  }
  const running = inflight.get(email);
  if (running) {
    try { return NextResponse.json({ digest: await running }); }
    catch { return NextResponse.json({ error: "Digest generation failed" }, { status: 500 }); }
  }
  const job = (async () => {
    const modelStart = Date.now();
    const response = await anthropic.messages.create({
      // Sonnet handles structured JSON from already-scored data well and
      // is materially cheaper than Opus for this task.
      model: "claude-sonnet-4-6",
      // 2048 leaves room for verbose JSON without bumping into the cap
      // mid-string — at 1024 a chatty 3-sentence reading insight + the
      // other fields could get cut off and the parser would salvage a
      // truncated readingInsight from the partial JSON.
      max_tokens: 2048,
      system: [
        { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
        ...(userContext ? [{ type: "text" as const, text: userContext }] : []),
      ],
      messages: [{ role: "user", content: context }],
    }, { timeout: 90_000, maxRetries: 1 });

    logCall({ route: "digest", model: "claude-sonnet-4-6", usage: response.usage, durationMs: Date.now() - modelStart, user: normEmail(session.user?.email) }).catch(() => {});

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text : "{}";
    const p = parseModelJson(raw).value;
    // Field caps generous enough to fit the prompt's "2-4 sentence" target
    // without truncation. The earlier 500/400/200 numbers were leftover from
    // when the prompt asked for a single sentence — they were silently
    // cutting Reading Patterns mid-thought.
    const digest = {
      topTopics: Array.isArray(p.topTopics) ? (p.topTopics as unknown[]).map((s) => String(s).slice(0, 120)) : [],
      readingInsight: String(p.readingInsight ?? "").slice(0, 1500),
      coverageGaps: String(p.coverageGaps ?? "").slice(0, 1000),
      nextWeekRecommendations: Array.isArray(p.nextWeekRecommendations) ? (p.nextWeekRecommendations as unknown[]).map((s) => String(s).slice(0, 400)) : [],
    };
    digestCache.set(email, { digest, day, expires: Date.now() + DIGEST_TTL_MS });
    await storeDigest(email, day, digest);
    return digest;
  })();
  inflight.set(email, job);
  try {
    const digest = await job;
    failedAt.delete(email);
    return NextResponse.json({ digest });
  } catch (err) {
    console.error("Digest failed:", err);
    failedAt.set(email, Date.now());
    return NextResponse.json({ error: "Digest generation failed" }, { status: 500 });
  } finally {
    inflight.delete(email);
  }
}
