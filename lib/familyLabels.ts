// The Gmail labels the dashboard files family mail under — PURE, client-safe.
//
// One label per roster category, nested under a "Family" parent so they sit
// together in Gmail. Filing an email from the Email tab applies the label AND
// tracks the sender in the matching roster bucket, so the Family tab's
// "seed from label" and the digest both see it with no further typing. The
// mapping lives here so the Email tab, the label route and the discovery
// route agree on the names.

import type { ProposalCategory } from "./senderDiscovery";

export const FAMILY_LABEL_PARENT = "Family";

export const FAMILY_LABELS: { category: ProposalCategory; name: string; hint: string }[] = [
  { category: "school",   name: "Family/School",     hint: "newsletters, forms, report cards" },
  { category: "activity", name: "Family/Activities", hint: "sports, music, scouts, camps" },
  { category: "biller",   name: "Family/Bills",      hint: "statements, invoices, renewals" },
  { category: "medical",  name: "Family/Medical",    hint: "appointments, results, refills" },
  { category: "travel",   name: "Family/Travel",     hint: "bookings, itineraries" },
  { category: "admin",    name: "Family/Admin",      hint: "government, DMV, taxes, base" },
];

export function labelForCategory(category: ProposalCategory): string | null {
  return FAMILY_LABELS.find((l) => l.category === category)?.name ?? null;
}

/** The roster category a Gmail label name implies, or null for any other label. */
export function categoryForLabel(name: string): ProposalCategory | null {
  const n = name.trim().toLowerCase();
  return FAMILY_LABELS.find((l) => l.name.toLowerCase() === n)?.category ?? null;
}

export function isFamilyLabelName(name: string): boolean {
  return categoryForLabel(name) !== null;
}
