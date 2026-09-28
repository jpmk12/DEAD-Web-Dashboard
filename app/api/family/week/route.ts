import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getFamilyProfile } from "@/lib/familyStore";
import { listDeadlines } from "@/lib/familyDeadlineStore";
import { getSightings } from "@/lib/householdStore";
import { listTrips } from "@/lib/trips";
import { toView, sortDeadlines, rollup, todayYmd } from "@/lib/familyDeadlines";
import { findTripConflicts, conflictLine, type DatedItem } from "@/lib/familyTripConflict";
import { familyDates } from "@/lib/familyCalendar";

export const dynamic = "force-dynamic";

// The family week ahead, for the Morning Brief.
//
// DETERMINISTIC AND CHEAP BY DESIGN. The brief opens on every device, every
// morning; this route is fetched live at that moment (like the SITREP LEDs and
// keep-in-touch), so it reads only what is already stored — tracked deadlines,
// trips, bill sightings, declared documents and expectations. No Gmail read,
// no model call: the full Family digest costs a Gmail query plus a Sonnet
// call, and "nothing pays on page load" applies to the brief too.
//
// What that leaves out, honestly: account jeopardy and expected-document
// ARRIVAL both need the mail scan, so they are not here. The block says what it
// covers rather than implying the household is clear.

const WEEK = 7;

export async function GET() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(email)) return NextResponse.json({ empty: true });   // crew: quietly nothing

  const [profile, stored, trips] = await Promise.all([
    getFamilyProfile().catch(() => null),
    listDeadlines(email).catch(() => []),
    listTrips(email).catch(() => []),
  ]);
  const sightings = profile ? await getSightings(profile.billers.map((b) => b.id)).catch(() => []) : [];

  const today = todayYmd();
  const views = sortDeadlines(stored.map((d) => toView(d, today)));
  const open = views.filter((v) => v.phase !== "done" && v.phase !== "dismissed");
  const lapsed = open.filter((v) => v.phase === "lapsed");
  const dueSoon = open.filter((v) => v.phase === "due-soon");
  const undated = open.filter((v) => v.phase === "undated").length;

  const dated: DatedItem[] = open.map((v) => ({
    id: v.id, kind: "deadline" as const, title: v.title, dateISO: v.dueISO, personId: v.personId,
  }));
  const conflicts = findTripConflicts(dated, trips.map((t) => ({ id: t.id, label: t.label, startDate: t.startDate, endDate: t.endDate })));

  // Bills / documents / expected-by within the week, from the same list the
  // Calendar tab shows. Deadlines are excluded here (already covered above).
  const dates = familyDates({
    deadlines: [],
    billers: profile?.billers ?? [],
    sightings: sightings.map((s) => ({ billerId: s.billerId, seenISO: s.seenISO, dueISO: s.dueISO ?? null })),
    documents: profile?.documents ?? [],
    expectations: profile?.expectations ?? [],
  }, today, { lookbackDays: 0, horizonDays: WEEK });

  const manualBills = dates.filter((d) => d.kind === "bill" && d.note !== "autopay");
  const docs = dates.filter((d) => d.kind === "document" || d.kind === "document-expiry");
  const expected = dates.filter((d) => d.kind === "expected");

  const nothing = lapsed.length + dueSoon.length + conflicts.length + manualBills.length + docs.length + expected.length === 0;

  return NextResponse.json({
    empty: nothing && undated === 0,
    today,
    rollupLine: rollup(views).line,
    lapsed: lapsed.slice(0, 5).map((v) => ({ id: v.id, title: v.title, dueISO: v.dueISO, daysUntil: v.daysUntil, personId: v.personId })),
    dueSoon: dueSoon.slice(0, 6).map((v) => ({ id: v.id, title: v.title, dueISO: v.dueISO, daysUntil: v.daysUntil, personId: v.personId })),
    undated,
    conflicts: conflicts.slice(0, 4).map((c) => ({ title: c.item.title, reason: c.reason, severity: c.severity })),
    conflictLine: conflictLine(conflicts),
    manualBills: manualBills.slice(0, 5),
    docs: docs.slice(0, 4),
    expected: expected.slice(0, 4),
    covers: "tracked deadlines, trips, bill due dates, document expiries and expected-by dates — not the mail scan",
  });
}
