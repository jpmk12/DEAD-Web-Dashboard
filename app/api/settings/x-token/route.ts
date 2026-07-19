import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { generateXUploadToken, getXUploadTokenStatus, revokeXUploadToken } from "@/lib/xUploadToken";

export const dynamic = "force-dynamic";

// Manage the caller's unattended X-upload token (for the browser extension /
// local script). Session-gated — any allowlisted user manages their own token.
//   GET    → status { configured, label, createdAt, lastUsedAt } (never the token)
//   POST   → generate/rotate, returns { token } ONCE
//   DELETE → revoke

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  return NextResponse.json(await getXUploadTokenStatus(email).catch(() => ({ configured: false, label: null, createdAt: null, lastUsedAt: null })));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  if (!email) return NextResponse.json({ error: "No account email" }, { status: 400 });
  let label = "browser extension";
  try { const b = await req.json(); if (b && typeof b.label === "string") label = b.label; } catch { /* default label */ }
  try {
    const token = await generateXUploadToken(email, label);
    return NextResponse.json({ ok: true, token });
  } catch {
    return NextResponse.json({ error: "Could not generate token — database unavailable." }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  await revokeXUploadToken(email).catch(() => {});
  return NextResponse.json({ ok: true });
}
