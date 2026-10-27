import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { listThemes, upsertTheme, deleteTheme } from "@/lib/themeStore";
import { getThemeReads, resetThemesCache } from "@/lib/themesAssemble";
import { validateThemeDraft, normalizeThemeDraft, parsePhrasesText, THEME_MAX } from "@/lib/themes";

export const dynamic = "force-dynamic";

// Declared themes — a name and a few phrases, read against the operator's
// own sources (lib/themes). Shared and crew-maintained (any allowlisted
// member), attributed by email — the mission_lines model.
//   GET                → the register + the reads (202 pending on a cold start)
//   GET ?list=1        → the register only
//   POST {name, phrases | phrasesText, id?} → create / update one theme
//   DELETE ?id=        → remove a theme

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  if (url.searchParams.get("list") === "1") {
    const themes = await listThemes();
    if (themes === null) return NextResponse.json({ error: "Themes unavailable — the store did not answer.", unavailable: true }, { status: 503 });
    return NextResponse.json({ themes });
  }
  const body = await getThemeReads({ maxWaitMs: 8_000, force: url.searchParams.get("refresh") === "1" });
  if (body.pending) return NextResponse.json(body, { status: 202 });
  return NextResponse.json(body, { status: body.themes === null ? 503 : 200 });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const phrases = Array.isArray(body.phrases) ? body.phrases : typeof body.phrasesText === "string" ? parsePhrasesText(body.phrasesText) : [];
  const err = validateThemeDraft({ name: body.name, phrases });
  if (err) return NextResponse.json({ error: err }, { status: 422 });
  const id = typeof body.id === "string" ? body.id : undefined;
  if (!id) {
    const existing = await listThemes();
    if (existing === null) return NextResponse.json({ error: "Could not save the theme — the store did not answer." }, { status: 503 });
    if (existing.length >= THEME_MAX) return NextResponse.json({ error: `The register holds ${THEME_MAX} themes — remove one first.` }, { status: 422 });
  }
  const theme = await upsertTheme(normalizeThemeDraft({ name: body.name, phrases }), email, id);
  if (!theme) return NextResponse.json({ error: "Could not save the theme — the store did not answer." }, { status: 503 });
  resetThemesCache();
  return NextResponse.json({ theme });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteTheme(id);
  if (!ok) return NextResponse.json({ error: "Not found, or the store did not answer." }, { status: 409 });
  resetThemesCache();
  return NextResponse.json({ ok: true });
}
