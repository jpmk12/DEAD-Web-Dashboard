// News and newsletter sources are edited ON THE NEWS TAB (REVIEW-2026-10
// §12 item 6): a chip per source on the Read view, a mute affordance on each
// card's source badge, and "stop summarising this series" on each newsletter
// row. Every one of those is ONE tap through the append-only prefs door
// (`/api/user-prefs/append`, op add | remove), so no tap can clobber the
// rest of the prefs row the way a GET → mutate → POST round-trip could.
//
// PURE, client-safe, unit-tested (tests/newsSourceToggle.test.ts). The route
// and the three components share the same list arithmetic so the optimistic
// state on the client and the stored state on the server cannot disagree
// about what a toggle means.

import type { NewsletterSourceRule } from "./types";

export type ToggleOp = "add" | "remove";

export function asToggleOp(v: unknown): ToggleOp | null {
  if (v === undefined || v === null || v === "add") return "add";
  if (v === "remove") return "remove";
  return null;
}

/** The next state of a string list after one add/remove. Add is idempotent
 *  (a double-tap adds once) and caps at `max` by dropping the OLDEST entries
 *  — the same trim the owner's SQL path applies. Remove drops every copy. */
export function nextStringList(current: readonly string[], value: string, op: ToggleOp, max: number): string[] {
  const v = value.trim();
  if (!v) return [...current];
  if (op === "remove") return current.filter((x) => x !== v);
  if (current.includes(v)) return [...current];
  const next = [...current, v];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** `newsletterSources` holds RULE OBJECTS, not names, so the toggle keys on
 *  the rule id. `remove` DISABLES the rule (`enabled: false`) rather than
 *  deleting it: the rule keeps its label (cached summaries still badge
 *  correctly — the newsletters route ships metadata for disabled rules on
 *  purpose) and the tap is reversible from Preferences or by `add`, which
 *  re-enables. A tap on a row must never destroy a rule the user typed. An
 *  unknown id changes nothing. */
export function nextNewsletterRules(rules: readonly NewsletterSourceRule[], id: string, op: ToggleOp): NewsletterSourceRule[] {
  const target = id.trim();
  return rules.map((r) => {
    if (r.id !== target) return r;
    return op === "remove" ? { ...r, enabled: false } : { ...r, enabled: true };
  });
}

/** The ids the route reports back as `values` — the rules still being read. */
export function enabledRuleIds(rules: readonly NewsletterSourceRule[]): string[] {
  return rules.filter((r) => r.enabled !== false).map((r) => r.id);
}

/** Escape a value for MySQL JSON_SEARCH, whose search string is a LIKE
 *  pattern: `%` and `_` are wildcards unless escaped. The escape char is
 *  passed as `\` by the route. */
export function escapeJsonSearch(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface SourceStat { name: string; count: number }
export interface SourceChip { name: string; count: number; enabled: boolean }

/** The chips the Read view shows. A DISABLED source is skipped before fetch
 *  and so never appears in `sourceStats` — it must still be listed, or the
 *  tab could mute a source it can never un-mute. Enabled first (most items
 *  first, then by name), muted after (by name), each name once. */
export function sourceChips(stats: readonly SourceStat[], disabled: readonly string[]): SourceChip[] {
  const off = new Set(disabled);
  const byName = new Map<string, SourceChip>();
  for (const s of stats) {
    if (!s.name) continue;
    const prev = byName.get(s.name);
    byName.set(s.name, { name: s.name, count: (prev?.count ?? 0) + Math.max(0, s.count | 0), enabled: !off.has(s.name) });
  }
  for (const name of off) if (name && !byName.has(name)) byName.set(name, { name, count: 0, enabled: false });
  return [...byName.values()].sort((a, b) =>
    (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1) ||
    (a.enabled ? b.count - a.count : 0) ||
    a.name.localeCompare(b.name));
}

/** "N of M sources on" for the fold's handle. */
export function sourcesOnLabel(chips: readonly SourceChip[]): string {
  const on = chips.filter((c) => c.enabled).length;
  return `${on} of ${chips.length} source${chips.length === 1 ? "" : "s"} on`;
}
