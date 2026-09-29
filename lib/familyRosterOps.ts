// Server-only roster writes shared by every "track this sender" door: the
// discovery PUT, the proposals card, and the Email tab's "file under Family".
// One place decides the row shape so a biller always starts `auto` and a
// duplicate pattern is never written twice.

import { getFamilyProfile, saveFamilyProfile } from "./familyStore";
import { SENDER_CATEGORIES, type FamilyProfile, type SenderCategory } from "./familyProfile";
import type { ProposalCategory } from "./senderDiscovery";
import { resetFamilyCache } from "./family";
import { resetHouseholdCache } from "./household";

export interface TrackResult {
  domain: string;
  added: boolean;          // false when it was already declared
  bucket: "biller" | "sender";
}

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

/** Track one or more sender domains in a category. Idempotent per domain.
 *  Returns what happened to each. Saves once. */
export async function trackSenders(
  entries: { domain: string; label?: string; category: ProposalCategory }[],
): Promise<TrackResult[]> {
  const profile: FamilyProfile = await getFamilyProfile();
  const next: FamilyProfile = { ...profile, senders: [...profile.senders], billers: [...profile.billers] };
  const out: TrackResult[] = [];
  let changed = false;

  for (const e of entries) {
    const domain = e.domain.trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) continue;
    const isBiller = e.category === "biller";
    if (!isBiller && !SENDER_CATEGORIES.includes(e.category as SenderCategory)) continue;
    const label = (e.label ?? "").trim().slice(0, 60) || domain;
    const already = isBiller
      ? next.billers.some((b) => b.pattern.toLowerCase() === domain)
      : next.senders.some((s) => s.pattern.toLowerCase() === domain);
    if (already) { out.push({ domain, added: false, bucket: isBiller ? "biller" : "sender" }); continue; }
    if (isBiller) {
      next.billers.push({
        id: `b-${domain.replace(/[^a-z0-9]+/g, "-")}`, pattern: domain, label,
        // Learned from the statements; the silence watch never accuses a
        // biller it has only just met.
        cadence: "auto", autopay: false,
      });
    } else {
      next.senders.push({
        id: `s-${domain.replace(/[^a-z0-9]+/g, "-")}`, pattern: domain, label,
        category: e.category as SenderCategory,
      });
    }
    changed = true;
    out.push({ domain, added: true, bucket: isBiller ? "biller" : "sender" });
  }

  if (changed) {
    await saveFamilyProfile(next);
    resetFamilyCache(); resetHouseholdCache();
  }
  return out;
}
