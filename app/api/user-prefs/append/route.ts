import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getUserPrefs, savePersonalPrefs } from "@/lib/userPrefs";
import { asToggleOp, enabledRuleIds, escapeJsonSearch, nextNewsletterRules, nextStringList } from "@/lib/newsSourceToggle";
import type { NewsletterSourceRule, UserPrefs } from "@/lib/types";

export const dynamic = "force-dynamic";

// Whitelist of fields the append endpoint can touch. Anything else needs the
// full PUT via /api/user-prefs. Per-field caps match the lengths enforced by
// the validation in /api/user-prefs POST so the two paths agree on shape.
//
// `strings` fields are JSON arrays of strings (the value IS the entry).
// `rules` fields hold rule OBJECTS (newsletterSources); the value is the rule
// id and remove/add means disable/enable — see lib/newsSourceToggle.
type StringField = "vipSenders" | "muteSenders" | "dismissedVipSuggestions" | "disabledNewsSources";
type RuleField = "newsletterSources";
const APPENDABLE: Record<string, { column: string; max: number; kind: "strings" | "rules" }> = {
  vipSenders:              { column: "vip_senders",               max: 100, kind: "strings" },
  muteSenders:             { column: "mute_senders",              max: 100, kind: "strings" },
  dismissedVipSuggestions: { column: "dismissed_vip_suggestions", max: 500, kind: "strings" },
  // News-tab source editing (REVIEW-2026-10 §12 item 6). Both are PERSONAL
  // prefs (lib/userPrefs PERSONAL_PREF_KEYS), so any allowlisted user edits
  // their own overlay; the owner's write lands on the shared row.
  disabledNewsSources:     { column: "disabled_news_sources",     max: 100, kind: "strings" },
  newsletterSources:       { column: "newsletter_sources",        max: 50,  kind: "rules" },
};

const MAX_VALUE_LEN = 254;

interface ColumnRow extends RowDataPacket { v: unknown }

async function readOwnerColumn(column: string): Promise<unknown> {
  const pool = await getDb();
  const [rows] = await pool.query<ColumnRow[]>(`SELECT ${column} AS v FROM user_prefs WHERE id = 1`);
  let v = rows[0]?.v;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  return v;
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// Atomic append-if-not-present (or remove-if-present, `op: "remove"`) on a
// JSON-array column on user_prefs. Replaces the previous GET → mutate → POST
// pattern in components/email/EmailTab.tsx (and similar) which silently
// clobbered concurrent edits — adding a VIP at the same moment as editing
// topics in the Preferences drawer could lose either change. Single SQL
// statement per op; idempotent (JSON_CONTAINS / JSON_SEARCH guards).
// Answers `{ ok: true, values }` with the resulting list (ids for a rules
// field) so a client can reconcile its optimistic state.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { field?: unknown; value?: unknown; op?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const field = typeof body.field === "string" ? body.field : "";
  const spec = APPENDABLE[field];
  if (!spec) {
    return NextResponse.json({ error: "Unsupported field" }, { status: 400 });
  }
  const { column, max } = spec;
  const op = asToggleOp(body.op);
  if (!op) return NextResponse.json({ error: "op must be add or remove" }, { status: 400 });

  const rawValue = typeof body.value === "string" ? body.value.trim() : "";
  if (!rawValue) return NextResponse.json({ error: "value is required" }, { status: 400 });
  const value = rawValue.slice(0, MAX_VALUE_LEN);

  // Every APPENDABLE field is PERSONAL. The shared-row SQL below is the
  // OWNER's path only — a crew write must land in the crew member's
  // user_personal_prefs overlay, not mutate the owner's lists (which is where
  // the pre-split UPDATE ... WHERE id = 1 wrote).
  const email = normEmail(session.user?.email);
  if (!isOwner(email)) {
    const current = await getUserPrefs(email);
    if (spec.kind === "rules") {
      const rules = (current[field as RuleField] ?? []) as NewsletterSourceRule[];
      const next = nextNewsletterRules(rules, value, op);
      await savePersonalPrefs(email, { [field]: next } as Partial<UserPrefs>);
      return NextResponse.json({ ok: true, values: enabledRuleIds(next) });
    }
    const arr = (current[field as StringField] ?? []) as string[];
    const next = nextStringList(arr, value, op, max);
    if (next.length !== arr.length || next.some((x, i) => x !== arr[i])) {
      await savePersonalPrefs(email, { [field]: next } as Partial<UserPrefs>);
    }
    return NextResponse.json({ ok: true, values: next });
  }

  const pool = await getDb();

  if (spec.kind === "rules") {
    // A rule array can't be edited in place with JSON_ARRAY_APPEND / JSON_REMOVE
    // by value, so this is a targeted single-column write (the saveOsintFeeds
    // pattern): read the resolved rules (getUserPrefs supplies the built-in
    // defaults when the column is NULL — materialising them with one disabled
    // is exactly what the Preferences editor's save would store), flip the
    // one rule, write ONLY this column.
    const current = await getUserPrefs();
    const rules = current[field as RuleField] ?? [];
    const next = nextNewsletterRules(rules, value, op);
    await pool.execute(
      `UPDATE user_prefs SET ${column} = CAST(? AS JSON), last_updated = NOW(3) WHERE id = 1`,
      [JSON.stringify(next)]
    );
    return NextResponse.json({ ok: true, values: enabledRuleIds(next) });
  }

  if (op === "remove") {
    // JSON_SEARCH finds the path of the first match ("$[3]"); JSON_REMOVE at
    // that path drops it. The search string is a LIKE pattern, hence the
    // escape. The WHERE guard makes a remove of an absent value a no-op.
    const pattern = escapeJsonSearch(value);
    await pool.execute(
      `UPDATE user_prefs
         SET ${column}    = JSON_REMOVE(${column}, JSON_UNQUOTE(JSON_SEARCH(${column}, 'one', ?, '\\\\'))),
             last_updated = NOW(3)
       WHERE id = 1
         AND JSON_SEARCH(COALESCE(${column}, JSON_ARRAY()), 'one', ?, '\\\\') IS NOT NULL`,
      [pattern, pattern]
    );
  } else {
    // JSON_ARRAY_APPEND on NULL silently returns NULL, so COALESCE first; then
    // guard with NOT JSON_CONTAINS to make the append idempotent (a double-click
    // adds the value once, not twice). last_updated bumped only when we change.
    await pool.execute(
      `UPDATE user_prefs
         SET ${column}    = JSON_ARRAY_APPEND(COALESCE(${column}, JSON_ARRAY()), '$', ?),
             last_updated = NOW(3)
       WHERE id = 1
         AND NOT JSON_CONTAINS(COALESCE(${column}, JSON_ARRAY()), JSON_QUOTE(?), '$')`,
      [value, value]
    );
    // Trim oldest entries if we've grown past the per-field cap. The trim is
    // a separate statement so the append above can run on its idempotency
    // guard without depending on the row size.
    await pool.execute(
      `UPDATE user_prefs
         SET ${column} = JSON_REMOVE(${column}, '$[0]')
       WHERE id = 1 AND JSON_LENGTH(${column}) > ?`,
      [max]
    );
  }
  const values = asStrings(await readOwnerColumn(column));
  return NextResponse.json({ ok: true, values });
}
