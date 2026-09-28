import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { getOeSnapshotFor } from "@/lib/oeContext";
import { listOpenDecisions } from "@/lib/decisionStore";

export const dynamic = "force-dynamic";

// Inputs for the one-page OE brief (lib/oeBriefExport.ts renders it on the
// client — the file is built in the browser and downloaded, so nothing is
// stored server-side). The snapshot is the same one the assistant reads;
// here it may WAIT longer for a cold gather, because an export is a
// deliberate act, not a chat turn. Reading does not bump the user's
// last-seen: exporting is not looking.
export async function GET() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [snapshot, openDecisions, prefs] = await Promise.all([
    getOeSnapshotFor(email, 12_000),
    listOpenDecisions(40),
    getUserPrefs(email).catch(() => null),
  ]);
  if (!snapshot) return NextResponse.json({ error: "The OE snapshot is not ready yet — try again in a moment." }, { status: 503 });

  return NextResponse.json({
    snapshot,
    openDecisions,
    preparedBy: email,
    missionSummary: prefs?.missionSummary ?? null,
  });
}
