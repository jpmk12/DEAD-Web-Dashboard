import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listDocumentVersions, forceSnapshotVersion } from "@/lib/documents";

interface RouteCtx { params: Promise<{ id: string }> }

// GET /api/documents/:id/versions — list snapshots of this doc, newest first.
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const versions = await listDocumentVersions(id);
    return NextResponse.json({ versions });
  } catch (err) {
    console.error("listDocumentVersions failed:", err);
    return NextResponse.json({ error: "Failed to load versions" }, { status: 500 });
  }
}

// POST /api/documents/:id/versions — force a snapshot of the current state,
// bypassing the autosave throttle. Called before Split-at-headings rewrites
// the master so the pre-split doc is always one restore away.
export async function POST(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const ok = await forceSnapshotVersion(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("forceSnapshotVersion failed:", err);
    return NextResponse.json({ error: "Snapshot failed" }, { status: 500 });
  }
}
