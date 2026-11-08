import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getTheme, upsertTheme, addDismissed, listFeedback, setFeedback } from "@/lib/themeStore";
import { getTuningPool, backfillThemeSeries, resetThemesCache } from "@/lib/themesAssemble";
import {
  normalizeThemeDraft, normalizeExclusions, parsePhrasesText, validateThemeDraft,
  THEME_MAX_PHRASES, THEME_PHRASE_MIN, THEME_PHRASE_MAX, type Theme,
} from "@/lib/themes";
import {
  previewPhrases, phraseStats, suggestPhrases, coverageOf, exclusionCandidates,
  type ThemeVerdict,
} from "@/lib/themeTuning";
import { resetWarningCache } from "@/lib/warningAssess";

export const dynamic = "force-dynamic";

// Theme tuning — how the data already collected can make a declared theme
// better (lib/themeTuning: PURE, no model call). Any allowlisted member,
// attributed by email — the themes model.
//   GET ?id=            → per-phrase stats, suggested phrases with their
//                         evidence, probable misses, the pool's coverage and
//                         the crew's ✓ / ✕ marks
//   POST {op:"preview", phrases | phrasesText, exclude?}
//                       → what the phrase set would catch (no write)
//   POST {op:"feedback", themeId, itemId, phrase, verdict: "yes"|"no"|null}
//   POST {op:"dismiss", themeId, term}       → never suggest this term again
//   POST {op:"add-phrase"|"remove-phrase"|"add-exclude"|"remove-exclude", themeId, phrase}
//                       → edit the theme, rebuild its series

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const [theme, feedback, pool] = await Promise.all([getTheme(id), listFeedback(id), getTuningPool()]);
  if (!theme) return NextResponse.json({ error: "Theme not found, or the store did not answer." }, { status: 404 });
  const now = Date.now();
  const fb = feedback ?? [];
  const rejected = new Set(fb.filter((f) => f.verdict === "no").map((f) => f.itemId));
  const marks: Record<string, ThemeVerdict> = {};
  for (const f of fb) marks[f.itemId] = f.verdict;
  if (!pool.answered) {
    return NextResponse.json({
      theme, pool: { answered: false, note: pool.note, items: 0, days: 0, byKind: {} },
      stats: [], suggest: null, marks, feedbackLive: feedback !== null,
    });
  }
  const coverage = coverageOf(pool.rows, now);
  return NextResponse.json({
    theme,
    pool: { answered: true, note: null, ...coverage },
    stats: phraseStats(theme, pool.rows, fb, now),
    suggest: suggestPhrases(theme, pool.rows, { rejected }),
    marks,
    feedbackLive: feedback !== null,
  });
}

const cleanPhrase = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const op = String(body.op ?? "");

  if (op === "preview") {
    const phrases = Array.isArray(body.phrases) ? body.phrases.map(cleanPhrase) : typeof body.phrasesText === "string" ? parsePhrasesText(body.phrasesText) : [];
    const exclude = normalizeExclusions(Array.isArray(body.exclude) ? body.exclude : typeof body.excludeText === "string" ? parsePhrasesText(body.excludeText) : []);
    const usable = phrases.filter((p) => p.length >= THEME_PHRASE_MIN && p.length <= THEME_PHRASE_MAX).slice(0, THEME_MAX_PHRASES);
    const pool = await getTuningPool(8_000);
    if (!pool.answered) return NextResponse.json({ answered: false, note: pool.note });
    return NextResponse.json({ answered: true, preview: previewPhrases(usable, exclude, pool.rows, Date.now()) });
  }

  const themeId = typeof body.themeId === "string" ? body.themeId : "";
  if (!themeId) return NextResponse.json({ error: "themeId is required" }, { status: 400 });

  if (op === "feedback") {
    const itemId = typeof body.itemId === "string" ? body.itemId.slice(0, 255) : "";
    if (!itemId) return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    const verdict = body.verdict === "yes" || body.verdict === "no" ? body.verdict : null;
    const ok = await setFeedback(themeId, itemId, verdict, cleanPhrase(body.phrase), email);
    if (!ok) return NextResponse.json({ error: "Could not save the mark — the store did not answer." }, { status: 503 });
    resetThemesCache();
    resetWarningCache();
    // On ✕, the exclusions that would have kept the item out (the matched
    // phrase with its neighbouring word) — offered, never applied.
    const text = typeof body.text === "string" ? body.text.slice(0, 2000) : "";
    return NextResponse.json({ ok: true, exclusions: verdict === "no" && text ? exclusionCandidates(text, cleanPhrase(body.phrase)) : [] });
  }

  if (op === "dismiss") {
    const term = cleanPhrase(body.term);
    if (!term) return NextResponse.json({ error: "term is required" }, { status: 400 });
    const ok = await addDismissed(themeId, term);
    if (!ok) return NextResponse.json({ error: "Could not save — the store did not answer." }, { status: 503 });
    return NextResponse.json({ ok: true });
  }

  if (op === "add-phrase" || op === "remove-phrase" || op === "add-exclude" || op === "remove-exclude") {
    const phrase = cleanPhrase(body.phrase);
    if (!phrase) return NextResponse.json({ error: "phrase is required" }, { status: 400 });
    const theme = await getTheme(themeId);
    if (!theme) return NextResponse.json({ error: "Theme not found, or the store did not answer." }, { status: 404 });
    const same = (a: string) => a.toLowerCase() === phrase.toLowerCase();
    let phrases = theme.phrases.slice();
    let exclude = (theme.exclude ?? []).slice();
    if (op === "add-phrase") {
      if (phrases.some(same)) return NextResponse.json({ theme, backfill: null });
      if (phrases.length >= THEME_MAX_PHRASES) return NextResponse.json({ error: `A theme holds ${THEME_MAX_PHRASES} phrases — drop one first.` }, { status: 422 });
      phrases.push(phrase);
    } else if (op === "remove-phrase") {
      phrases = phrases.filter((p) => !same(p));
    } else if (op === "add-exclude") {
      if (exclude.some(same)) return NextResponse.json({ theme, backfill: null });
      if (exclude.length >= THEME_MAX_PHRASES) return NextResponse.json({ error: `A theme holds ${THEME_MAX_PHRASES} exclusions — drop one first.` }, { status: 422 });
      exclude.push(phrase);
    } else {
      exclude = exclude.filter((p) => !same(p));
    }
    const err = validateThemeDraft({ name: theme.name, phrases });
    if (err) return NextResponse.json({ error: err }, { status: 422 });
    const saved: Theme | null = await upsertTheme(normalizeThemeDraft({ name: theme.name, phrases, boards: theme.boards, exclude }), email, theme.id);
    if (!saved) return NextResponse.json({ error: "Could not save the theme — the store did not answer." }, { status: 503 });
    resetWarningCache();
    const backfill = await backfillThemeSeries(saved);
    return NextResponse.json({ theme: saved, backfill });
  }

  return NextResponse.json({ error: "Unknown op" }, { status: 400 });
}
