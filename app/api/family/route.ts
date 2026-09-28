import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleFamilyDigest } from "@/lib/family";
import { listDeadlines, upsertDeadlines, setDeadlineState, pruneHandledDeadlines } from "@/lib/familyDeadlineStore";
import { mergeDeadlines, toView, sortDeadlines, rollup, todayYmd } from "@/lib/familyDeadlines";
import type { DeadlineState } from "@/lib/familyDeadlines";

export const dynamic = "force-dynamic";

// The Family digest: school + household mail read once and reported as
// deadlines, per-person summaries, and dated items awaiting confirmation.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // OWNER ONLY. The digest embeds the roster — the user's children's names,
  // grades and schools — and would otherwise run the owner's roster as a
  // search against a crew member's own mailbox. Neither is acceptable.
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const email = normEmail(session.user?.email);
  const prefs = await getUserPrefs(email).catch(() => null);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const digest = await assembleFamilyDigest(session.accessToken as string, prefs, email, { refresh });

  // Fold the live extraction into the persisted record. Before this, the
  // 14-day Gmail window WAS the memory: a form due in six weeks and mentioned
  // once disappeared from the board about a fortnight later while still being
  // due. The merge never resets a state the user set, and the stored rows —
  // not the extraction — are what the pane renders.
  const stored = await listDeadlines(email);
  const { upserts } = mergeDeadlines(stored, digest.deadlines);
  await upsertDeadlines(email, upserts);
  pruneHandledDeadlines(email).catch(() => {});

  const byId = new Map(stored.map((d) => [d.id, d]));
  for (const u of upserts) byId.set(u.id, u);
  const today = todayYmd();
  const tracked = sortDeadlines([...byId.values()].map((d) => toView(d, today)));

  return NextResponse.json({ ...digest, tracked, rollup: rollup(tracked) });
}

// PATCH { id, state } — record how the user handled a deadline. This is the
// only write; the extractor never sets state.
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const body = await req.json().catch(() => null) as { id?: unknown; state?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const state = body?.state === "done" || body?.state === "dismissed" || body?.state === "open"
    ? (body.state as DeadlineState) : null;
  if (!id || !state) return NextResponse.json({ error: "id and a valid state are required" }, { status: 400 });

  const ok = await setDeadlineState(normEmail(session.user?.email), id, state);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
