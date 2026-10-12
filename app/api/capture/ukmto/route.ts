import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { verifyXUploadToken, setXTokenCadence } from "@/lib/xUploadToken";
import { parseUkmtoCapture } from "@/lib/ukmtoParse";
import { upsertUkmto, getUkmtoStoreStatus, clearUkmto } from "@/lib/ukmtoStore";
import { resetUkmtoCache } from "@/lib/ukmto";
import { resetChokepointReadsCache } from "@/lib/chokepointReads";

export const dynamic = "force-dynamic";

// UKMTO recent-incidents capture ingest — the page's text, captured in the
// user's own browser by the extension (tools/x-auto-capture/ukmto.js)
// because the host is reported to refuse automated fetches. Same auth model
// as x-import / events / notices: session OR per-user bearer token.
//   POST   dead-ukmto JSON → validate + parse + upsert
//   GET    → store status
//   DELETE → clear (owner)
const MAX_BODY_BYTES = 2 * 1024 * 1024;

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
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Capture too large (2 MB max)." }, { status: 413 });

  const parsed = parseUkmtoCapture(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { imported } = await upsertUkmto(parsed.incidents, "capture", email);
    resetUkmtoCache();
    resetChokepointReadsCache();
    const status = await getUkmtoStoreStatus();
    return NextResponse.json({ ok: true, imported, total: status.count, source: "UKMTO" });
  } catch (err) {
    console.error("ukmto capture failed:", err);
    return NextResponse.json({ error: "Capture failed — database unavailable." }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await getUkmtoStoreStatus()); }
  catch { return NextResponse.json({ count: 0, newest: null, captured: 0, fetched: 0 }); }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(normEmail(session.user?.email))) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  await clearUkmto().catch(() => {});
  resetUkmtoCache();
  resetChokepointReadsCache();
  return NextResponse.json({ ok: true });
}
