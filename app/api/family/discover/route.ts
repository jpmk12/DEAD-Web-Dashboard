import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getFamilyProfile } from "@/lib/familyStore";
import { getUserPrefs, saveUserPrefs } from "@/lib/userPrefs";
import { fetchMessageHeaders } from "@/lib/gmail";
import { discoverSenders, discoveryQuery, dismissKey } from "@/lib/senderDiscovery";

export const dynamic = "force-dynamic";

// Sender discovery — the ONE search in this app that looks outside the declared
// roster. Its boundaries are the feature:
//
//   POST, never GET. Nothing here runs on a page load, a poll or a digest. The
//   user presses a button. A background scan of unnamed senders is a different
//   product from the one they agreed to, and making it a POST means a prefetch
//   or a crawler cannot trigger it.
//
//   Headers only. It calls fetchMessageHeaders, which uses Gmail's
//   format:"metadata" with an explicit header allow-list, so the API never
//   returns a body. The guarantee is in the request shape, not in a comment.
//
//   Bounded. `discoveryQuery` is subject-shaped (statement / invoice / amount
//   due / …), window-capped, and excludes everything already declared — a
//   search for bills, not a sweep of the mailbox. maxResults is capped too.
//
//   Nothing is stored but the user's answer. A proposal is not a biller;
//   accepting one is an ordinary roster edit the user makes themselves.
//   Declining writes a permanent dismissal and nothing else.
//
// Owner-only, like the rest of the Family tab and more so: this one reads
// senders the user never named.

const SCAN_DAYS = 120;
const MAX_MESSAGES = 60;

export async function POST() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwner(email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const profile = await getFamilyProfile().catch(() => null);
  if (!profile) return NextResponse.json({ error: "No roster yet" }, { status: 400 });

  // Everything already declared, so the scan never re-proposes it.
  const declared = [
    ...profile.senders.map((s) => s.pattern),
    ...profile.billers.map((b) => b.pattern),
  ].filter(Boolean);

  const prefs = await getUserPrefs(email).catch(() => null);
  const dismissed = prefs?.dismissedWatchSuggestions ?? [];

  const q = discoveryQuery(declared, SCAN_DAYS);
  const headers = await fetchMessageHeaders(session.accessToken as string, q, MAX_MESSAGES)
    .catch(() => []);

  const candidates = discoverSenders(
    headers.map((h) => ({ from: h.from, subject: h.subject, date: h.date })),
    declared,
    dismissed,
  );

  return NextResponse.json({
    candidates,
    // So an empty result reads as "nothing found in this window", never as a
    // claim that no undeclared biller exists.
    scanned: { messages: headers.length, windowDays: SCAN_DAYS, query: q },
  });
}

// DELETE ?domain=… — never propose this domain again.
export async function DELETE(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwner(email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const domain = new URL(req.url).searchParams.get("domain")?.trim().toLowerCase();
  if (!domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });

  const prefs = await getUserPrefs(email);
  const dismissed = [...(prefs.dismissedWatchSuggestions ?? [])];
  const key = dismissKey(domain);
  if (!dismissed.includes(key)) dismissed.push(key);
  await saveUserPrefs({ ...prefs, dismissedWatchSuggestions: dismissed });

  return NextResponse.json({ ok: true });
}
