import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { markAsRead } from "@/lib/gmail";
import { COOKIE_NAME, decryptToken } from "@/lib/secondaryAuth";

export const dynamic = "force-dynamic";

const VALID_ACCOUNTS = new Set(["primary", "secondary"]);
const MAX_IDS = 100;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  if (account === "primary") {
    await markAsRead(session.accessToken as string, ids as string[]);
  } else {
    const cookieStore = await cookies();
    const raw = cookieStore.get(COOKIE_NAME)?.value;
    const payload = raw ? await decryptToken(raw) : null;
    if (!payload) {
      return NextResponse.json({ error: "Secondary account not connected" }, { status: 401 });
    }
    await markAsRead(payload.access_token, ids as string[]);
  }

  return NextResponse.json({ ok: true });
}
