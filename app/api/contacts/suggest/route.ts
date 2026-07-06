import { NextResponse } from "next/server";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { getUserPrefs } from "@/lib/userPrefs";
import { getVipSuggestions } from "@/lib/replySignals";
import { listContacts } from "@/lib/contacts";

export const dynamic = "force-dynamic";

// People worth adding to Keep in Touch, drawn from the two signals the app
// already has: your explicit VIP senders, and the reply-pattern scan (folks you
// reply to often). Excludes anyone already on the roster. Lazy — only called
// when the user opens the suggestions section, since the reply scan hits Gmail.

interface Suggestion { name: string; email: string; reason: string }

// "john.smith@x.com" → "John Smith" (best-effort; the user can edit on add).
function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? email).replace(/\+.*$/, "");
  const pretty = local.split(/[._-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").trim();
  return (pretty || email).slice(0, 80);
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ suggestions: [] }, { status: 401 });

  const primaryEmail = (session as { user?: { email?: string } }).user?.email ?? "";
  const [prefs, contacts] = await Promise.all([
    getUserPrefs().catch(() => null),
    listContacts(normEmail(session.user?.email)).catch(() => []),
  ]);

  // Already on the roster — don't re-suggest.
  const onRoster = new Set(contacts.map((c) => (c.email ?? "").trim().toLowerCase()).filter(Boolean));
  // Explicit VIP entries that are full emails (skip bare-domain rules).
  const vipEmails = new Set((prefs?.vipSenders ?? [])
    .map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@") && !s.startsWith("@")));

  // Reply-pattern scan — don't exclude VIPs here (we want them surfaced), only
  // muted/dismissed senders.
  const exclude = new Set<string>();
  for (const s of prefs?.muteSenders ?? []) exclude.add(s.trim().toLowerCase());
  for (const s of prefs?.dismissedVipSuggestions ?? []) exclude.add(s.trim().toLowerCase());

  let replyPeople: { email: string; count: number }[] = [];
  try {
    replyPeople = (await getVipSuggestions(session.accessToken as string, primaryEmail, exclude))
      .map((s) => ({ email: s.email.toLowerCase(), count: s.count }));
  } catch { /* Gmail scan best-effort */ }

  const seen = new Set<string>();
  const out: Suggestion[] = [];
  const push = (email: string, reason: string) => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes("@") || seen.has(e) || onRoster.has(e)) return;
    seen.add(e);
    out.push({ name: nameFromEmail(e), email: e, reason });
  };

  // Reply-pattern first (carries a frequency signal), VIPs that weren't already
  // surfaced second.
  for (const p of replyPeople) push(p.email, vipEmails.has(p.email) ? "VIP · you reply often" : `you reply often (${p.count}×)`);
  for (const v of vipEmails) push(v, "VIP");

  return NextResponse.json({ suggestions: out.slice(0, 12) });
}
