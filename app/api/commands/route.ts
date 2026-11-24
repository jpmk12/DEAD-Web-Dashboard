import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getCommandBoardBounded } from "@/lib/commandsAssemble";

export const dynamic = "force-dynamic";

// The OSINT command board — one row per combatant command, the ranked
// primer, and the per-command detail (boards → countries → airfields).
// GET ?since=<ms>  — anchor the "since your last look" delta on a given
// look (the client passes back the first response's `sinceMs` on its polls
// so the delta does not vanish once the tab bumps its own last-seen).
//
// Bounded (REVIEW-2026-10 §6 / the latency rule): past ~2.5 s a cold
// assembly answers the previous picture flagged `pending`, else the QUICK
// tier (`partial`: your airfields + their SITREP summaries — enough to open a
// SITREP), and the board polls every 5 s until the whole picture lands. Nothing here calls a
// model; the AI read is /api/commands/read, on tap.

export async function GET(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const sinceRaw = Number(url.searchParams.get("since"));
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : undefined;
  const body = await getCommandBoardBounded(email, { since });
  return NextResponse.json({ ...body, canEdit: isOwner(email) }, { status: body.pending ? 202 : 200 });
}
