import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { vapidConfig, sendTestPush } from "@/lib/pushDispatch";
import { saveSubscription, deleteSubscription, countSubscriptions } from "@/lib/pushStore";

export const dynamic = "force-dynamic";

// Web-push subscription door. GET tells the client whether the server can push
// at all (VAPID configured) and hands over the PUBLIC key it must subscribe
// with; POST stores this browser's subscription under the signed-in user;
// DELETE removes it. Per-user: crew members get their own devices' alerts.

export async function GET() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = vapidConfig();
  const devices = await countSubscriptions(email).catch(() => 0);
  return NextResponse.json({
    configured: !!cfg,
    publicKey: cfg?.publicKey ?? null,
    devices,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!vapidConfig()) return NextResponse.json({ error: "Push is not configured on the server (VAPID keys missing)." }, { status: 503 });

  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; label?: string; test?: boolean } = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  const sub = body.subscription;
  const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, authKey = sub?.keys?.auth;
  if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !authKey) {
    return NextResponse.json({ error: "Malformed subscription" }, { status: 400 });
  }
  await saveSubscription({ endpoint, p256dh, auth: authKey, userEmail: email, label: typeof body.label === "string" ? body.label : "" });
  const test = body.test ? await sendTestPush({ endpoint, p256dh, auth: authKey }) : null;
  const devices = await countSubscriptions(email).catch(() => 1);
  return NextResponse.json({ ok: true, devices, test });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { endpoint?: string } = {};
  try { body = await req.json(); } catch { /* fallthrough */ }
  if (!body.endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  await deleteSubscription(body.endpoint, email);
  const devices = await countSubscriptions(email).catch(() => 0);
  return NextResponse.json({ ok: true, devices });
}
