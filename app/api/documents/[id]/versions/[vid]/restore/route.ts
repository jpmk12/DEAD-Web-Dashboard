import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { restoreVersion } from "@/lib/documents";

interface RouteCtx { params: Promise<{ id: string; vid: string }> }

// POST /api/documents/:id/versions/:vid/restore — copy the snapshot's
// title/content/tags onto the current doc. Snapshots the current state
// first so the restore itself is undoable.
export async function POST(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { vid } = await ctx.params;
  if (!vid) return NextResponse.json({ error: "version id required" }, { status: 400 });
  try {
    const doc = await restoreVersion(vid);
    if (!doc) return NextResponse.json({ error: "Version or doc not found" }, { status: 404 });
    return NextResponse.json({ doc });
  } catch (err) {
    console.error("restoreVersion failed:", err);
    return NextResponse.json({ error: "Restore failed" }, { status: 500 });
  }
}
