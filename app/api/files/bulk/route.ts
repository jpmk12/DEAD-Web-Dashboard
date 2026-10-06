import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { bulkFileTag, bulkFileAttach, bulkFileDelete } from "@/lib/files";

// One endpoint for the Files pane's multi-select bar (REVIEW-2026-10 D3),
// mirroring /api/documents/bulk.
//   { op: "tag" | "untag", ids, tag }
//   { op: "attach", ids, docId: string | null }   null = detach
//   { op: "delete", ids }
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const r = (body ?? {}) as { op?: unknown; ids?: unknown; tag?: unknown; docId?: unknown };
  if (typeof r.op !== "string" || !Array.isArray(r.ids)) return NextResponse.json({ error: "op and ids required" }, { status: 400 });
  const ids = (r.ids as unknown[]).filter((x): x is string => typeof x === "string");
  try {
    if (r.op === "tag" || r.op === "untag") {
      if (typeof r.tag !== "string" || !r.tag.trim()) return NextResponse.json({ error: "tag required" }, { status: 400 });
      return NextResponse.json(await bulkFileTag(ids, r.tag, r.op === "tag"));
    }
    if (r.op === "attach") {
      const docId = typeof r.docId === "string" && r.docId ? r.docId : null;
      return NextResponse.json(await bulkFileAttach(ids, docId));
    }
    if (r.op === "delete") return NextResponse.json(await bulkFileDelete(ids));
    return NextResponse.json({ error: "op must be tag | untag | attach | delete" }, { status: 400 });
  } catch (err) {
    console.error("files bulk failed:", err);
    return NextResponse.json({ error: "Bulk operation failed" }, { status: 500 });
  }
}
