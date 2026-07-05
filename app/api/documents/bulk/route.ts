import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  bulkSetPinned,
  bulkDelete,
  bulkAddTag,
  bulkRemoveTag,
  bulkSetArchived,
  bulkSetCollection,
} from "@/lib/documents";

// One endpoint for multi-select bulk ops in the Docs sidebar.
// Body: { op, ids: string[], tag?: string, collection?: string | null }
//   op ∈ "pin" | "unpin" | "delete" | "tag" | "untag" | "archive" | "unarchive" | "move"
//   tag required for "tag" / "untag"; "move" reads collection (empty/null clears)
// Cap ids at 500 per request — the UI typically operates on tens.

const MAX_IDS = 500;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = body as { op?: unknown; ids?: unknown; tag?: unknown; collection?: unknown };

  if (typeof r.op !== "string") return NextResponse.json({ error: "op required" }, { status: 400 });
  if (!Array.isArray(r.ids)) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const ids = (r.ids as unknown[])
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ affected: 0 });

  try {
    if (r.op === "pin")       return NextResponse.json(await bulkSetPinned(ids, true));
    if (r.op === "unpin")     return NextResponse.json(await bulkSetPinned(ids, false));
    if (r.op === "delete")    return NextResponse.json(await bulkDelete(ids));
    if (r.op === "archive")   return NextResponse.json(await bulkSetArchived(ids, true));
    if (r.op === "unarchive") return NextResponse.json(await bulkSetArchived(ids, false));
    if (r.op === "move") {
      const collection = typeof r.collection === "string" && r.collection.trim() ? r.collection.trim().slice(0, 64) : null;
      return NextResponse.json(await bulkSetCollection(ids, collection));
    }
    if (r.op === "tag" || r.op === "untag") {
      if (typeof r.tag !== "string" || !r.tag.trim()) {
        return NextResponse.json({ error: "tag required" }, { status: 400 });
      }
      const tag = r.tag.trim().slice(0, 64);
      if (r.op === "tag")   return NextResponse.json(await bulkAddTag(ids, tag));
      else                  return NextResponse.json(await bulkRemoveTag(ids, tag));
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    console.error("bulk op failed:", err);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
