import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { assembleFamilyDigest, countNewFamilyMail } from "@/lib/family";
import { listDeadlines, upsertDeadlines, setDeadlineState, pruneHandledDeadlines, snoozeDeadline, setDeadlineDue } from "@/lib/familyDeadlineStore";
import { mergeDeadlines, toView, sortDeadlines, rollup, todayYmd } from "@/lib/familyDeadlines";
import type { DeadlineState } from "@/lib/familyDeadlines";
import { listTrips } from "@/lib/trips";
import { awayList } from "@/lib/familyAway";
import type { DatedItem } from "@/lib/familyTripConflict";
import { getAllLastSeen, bumpLastSeen } from "@/lib/surfaceState";

export const dynamic = "force-dynamic";

// The Family digest: school + household mail read once and reported as
// deadlines, per-person running briefs, and dated items awaiting confirmation.
//   GET            → the digest + tracked + rollup + away + lastVisitMs
//   GET ?refresh=1 → force a re-read (the ↻ button)
//   GET ?check=1   → { newMail } — one Gmail list call, no bodies, no model;
//                    the tab polls this while open (REVIEW-2026-10 F4)
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // OWNER ONLY. The digest embeds the roster — the user's children's names,
  // grades and schools — and would otherwise run the owner's roster as a
  // search against a crew member's own mailbox. Neither is acceptable.
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const email = normEmail(session.user?.email);
  const url = new URL(req.url);

  if (url.searchParams.get("check") === "1") {
    const r = await countNewFamilyMail(session.accessToken as string, email).catch(() => ({ newMail: 0, known: false }));
    return NextResponse.json({ ...r, checkedAt: Date.now() });
  }

  const prefs = await getUserPrefs(email).catch(() => null);
  const refresh = url.searchParams.get("refresh") === "1";
  const [digest, lastSeen] = await Promise.all([
    assembleFamilyDigest(session.accessToken as string, prefs, email, { refresh }),
    getAllLastSeen(email).catch(() => null),
  ]);
  const lastVisitMs = lastSeen?.family ?? 0;

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

  // "While you are away" — ONE trip (current, else next), what has happened
  // since you left and what is still ahead. Past trips never match.
  const trips = await listTrips(email).catch(() => []);
  const dated: DatedItem[] = [
    ...tracked.map((d) => ({
      id: d.id, kind: "deadline" as const, title: d.title, dateISO: d.dueISO,
      personId: d.personId, handled: d.phase === "done" || d.phase === "dismissed",
    })),
    // Only anchored events — `needsConfirm` means the date is the model's guess,
    // and a conflict asserted from a guess is worse than none.
    ...(digest.events ?? [])
      .filter((e) => !e.needsConfirm && e.startISO)
      .map((e, i) => ({
        id: `ev-${i}`, kind: "event" as const, title: e.title,
        dateISO: (e.startISO ?? "").slice(0, 10), personId: e.personId ?? null,
      })),
  ];
  const away = awayList(dated, trips.map((t) => ({ id: t.id, label: t.label, startDate: t.startDate, endDate: t.endDate })), today);

  // The end of the current or next trip, so "snooze until I'm back" is a real
  // date rather than a guess. Null when no trip is ahead.
  const nextTripEnd = trips
    .filter((t) => t.endDate >= today)
    .map((t) => ({ end: t.endDate, label: t.label }))
    .sort((a, b) => a.end.localeCompare(b.end))[0] ?? null;

  // This visit becomes the next baseline for "new since your last visit" —
  // bumped AFTER the read, and only on a plain open (a poll's refresh must
  // not erase the markers mid-session). Same mechanism as the OE delta.
  const silent = url.searchParams.get("silent") === "1";
  if (!refresh && !silent) bumpLastSeen(email, "family").catch(() => {});

  return NextResponse.json({
    ...digest, tracked, rollup: rollup(tracked), away, nextTripEnd, lastVisitMs,
  });
}

// PATCH { id, state }        — record how the user handled a deadline
// PATCH { id, snoozeUntil }  — defer it ("not now"; null clears)
// PATCH { id, dueIso }       — the user sets (yyyy-mm-dd) or clears (null) the
//                              date; an extraction never overwrites it after
//                              this (REVIEW-2026-10 F3). The extractor never
//                              sets any of these.
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(session.user?.email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const email = normEmail(session.user?.email);

  const body = await req.json().catch(() => null) as { id?: unknown; state?: unknown; snoozeUntil?: unknown; dueIso?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";

  if (body && "dueIso" in body) {
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const raw = body.dueIso;
    let due: string | null = null;
    if (raw !== null) {
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(`${raw}T00:00:00Z`))) {
        return NextResponse.json({ error: "dueIso must be yyyy-mm-dd or null" }, { status: 422 });
      }
      due = raw;
    }
    const ok = await setDeadlineDue(email, id, due);
    if (!ok) return NextResponse.json({ error: "Not found, or not open" }, { status: 404 });
    return NextResponse.json({ ok: true, dueIso: due });
  }

  if (body && "snoozeUntil" in body) {
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const raw = body.snoozeUntil;
    let until: string | null = null;
    if (raw !== null) {
      // Validated here, not just in the UI: a past or malformed date would
      // either do nothing forever or hide the row with no end.
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return NextResponse.json({ error: "snoozeUntil must be yyyy-mm-dd or null" }, { status: 422 });
      }
      if (raw <= todayYmd()) return NextResponse.json({ error: "Snooze date must be in the future" }, { status: 422 });
      until = raw;
    }
    const ok = await snoozeDeadline(email, id, until);
    if (!ok) return NextResponse.json({ error: "Not found, or not open" }, { status: 404 });
    return NextResponse.json({ ok: true, snoozedUntil: until });
  }

  const state = body?.state === "done" || body?.state === "dismissed" || body?.state === "open"
    ? (body.state as DeadlineState) : null;
  if (!id || !state) return NextResponse.json({ error: "id and a valid state are required" }, { status: 400 });

  const ok = await setDeadlineState(email, id, state);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
