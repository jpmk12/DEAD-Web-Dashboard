import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { listThemes, upsertTheme, addProposalDismissed } from "@/lib/themeStore";
import { getThemeProposals, resetThemeProposalsCache } from "@/lib/themeProposalsAssemble";
import { backfillThemeSeries, resetThemesCache } from "@/lib/themesAssemble";
import { normalizeThemeDraft, validateThemeDraft, THEME_MAX } from "@/lib/themes";
import { resetWarningCache } from "@/lib/warningAssess";

export const dynamic = "force-dynamic";

// Proposed themes — from the declaration, checked against the stored own
// sources (lib/themeProposals: PURE, no model call). Any allowlisted member,
// attributed — the themes model.
//   GET                          → the proposals with their evidence, and
//                                  why each other seed was left out
//   POST {op:"track", key}       → declare the proposal as a theme (the same
//                                  write as ＋ Theme) and rebuild its history
//   POST {op:"dismiss", key}     → never propose it again (shared, permanent)

const KEY_RX = /^(?:seed|narrow):[^\s][\s\S]{0,185}$/;

export async function GET() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await getThemeProposals(email);
  return NextResponse.json(body);
}

export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const key = typeof body.key === "string" ? body.key : "";
  if (!KEY_RX.test(key)) return NextResponse.json({ error: "key is required" }, { status: 400 });

  if (body.op === "dismiss") {
    const ok = await addProposalDismissed(key, email);
    if (!ok) return NextResponse.json({ error: "Could not save — the store did not answer." }, { status: 503 });
    resetThemeProposalsCache();
    return NextResponse.json({ ok: true });
  }

  if (body.op === "track") {
    const current = await getThemeProposals(email);
    const p = current.proposals.find((x) => x.key === key);
    if (!p) return NextResponse.json({ error: "That proposal is no longer on offer — the list has changed. Reload it." }, { status: 409 });
    const existing = await listThemes();
    if (existing === null) return NextResponse.json({ error: "Could not save the theme — the store did not answer." }, { status: 503 });
    if (existing.length >= THEME_MAX) return NextResponse.json({ error: `The register holds ${THEME_MAX} themes — remove one first.` }, { status: 422 });
    const draft = normalizeThemeDraft({ name: p.name, phrases: p.phrases });
    const err = validateThemeDraft(draft);
    if (err) return NextResponse.json({ error: err }, { status: 422 });
    const theme = await upsertTheme(draft, email);
    if (!theme) return NextResponse.json({ error: "Could not save the theme — the store did not answer." }, { status: 503 });
    resetThemesCache();
    resetWarningCache();
    resetThemeProposalsCache();
    const backfill = await backfillThemeSeries(theme);
    return NextResponse.json({ theme, backfill });
  }

  return NextResponse.json({ error: "Unknown op" }, { status: 400 });
}
