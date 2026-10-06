// Email priority corrections → what the app learns from them.
// PURE, client-safe, unit-tested (REVIEW-2026-10 §4 E1/E3).
//
// The triage model assigns High / Medium / Low; the user can overrule any
// one email (E1). Every overrule is a CORRECTION: this email, the model's
// call, the user's call, the sender. Three things are derived from the
// correction stream, none of them with a model call:
//   - suggested sender rules (the same sender corrected the same way ≥
//     RULE_MIN_CORRECTIONS times → "Always High / Always Low?");
//   - examples for the NEXT triage (the most recent corrections, as a block
//     the classifier reads — outside the cache hash, so a correction never
//     re-classifies the cached inbox);
//   - the "why" line under every subject, naming which rule decided.

import type { EmailPriority } from "./types";

export const PRIORITY_RANK: Record<EmailPriority, number> = { Low: 0, Medium: 1, High: 2 };

export interface Correction {
  messageId: string;
  accountEmail: string;
  /** What the user set. */
  prioritySet: EmailPriority;
  /** What the model (after VIP/mute) had said; null when unknown. */
  priorityModel: EmailPriority | null;
  sender: string;   // the raw From header
  subject: string;
  at: number;       // ms
}

export interface SenderRule {
  /** Dismissal key, namespaced inside dismissedVipSuggestions. */
  key: string;
  kind: "high" | "low";
  /** The value to append to vipSenders / muteSenders. */
  sender: string;
  count: number;
  evidence: string;
}

export const RULE_MIN_CORRECTIONS = 3;
export const RULE_WINDOW_MS = 30 * 86_400_000;
export const EXAMPLE_LIMIT = 15;

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com", "comcast.net", "att.net", "verizon.net"]);

export function senderAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  const raw = (m ? m[1] : from).trim().toLowerCase();
  return raw.includes("@") ? raw : "";
}

export function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  const at = from.indexOf("@");
  return at > 0 ? from.slice(0, at) : from;
}

export function ruleKey(kind: "high" | "low", sender: string): string {
  return `rule:${kind}:${sender.toLowerCase()}`;
}

/** The direction of a correction against the model's own call. */
export function direction(c: Pick<Correction, "prioritySet" | "priorityModel">): "up" | "down" | null {
  if (!c.priorityModel) return null;
  const d = PRIORITY_RANK[c.prioritySet] - PRIORITY_RANK[c.priorityModel];
  return d > 0 ? "up" : d < 0 ? "down" : null;
}

/** Does a rule list already cover this address (same semantics as senderMatches)? */
function covered(address: string, rules: string[]): boolean {
  const domain = address.slice(address.lastIndexOf("@") + 1);
  for (const raw of rules) {
    const norm = raw.trim().toLowerCase().replace(/^@/, "");
    if (!norm) continue;
    if (norm.includes("@")) { if (norm === address) return true; continue; }
    if (domain === norm || domain.endsWith("." + norm)) return true;
  }
  return false;
}

/**
 * Suggested sender rules from the correction stream. A sender corrected the
 * SAME direction ≥ RULE_MIN_CORRECTIONS times inside the window earns a
 * proposal; a sender corrected both ways earns nothing (the user has not
 * decided). When three or more DISTINCT addresses on one non-free-mail
 * domain all went the same way, the domain is proposed instead of each
 * address. Anything already in vip / mute, or dismissed, is skipped —
 * every row states its evidence and a dismissal is permanent.
 */
export function suggestSenderRules(
  corrections: Correction[],
  ctx: { vip: string[]; mute: string[]; dismissed: string[]; now: number },
): SenderRule[] {
  const since = ctx.now - RULE_WINDOW_MS;
  const byAddr = new Map<string, { up: number; down: number; last: number }>();
  for (const c of corrections) {
    if (c.at < since) continue;
    const addr = senderAddress(c.sender);
    const dir = direction(c);
    if (!addr || !dir) continue;
    const e = byAddr.get(addr) ?? { up: 0, down: 0, last: 0 };
    if (dir === "up") e.up++; else e.down++;
    e.last = Math.max(e.last, c.at);
    byAddr.set(addr, e);
  }
  const dismissed = new Set(ctx.dismissed.map((d) => d.toLowerCase()));
  const out: SenderRule[] = [];
  const usedDomains = new Set<string>();

  // Domain-level first: ≥3 distinct addresses, all one way, on a real domain.
  const byDomain = new Map<string, { addrs: Set<string>; up: number; down: number }>();
  for (const [addr, e] of byAddr) {
    const domain = addr.slice(addr.lastIndexOf("@") + 1);
    if (FREE_MAIL.has(domain)) continue;
    const d = byDomain.get(domain) ?? { addrs: new Set(), up: 0, down: 0 };
    d.addrs.add(addr); d.up += e.up; d.down += e.down;
    byDomain.set(domain, d);
  }
  for (const [domain, d] of byDomain) {
    if (d.addrs.size < 3) continue;
    const kind = d.up >= RULE_MIN_CORRECTIONS && d.down === 0 ? "high" : d.down >= RULE_MIN_CORRECTIONS && d.up === 0 ? "low" : null;
    if (!kind) continue;
    if (covered(`x@${domain}`, kind === "high" ? ctx.vip : ctx.mute) || dismissed.has(ruleKey(kind, domain))) continue;
    const n = kind === "high" ? d.up : d.down;
    out.push({ key: ruleKey(kind, domain), kind, sender: domain, count: n, evidence: `${n} emails from ${d.addrs.size} addresses at ${domain} ${kind === "high" ? "promoted" : "demoted"} in 30 d` });
    usedDomains.add(domain);
  }

  for (const [addr, e] of byAddr) {
    const domain = addr.slice(addr.lastIndexOf("@") + 1);
    if (usedDomains.has(domain)) continue;
    const kind = e.up >= RULE_MIN_CORRECTIONS && e.down === 0 ? "high" : e.down >= RULE_MIN_CORRECTIONS && e.up === 0 ? "low" : null;
    if (!kind) continue;
    if (covered(addr, kind === "high" ? ctx.vip : ctx.mute) || dismissed.has(ruleKey(kind, addr))) continue;
    const n = kind === "high" ? e.up : e.down;
    out.push({ key: ruleKey(kind, addr), kind, sender: addr, count: n, evidence: `you ${kind === "high" ? "promoted" : "demoted"} ${n} emails from ${addr} in 30 d — the model called them ${kind === "high" ? "lower" : "higher"} each time` });
  }
  return out.sort((a, b) => b.count - a.count || a.sender.localeCompare(b.sender));
}

/** The 30-day tally for the "How priority is decided" strip. */
export function correctionCounts(corrections: Correction[], now: number): { total: number; promoted: number; demoted: number } {
  const since = now - RULE_WINDOW_MS;
  let promoted = 0, demoted = 0, total = 0;
  for (const c of corrections) {
    if (c.at < since) continue;
    total++;
    const d = direction(c);
    if (d === "up") promoted++; else if (d === "down") demoted++;
  }
  return { total, promoted, demoted };
}

/**
 * The example block the classifier reads on the next triage — most recent
 * first, capped, one line each. Rendered OUTSIDE the cache hash on purpose:
 * it shapes only emails not yet classified. Returns "" when there is
 * nothing to say so the caller can omit the block entirely.
 */
export function correctionExamples(corrections: Correction[], limit = EXAMPLE_LIMIT): string {
  const rows = [...corrections]
    .filter((c) => direction(c) !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
  if (!rows.length) return "";
  const clean = (s: string) => s.replace(/[\n\r"]/g, " ").trim().slice(0, 90);
  const lines = rows.map((c) => `- from "${clean(c.sender)}" · "${clean(c.subject)}" → user set ${c.prioritySet} (you had said ${c.priorityModel})`);
  return `The user re-prioritised these recent emails. Treat them as examples of this user's taste when the new emails resemble them (same sender, same kind of message); they are not rules:\n${lines.join("\n")}`;
}

export type WhySource = "you" | "vip" | "mute" | "model" | "none";

/** The one-line "why" under a subject, naming which rule decided. */
export function whyLine(input: { source: WhySource; modelWhy?: string | null; prioritySet?: EmailPriority | null; priorityModel?: EmailPriority | null }): string {
  const model = (input.modelWhy ?? "").trim();
  switch (input.source) {
    case "you":
      return `you set ${input.prioritySet}` + (input.priorityModel && input.priorityModel !== input.prioritySet ? ` (model said ${input.priorityModel})` : "") + (model ? ` · ${model}` : "");
    case "vip":
      return "Always High — VIP sender" + (model ? ` · ${model}` : "");
    case "mute":
      return "Always Low — muted sender" + (model ? ` · ${model}` : "");
    case "model":
      return model || "model's call";
    default:
      return "not triaged — AI off or the call failed";
  }
}

/** Stable key for an action item across refreshes and devices. */
export function actionKey(emailId: string, action: string): string {
  let h = 5381;
  const s = action.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${emailId}:${(h >>> 0).toString(36)}`;
}
