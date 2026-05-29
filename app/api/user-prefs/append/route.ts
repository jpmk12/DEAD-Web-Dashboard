import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Whitelist of fields the append endpoint can touch. Anything else needs the
// full PUT via /api/user-prefs.
const APPENDABLE: Record<string, string> = {
  vipSenders: "vip_senders",
  muteSenders: "mute_senders",
  dismissedVipSuggestions: "dismissed_vip_suggestions",
};

const MAX_VALUE_LEN = 254;

// Atomic append-if-not-present to a JSON-array column on user_prefs. Replaces
// the previous GET → mutate → POST pattern in components/email/EmailTab.tsx
// (and similar) which silently clobbered concurrent edits — adding a VIP at
// the same moment as editing topics in the Preferences drawer could lose
// either change. Single SQL statement; idempotent (JSON_CONTAINS guard).
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { field?: unknown; value?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const field = typeof body.field === "string" ? body.field : "";
  const column = APPENDABLE[field];
  if (!column) {
    return NextResponse.json({ error: "Unsupported field" }, { status: 400 });
  }

  const rawValue = typeof body.value === "string" ? body.value.trim() : "";
  if (!rawValue) return NextResponse.json({ error: "value is required" }, { status: 400 });
  const value = rawValue.slice(0, MAX_VALUE_LEN);

  const pool = await getDb();
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
  return NextResponse.json({ ok: true });
}
