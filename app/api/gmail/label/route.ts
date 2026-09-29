import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { applyLabel } from "@/lib/gmail";
import { COOKIE_NAME, decryptToken } from "@/lib/secondaryAuth";
import { labelForCategory } from "@/lib/familyLabels";
import { domainOf } from "@/lib/senderDiscovery";
import { trackSenders } from "@/lib/familyRosterOps";
import { SENDER_CATEGORIES } from "@/lib/familyProfile";
import type { ProposalCategory } from "@/lib/senderDiscovery";

export const dynamic = "force-dynamic";

// "File under Family" from the Email tab.
//
// POST { ids, account, category, senders?: string[] }
//   1. Applies the category's Gmail label (Family/School, Family/Bills, …;
//      created on first use) to the messages, on the right account.
//   2. OWNER ONLY, when `senders` (From headers) are given: tracks each
//      sender's domain in the matching roster bucket, so the Family tab reads
//      that sender from now on. This is what makes the label seamless — one
//      tap on an email both files it in Gmail and declares the sender.
// Nothing is read here: ids and From lines come from the client, which
// already holds them. Free-mail domains are skipped for tracking (that is a
// person, and a pattern for gmail.com would pull in everyone).

const VALID_ACCOUNTS = new Set(["primary", "secondary"]);
const MAX_IDS = 100;
const GENERIC = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com", "comcast.net", "att.net", "verizon.net"]);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { ids, account, category, senders } = body;

  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || ids.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9]{6,32}$/.test(id))) {
    return NextResponse.json({ error: "ids must be 1-100 Gmail message ids" }, { status: 400 });
  }
  if (typeof account !== "string" || !VALID_ACCOUNTS.has(account)) {
    return NextResponse.json({ error: "account must be 'primary' or 'secondary'" }, { status: 400 });
  }
  const cat = typeof category === "string" ? category : "";
  if (cat !== "biller" && !SENDER_CATEGORIES.includes(cat as never)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 422 });
  }
  const labelName = labelForCategory(cat as ProposalCategory);
  if (!labelName) return NextResponse.json({ error: "No label for that category" }, { status: 422 });

  let token = session.accessToken as string;
  if (account === "secondary") {
    const raw = (await cookies()).get(COOKIE_NAME)?.value;
    const payload = raw ? await decryptToken(raw) : null;
    if (!payload) return NextResponse.json({ error: "Secondary account not connected" }, { status: 401 });
    token = payload.access_token;
  }

  const labelled = await applyLabel(token, ids as string[], labelName).catch((e: unknown) => {
    throw new Error(e instanceof Error ? e.message : "Label failed");
  });

  // Track the senders — owner only (the roster is the owner's household).
  let tracked: { domain: string; added: boolean }[] = [];
  if (isOwner(email) && Array.isArray(senders)) {
    const domains = new Set<string>();
    for (const s of senders) {
      if (typeof s !== "string") continue;
      const d = domainOf(s);
      if (d && !GENERIC.has(d)) domains.add(d);
    }
    if (domains.size) {
      const res = await trackSenders([...domains].map((domain) => ({ domain, category: cat as ProposalCategory })));
      tracked = res.map((r) => ({ domain: r.domain, added: r.added }));
    }
  }

  return NextResponse.json({ ok: true, label: labelName, applied: labelled.applied, tracked });
}
