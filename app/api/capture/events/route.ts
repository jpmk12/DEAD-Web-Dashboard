import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { verifyXUploadToken, setXTokenCadence } from "@/lib/xUploadToken";
import { parseEventsCapture } from "@/lib/eventCapture";
import { upsertEvents, getEventStatus, clearEvents } from "@/lib/eventStore";

export const dynamic = "force-dynamic";

// Event-stream capture ingest — geolocated conflict/incident events captured in
// the user's own browser from a public map (e.g. LiveUAMap) that blocks
// datacenter IPs. Same auth model as x-import: session OR per-user bearer token.
//   POST   dead-events JSON → validate + upsert
//   GET    → status { count, newest, sources }
//   DELETE → clear
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  let email = session?.accessToken ? normEmail(session.user?.email) : "";
  // Always verify the token when present (stamps last_used + records cadence for
  // the freshness pill, even when a browser session cookie also authenticated).
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (m) {
    const tokEmail = await verifyXUploadToken(m[1].trim()).catch(() => null);
    if (tokEmail) {
      if (!email) email = tokEmail;
      const iv = Number(req.headers.get("x-capture-interval-hours"));
      if (Number.isFinite(iv)) setXTokenCadence(tokEmail, iv).catch(() => {});
    }
  }
  if (!session?.accessToken && !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Capture too large (2 MB max)." }, { status: 413 });

  const parsed = parseEventsCapture(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { imported } = await upsertEvents(parsed.events, email);
    const status = await getEventStatus();
    return NextResponse.json({ ok: true, imported, skipped: parsed.skipped, source: parsed.source, total: status.count });
  } catch (err) {
    console.error("event capture failed:", err);
    return NextResponse.json({ error: "Capture failed — database unavailable." }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await getEventStatus()); }
  catch { return NextResponse.json({ count: 0, newest: null, sources: [] }); }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearEvents().catch(() => {});
  return NextResponse.json({ ok: true });
}
