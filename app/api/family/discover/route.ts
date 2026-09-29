import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getFamilyProfile, saveFamilyProfile } from "@/lib/familyStore";
import { getUserPrefs, saveUserPrefs } from "@/lib/userPrefs";
import { fetchMessageHeaders, listUserLabels } from "@/lib/gmail";
import { discoverSenders, discoveryQuery, labelQuery, dismissKey, type ProposalCategory } from "@/lib/senderDiscovery";
import { SENDER_CATEGORIES, slug, type SenderCategory } from "@/lib/familyProfile";
import { resetFamilyCache } from "@/lib/family";
import { resetHouseholdCache } from "@/lib/household";

export const dynamic = "force-dynamic";

// Sender discovery — the ONE search in this app that looks outside the declared
// roster. Its boundaries are the feature:
//
//   POST, never GET, for the scan. Nothing here runs on a page load, a poll or
//   a digest. The user presses Scan — or, since the roster's `autoDiscover`
//   flag, the CLIENT presses it for them about weekly when the tab is opened.
//   Either way it is a deliberate POST from the user's own session; a
//   prefetch or a crawler cannot trigger it.
//
//   Headers only. It calls fetchMessageHeaders, which uses Gmail's
//   format:"metadata" with an explicit header allow-list, so the API never
//   returns a body. The guarantee is in the request shape, not in a comment.
//
//   Bounded. `discoveryQuery` is subject-shaped (statement / invoice / amount
//   due / …), window-capped, and excludes everything already declared — a
//   search for bills, not a sweep of the mailbox. maxResults is capped too.
//   `labelQuery` (POST {label}) is the one alternative shape: the user's OWN
//   Gmail label, which is filing they already did — the label is the evidence.
//
//   Nothing is stored but the user's answer. A proposal is not a biller;
//   accepting one is an ordinary roster edit the user makes themselves.
//   Declining writes a permanent dismissal and nothing else.
//
// Owner-only, like the rest of the Family tab and more so: this one reads
// senders the user never named.

const SCAN_DAYS = 120;
const MAX_MESSAGES = 60;
const LABEL_DAYS = 365;
const LABEL_MAX = 100;

async function owner() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!isOwner(email)) return { error: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  return { email, token: session.accessToken as string };
}

// GET ?labels=1 — the user's own Gmail labels (names only), for "seed from label".
export async function GET(req: Request) {
  const o = await owner();
  if ("error" in o) return o.error;
  if (!new URL(req.url).searchParams.get("labels")) return NextResponse.json({ error: "Use POST to scan" }, { status: 405 });
  const labels = await listUserLabels(o.token).catch(() => []);
  return NextResponse.json({ labels: labels.map((l) => l.name) });
}

// POST {}        → the subject-shaped scan
// POST {label}   → seed from one Gmail label: every undeclared sender in it
export async function POST(req: Request) {
  const o = await owner();
  if ("error" in o) return o.error;

  const profile = await getFamilyProfile().catch(() => null);
  if (!profile) return NextResponse.json({ error: "No roster yet" }, { status: 400 });

  // Everything already declared, so the scan never re-proposes it.
  const declared = [
    ...profile.senders.map((s) => s.pattern),
    ...profile.billers.map((b) => b.pattern),
  ].filter(Boolean);

  const prefs = await getUserPrefs(o.email).catch(() => null);
  const dismissed = prefs?.dismissedWatchSuggestions ?? [];

  const body = await req.json().catch(() => null) as { label?: unknown } | null;
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) : "";

  if (label) {
    const q = labelQuery(label, declared, LABEL_DAYS);
    const headers = await fetchMessageHeaders(o.token, q, LABEL_MAX).catch(() => []);
    const candidates = discoverSenders(
      headers.map((h) => ({ from: h.from, subject: h.subject, date: h.date })),
      declared, dismissed,
      // One sighting is enough and a category-less sender is still proposed:
      // the user's own filing is the evidence. Category is a guess the row
      // lets them change — "other" when nothing in the subjects says more.
      { minSightings: 1, max: 25, fallbackCategory: "other", fallbackReason: `in your “${label}” label` },
    );
    return NextResponse.json({
      candidates, seededFrom: label,
      scanned: { messages: headers.length, windowDays: LABEL_DAYS, query: q },
    });
  }

  const q = discoveryQuery(declared, SCAN_DAYS);
  const headers = await fetchMessageHeaders(o.token, q, MAX_MESSAGES).catch(() => []);
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

// DELETE ?domain=…  — never propose this domain again.
// DELETE ?key=…     — never propose this mention/document again (mention:… / doc:…).
export async function DELETE(req: Request) {
  const o = await owner();
  if ("error" in o) return o.error;

  const url = new URL(req.url);
  const domain = url.searchParams.get("domain")?.trim().toLowerCase();
  const rawKey = url.searchParams.get("key")?.trim().toLowerCase();
  const key = domain ? dismissKey(domain) : rawKey && /^(mention|doc):[a-z0-9-]{1,32}$/.test(rawKey) ? rawKey : "";
  if (!key) return NextResponse.json({ error: "domain or a valid key is required" }, { status: 400 });

  const prefs = await getUserPrefs(o.email);
  const dismissed = [...(prefs.dismissedWatchSuggestions ?? [])];
  if (!dismissed.includes(key)) dismissed.push(key);
  await saveUserPrefs({ ...prefs, dismissedWatchSuggestions: dismissed });
  // The digests filter proposals by dismissal, and they are 15-min cached.
  resetFamilyCache(); resetHouseholdCache();

  return NextResponse.json({ ok: true });
}

// PUT { domain, label?, category }                          — ACCEPT a sender proposal
// PUT { kind: "document", label, expiresISO, leadDays? }    — ACCEPT a document proposal
//
// This is the point of the feature. Before it, discovery could only propose and
// dismiss; accepting meant opening the roster editor and retyping by hand,
// which is exactly the heavy lifting the scan was supposed to remove.
//
// The CATEGORY arrives from the client because the row lets the user override
// the classifier's guess. It is re-validated here — a guard that exists only in
// the UI is not a guard, the same rule as /api/family/event's anchored-date
// check and the decision log's validateDraft.
export async function PUT(req: Request) {
  const o = await owner();
  if ("error" in o) return o.error;

  const body = await req.json().catch(() => null) as
    { kind?: unknown; domain?: unknown; label?: unknown; category?: unknown; expiresISO?: unknown; leadDays?: unknown } | null;

  const profile = await getFamilyProfile();

  if (body?.kind === "document") {
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
    const expiresISO = typeof body.expiresISO === "string" ? body.expiresISO.trim() : "";
    if (label.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(expiresISO) || !Number.isFinite(Date.parse(`${expiresISO}T12:00:00Z`))) {
      return NextResponse.json({ error: "A document needs a label and an explicit yyyy-mm-dd expiry" }, { status: 422 });
    }
    const lead = Number(body.leadDays);
    const id = `d-${slug(label)}`;
    if (profile.documents.some((d) => d.id === id || slug(d.label) === slug(label))) {
      return NextResponse.json({ ok: true, alreadyPresent: true });
    }
    const saved = await saveFamilyProfile({
      ...profile,
      documents: [...profile.documents, {
        id, label, expiresISO,
        ...(Number.isFinite(lead) && lead > 0 ? { leadDays: Math.min(730, Math.round(lead)) } : {}),
      }],
    });
    resetHouseholdCache(); resetFamilyCache();
    return NextResponse.json({ ok: true, added: "document", counts: { documents: saved.documents.length } });
  }

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
          // Cadence is learned from the history (`auto`): the scan cannot
          // know it, and the silence watch never accuses a biller it has
          // only just met. Once four statements agree on a rhythm, the
          // Household pane names it and the watch arms itself.
          cadence: "auto" as const,
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
  resetFamilyCache(); resetHouseholdCache();
  return NextResponse.json({
    ok: true,
    added: isBiller ? "biller" : category,
    // So the client can confirm the write landed rather than assuming it.
    counts: { senders: saved.senders.length, billers: saved.billers.length },
  });
}
