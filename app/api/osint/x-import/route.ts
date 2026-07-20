import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseXCapture } from "@/lib/xImport";
import { importXCapture, getXStatus, clearXItems } from "@/lib/xStore";
import { verifyXUploadToken, setXTokenCadence } from "@/lib/xUploadToken";

export const dynamic = "force-dynamic";

// X capture import — the upload half of the dead-x-capture flow (the capture
// half is the bookmarklet; see tools/x-capture-bookmarklet.js). Deliberately
// NO server-side X access of any kind: this route only ever receives a JSON
// file the user exported from their own browser.
//
// POST   raw dead-x-capture v1 JSON  → validate + upsert, return counts
// GET    → status { count, newest, sources } for the Social-pane card
// DELETE → clear all imported posts

const MAX_BODY_BYTES = 2 * 1024 * 1024; // a 200-post capture is ~100-300 KB

export async function POST(req: Request) {
  // Two ways in: an interactive session (the Social-pane upload), OR a per-user
  // bearer token (the unattended browser-extension / script upload). The token
  // path lets the automation post without a login while keeping the same
  // capture-in-your-own-browser model — the token only authorizes the upload.
  const session = await auth();
  let authed = Boolean(session?.accessToken);
  // ALWAYS check the bearer token when present — even if a browser session cookie
  // also authenticated this request. The extension posts from a logged-in browser,
  // so its upload carries both; if we only checked the token when the session was
  // ABSENT, verifyXUploadToken (which stamps last_used) never ran and the freshness
  // pill read "not yet run" despite working uploads.
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (m) {
    const email = await verifyXUploadToken(m[1].trim()).catch(() => null); // stamps last_used
    if (email) {
      authed = true;
      const iv = Number(req.headers.get("x-capture-interval-hours"));
      if (Number.isFinite(iv)) setXTokenCadence(email, iv).catch(() => {});
    }
  }
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Capture file too large (2 MB max)." }, { status: 413 });
  }

  const parsed = parseXCapture(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await importXCapture(parsed.capture);
    const status = await getXStatus();
    return NextResponse.json({
      ok: true,
      imported: result.imported,
      updated: result.updated,
      skipped: parsed.skipped,
      warnings: parsed.warnings,
      source: parsed.capture.source,
      total: status.count,
    });
  } catch (err) {
    console.error("x-import failed:", err);
    return NextResponse.json({ error: "Import failed — database unavailable." }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getXStatus());
  } catch {
    // No DB (local dev without MySQL) → an empty store, not an error page.
    return NextResponse.json({ count: 0, newest: null, sources: [] });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await clearXItems();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Clear failed — database unavailable." }, { status: 500 });
  }
}
