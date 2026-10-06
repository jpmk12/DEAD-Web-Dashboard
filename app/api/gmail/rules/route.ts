import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { listCorrections } from "@/lib/emailPrefs";
import { suggestSenderRules, correctionCounts, RULE_WINDOW_MS } from "@/lib/emailLearning";

export const dynamic = "force-dynamic";

// "How priority is decided" (REVIEW-2026-10 E3): the rules the triage reads
// and what the user's corrections have taught — PURE joins over the prefs
// and email_prefs, no model call, no fetch. Accepting a suggested rule and
// dismissing one both go through /api/user-prefs/append (vipSenders /
// muteSenders / dismissedVipSuggestions with a `rule:` key), so this route
// is read-only.

const RULES_TEXT = [
  "High: addressed to you, needs a decision or action, time-sensitive, from a real person or an important institution.",
  "Medium: informational but relevant, may need a reply, professional newsletters or subscribed sources.",
  "Low: automated notifications, marketing, promotional, mass mailing, no action needed.",
  "A priority topic or watchlist term in a substantive email biases High; a deprioritised topic biases Low.",
  "Your role defines what counts as an important institution.",
  "VIP senders are always High and muted senders always Low — before the model is asked.",
  "Your own call on an email wins over all of the above; recent corrections are shown to the model as examples.",
];

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userEmail = normEmail(session.user?.email);
  const now = Date.now();

  const [prefs, corrections] = await Promise.all([
    getUserPrefs(userEmail).catch(() => null),
    listCorrections(userEmail, now - RULE_WINDOW_MS).catch(() => []),
  ]);
  const vip = prefs?.vipSenders ?? [];
  const mute = prefs?.muteSenders ?? [];
  const dismissed = prefs?.dismissedVipSuggestions ?? [];

  return NextResponse.json({
    role: prefs?.role ?? "",
    priorityTopics: prefs?.priorityTopics?.length ?? 0,
    deprioritizeTopics: prefs?.deprioritizeTopics?.length ?? 0,
    watchlist: prefs?.watchlist?.length ?? 0,
    vip: vip.length,
    muted: mute.length,
    corrections: correctionCounts(corrections, now),
    suggestions: suggestSenderRules(corrections, { vip, mute, dismissed, now }),
    rules: RULES_TEXT,
  });
}
