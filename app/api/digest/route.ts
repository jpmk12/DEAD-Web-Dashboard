import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { getUserPrefs, buildUserContext } from "@/lib/userPrefs";
import { readPrefs as readArticlePrefs } from "@/lib/articlePrefs";
import { readPrefs as readNewsletterPrefs } from "@/lib/newsletterPrefs";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are a personal reading analyst. Based on the user's engagement patterns (which keywords and sources they marked useful vs. not useful), generate a weekly digest insight. Return ONLY a JSON object with no markdown:
{
  "topTopics": ["topic 1", "topic 2", "topic 3"],
  "readingInsight": "2-3 sentences about their engagement patterns",
  "coverageGaps": "1-2 sentences about topics in their stated interests they haven't engaged with",
  "nextWeekRecommendations": ["specific recommendation 1", "specific recommendation 2", "specific recommendation 3"]
}`;

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

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      system: [
        { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
        ...(userContext ? [{ type: "text" as const, text: userContext }] : []),
      ],
      messages: [{ role: "user", content: context }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text : "{}";
    let clean = raw.replace(/^```(?:json)?\n?/im, "").replace(/\n?```\s*$/m, "").trim();
    const objStart = clean.indexOf("{");
    if (objStart > 0) clean = clean.slice(objStart);
    const objEnd = clean.lastIndexOf("}");
    if (objEnd >= 0 && objEnd < clean.length - 1) clean = clean.slice(0, objEnd + 1);
    const parsed = JSON.parse(clean);
    const p = parsed as Record<string, unknown>;
    const digest = {
      topTopics: Array.isArray(p.topTopics) ? (p.topTopics as unknown[]).map((s) => String(s).slice(0, 100)) : [],
      readingInsight: String(p.readingInsight ?? "").slice(0, 500),
      coverageGaps: String(p.coverageGaps ?? "").slice(0, 400),
      nextWeekRecommendations: Array.isArray(p.nextWeekRecommendations) ? (p.nextWeekRecommendations as unknown[]).map((s) => String(s).slice(0, 200)) : [],
    };
    return NextResponse.json({ digest });
  } catch (err) {
    console.error("Digest failed:", err);
    return NextResponse.json({ error: "Digest generation failed" }, { status: 500 });
  }
}
