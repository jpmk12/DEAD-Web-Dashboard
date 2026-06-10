import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAcledEmail, saveAcledCredentials, clearAcledCredentials } from "@/lib/userPrefs";
import { verifyAcledCredentials, resetAcledCache } from "@/lib/acled";

export const dynamic = "force-dynamic";

// Settings endpoint for the ACLED credentials (Preferences → Sources & feeds).
// Kept separate from /api/user-prefs so the password is never part of the prefs
// blob the browser receives, and so saving prefs can't clobber the credentials.
//
//   GET    → { source: "env" | "settings" | null, configured, email }
//            (email only — the password is never returned to the client)
//   POST   → { email, password }  saves + verifies; { ok, verified }
//   DELETE → clears the stored credentials

const envConfigured = () => Boolean(process.env.ACLED_EMAIL && process.env.ACLED_PASSWORD);

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (envConfigured()) {
    return NextResponse.json({ source: "env", configured: true, email: process.env.ACLED_EMAIL ?? "" });
  }
  const email = await getAcledEmail().catch(() => "");
  return NextResponse.json({ source: email ? "settings" : null, configured: Boolean(email), email });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // When env credentials are pinned, the settings UI is read-only — don't let a
  // write silently do nothing the operator wouldn't expect.
  if (envConfigured()) {
    return NextResponse.json({ error: "ACLED credentials are set via environment variables and can't be changed here." }, { status: 409 });
  }

  let body: { email?: unknown; password?: unknown } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const email = String(body.email ?? "").trim().slice(0, 254);
  const password = String(body.password ?? "");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  if (!password) return NextResponse.json({ error: "Password is required" }, { status: 400 });
  if (password.length > 255) return NextResponse.json({ error: "Password too long" }, { status: 400 });

  // Verify before persisting so the user gets immediate feedback rather than a
  // silently-empty layer. If ACLED is unreachable we still save (could be a
  // transient blip) but report verified:false so the UI can warn.
  const verified = await verifyAcledCredentials(email, password);
  await saveAcledCredentials(email, password);
  resetAcledCache();
  return NextResponse.json({ ok: true, configured: true, verified, email });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (envConfigured()) {
    return NextResponse.json({ error: "ACLED credentials are set via environment variables and can't be changed here." }, { status: 409 });
  }
  await clearAcledCredentials();
  resetAcledCache();
  return NextResponse.json({ ok: true, configured: false });
}
