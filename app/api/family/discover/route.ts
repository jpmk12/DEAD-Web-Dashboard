import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getFamilyProfile, saveFamilyProfile } from "@/lib/familyStore";
import { getUserPrefs, saveUserPrefs } from "@/lib/userPrefs";
import { fetchMessageHeaders } from "@/lib/gmail";
import { discoverSenders, discoveryQuery, dismissKey, type ProposalCategory } from "@/lib/senderDiscovery";
import { SENDER_CATEGORIES, type SenderCategory } from "@/lib/familyProfile";

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

// PUT { domain, label?, category } — ACCEPT a proposal: write it straight into
// the roster in the right bucket.
//
// This is the point of the feature. Before it, discovery could only propose and
// dismiss; accepting meant opening the roster editor and retyping the domain by
// hand, which is exactly the heavy lifting the scan was supposed to remove.
//
// The CATEGORY arrives from the client because the row lets the user override
// the classifier's guess. It is re-validated here — a guard that exists only in
// the UI is not a guard, the same rule as /api/family/event's anchored-date
// check and the decision log's validateDraft.
export async function PUT(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwner(email)) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const body = await req.json().catch(() => null) as
    { domain?: unknown; label?: unknown; category?: unknown } | null;

  const domain = typeof body?.domain === "string" ? body.domain.trim().toLowerCase() : "";
  // Same shape the roster's own sanitizer accepts, checked before we write.
  if (!domain || !/^[a-z0-9@._+-]+$/.test(domain) || !domain.includes(".")) {
    return NextResponse.json({ error: "A valid sender domain is required" }, { status: 422 });
  }
  const raw = typeof body?.category === "string" ? body.category : "";
  const isBiller = raw === "biller";
  if (!isBiller && !SENDER_CATEGORIES.includes(raw as SenderCategory)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 422 });
  }
  const category = raw as ProposalCategory;
  const label = typeof body?.label === "string" && body.label.trim()
    ? body.label.trim().slice(0, 60)
    : domain;

  const profile = await getFamilyProfile();

  // Idempotent: accepting the same proposal twice must not create a duplicate
  // pattern, which would double every match downstream.
  const already = isBiller
    ? profile.billers.some((b) => b.pattern.toLowerCase() === domain)
    : profile.senders.some((x) => x.pattern.toLowerCase() === domain);
  if (already) return NextResponse.json({ ok: true, alreadyPresent: true });

  const next = isBiller
    ? {
        ...profile,
        billers: [...profile.billers, {
          id: `b-${domain.replace(/[^a-z0-9]+/g, "-")}`,
          pattern: domain,
          label,
          // Cadence is DECLARED, and the scan cannot know it — three months of
          // history cannot tell "quarterly" from "stopped", which is the whole
          // point of the silence watch. So a newly accepted biller starts
          // `irregular` (never accused of silence) and the Household pane's
          // cadence-drift row will tell the user what it actually observes.
          cadence: "irregular" as const,
          autopay: false,
        }],
      }
    : {
        ...profile,
        senders: [...profile.senders, {
          id: `s-${domain.replace(/[^a-z0-9]+/g, "-")}`,
          pattern: domain,
          label,
          category: category as SenderCategory,
        }],
      };

  const saved = await saveFamilyProfile(next);
  return NextResponse.json({
    ok: true,
    added: isBiller ? "biller" : category,
    // So the client can confirm the write landed rather than assuming it.
    counts: { senders: saved.senders.length, billers: saved.billers.length },
  });
}
