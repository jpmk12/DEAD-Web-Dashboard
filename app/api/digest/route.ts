import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { getUserPrefs, buildUserContext } from "@/lib/userPrefs";
import { readPrefs as readArticlePrefs } from "@/lib/articlePrefs";
import { readPrefs as readNewsletterPrefs } from "@/lib/newsletterPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { logCall } from "@/lib/anthropicLog";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are a personal reading analyst. Based on the user's engagement patterns (which keywords and sources they marked useful vs. not useful), generate a weekly digest insight. Return ONLY a JSON object with no markdown:
{
  "topTopics": ["topic 1", "topic 2", "topic 3"],
  "readingInsight": "2-4 substantive sentences about their engagement patterns — call out concrete keywords, sources, and any clear preference shifts",
  "coverageGaps": "1-3 sentences about topics in their stated interests they haven't engaged with, with concrete next-step suggestions",
  "nextWeekRecommendations": ["specific recommendation 1", "specific recommendation 2", "specific recommendation 3"]
}

Be concrete and reference the actual keywords / sources from the user data — vague platitudes ("you read a lot about world events") are unhelpful.`;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [prefs, articlePrefs, newsletterPrefs] = await Promise.all([
    getUserPrefs(),
    readArticlePrefs(),
    readNewsletterPrefs(),
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

  try {
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
    });

    logCall({ route: "digest", model: "claude-sonnet-4-6", usage: response.usage }).catch(() => {});

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text : "{}";
    let clean = raw.replace(/^```(?:json)?\n?/im, "").replace(/\n?```\s*$/m, "").trim();
    const objStart = clean.indexOf("{");
    if (objStart > 0) clean = clean.slice(objStart);
    const objEnd = clean.lastIndexOf("}");
    if (objEnd >= 0 && objEnd < clean.length - 1) clean = clean.slice(0, objEnd + 1);
    const parsed = JSON.parse(clean);
    const p = parsed as Record<string, unknown>;
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
    return NextResponse.json({ digest });
  } catch (err) {
    console.error("Digest failed:", err);
    return NextResponse.json({ error: "Digest generation failed" }, { status: 500 });
  }
}
