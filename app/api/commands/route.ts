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
// Bounded (REVIEW-2026-10 §6 / the latency rule): a cold assembly answers
// `pending: true` within 8 s and the board polls. Nothing here calls a
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
