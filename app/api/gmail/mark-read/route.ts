import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { markAsRead } from "@/lib/gmail";
import { COOKIE_NAME, getValidSecondaryToken } from "@/lib/secondaryAuth";
import { normEmail } from "@/lib/allowlist";
import { keptIds } from "@/lib/emailPrefs";

export const dynamic = "force-dynamic";

// Mark messages read (REVIEW-2026-10 E2/E5).
//   POST { ids, account } → { ok, done: string[], kept: string[], failed: string[] }
// - KEPT ids are refused HERE, not only in the client: a kept email must
//   survive a shortcut that bypasses the UI (the same server-boundary rule
//   as /api/family/event).
// - The secondary token is REFRESHED (getValidSecondaryToken), not merely
//   decrypted: an expired token used to pass the check and then fail every
//   modify, while the route still said ok.
// - `failed` carries what Gmail refused; the client puts those back.

const VALID_ACCOUNTS = new Set(["primary", "secondary"]);
const MAX_IDS = 100;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userEmail = normEmail(session.user?.email);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { ids, account } = body as Record<string, unknown>;

  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: "ids must be a non-empty array (max 100)" }, { status: 400 });
  }
  if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
    return NextResponse.json({ error: "All ids must be non-empty strings" }, { status: 400 });
  }
  if (ids.some((id) => !/^[a-zA-Z0-9]{6,32}$/.test(id as string))) {
    return NextResponse.json({ error: "Invalid message ID format" }, { status: 400 });
  }
  if (typeof account !== "string" || !VALID_ACCOUNTS.has(account)) {
    return NextResponse.json({ error: "account must be 'primary' or 'secondary'" }, { status: 400 });
  }

  let token = session.accessToken as string;
  let accountEmail = userEmail;
  if (account === "secondary") {
    const cookieStore = await cookies();
    const raw = cookieStore.get(COOKIE_NAME)?.value;
    const result = raw ? await getValidSecondaryToken(raw) : null;
    if (!result) {
      return NextResponse.json({ error: "Secondary account not connected" }, { status: 401 });
    }
    token = result.payload.access_token;
    accountEmail = normEmail(result.payload.email);
    if (result.refreshedJwe) {
      cookieStore.set(COOKIE_NAME, result.refreshedJwe, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 30, path: "/",
      });
    }
  }

  const kept = await keptIds(userEmail, accountEmail, ids as string[]).catch(() => new Set<string>());
  const toMark = (ids as string[]).filter((id) => !kept.has(id));
  const failed = toMark.length ? await markAsRead(token, toMark) : [];
  const failedSet = new Set(failed);
  const done = toMark.filter((id) => !failedSet.has(id));

  return NextResponse.json({ ok: failed.length === 0, done, kept: [...kept], failed });
}
