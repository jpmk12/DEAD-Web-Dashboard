import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { verifyXUploadToken, setXTokenCadence } from "@/lib/xUploadToken";
import { parseNoticesCapture } from "@/lib/noticeCapture";
import { upsertNotices, getNoticeStatus, clearNotices } from "@/lib/noticeStore";

export const dynamic = "force-dynamic";

// Official-notice capture ingest — a ministry's announcements (first source:
// PRC MOFCOM export-control / unreliable-entity / anti-dumping notices)
// captured in the user's own browser, because the site has no API. Same auth
// model as x-import / events: session OR per-user bearer token.
//   POST   dead-notices JSON → validate + upsert
//   GET    → status { count, newest, sources }
//   DELETE → clear
const MAX_BODY_BYTES = 3 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  let email = session?.accessToken ? normEmail(session.user?.email) : "";
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

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Capture too large (3 MB max)." }, { status: 413 });

  const parsed = parseNoticesCapture(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { imported } = await upsertNotices(parsed.notices, email);
    const status = await getNoticeStatus();
    return NextResponse.json({ ok: true, imported, skipped: parsed.skipped, source: parsed.source, total: status.count });
  } catch (err) {
    console.error("notice capture failed:", err);
    return NextResponse.json({ error: "Capture failed — database unavailable." }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await getNoticeStatus()); }
  catch { return NextResponse.json({ count: 0, newest: null, sources: [] }); }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Owner-only: this clears a SHARED corpus (it feeds I&W corroboration and
  // the Economy board), not the caller's own rows (code review 2026-10-07).
  if (!isOwner(normEmail(session.user?.email))) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  await clearNotices().catch(() => {});
  return NextResponse.json({ ok: true });
}
