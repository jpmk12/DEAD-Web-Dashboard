import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFileWithData, updateFileMetadata, deleteFile } from "@/lib/files";

interface RouteCtx { params: Promise<{ id: string }> }

// GET /api/files/:id — download (attachment).
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const file = await getFileWithData(id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Quote filename to defend against unusual chars in headers.
  const safeName = file.filename.replace(/[\r\n"]/g, "");
  // Cast sidesteps the lib's over-strict ArrayBufferLike generic; file.data is
  // a real ArrayBuffer-backed Buffer and a valid response body at runtime.
  return new NextResponse(file.data as unknown as BodyInit, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(file.sizeBytes),
      "Cache-Control": "private, no-store",
    },
  });
}

// PATCH /api/files/:id — update metadata (filename, description, tags, docId).
export async function PATCH(request: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = body as { filename?: unknown; description?: unknown; tags?: unknown; docId?: unknown };
  const patch: Parameters<typeof updateFileMetadata>[1] = {};
  if (typeof r.filename === "string") patch.filename = r.filename;
  if (r.description === null || typeof r.description === "string") patch.description = r.description ?? null;
  if (Array.isArray(r.tags)) patch.tags = r.tags.filter((t): t is string => typeof t === "string");
  if (r.docId === null || typeof r.docId === "string") patch.docId = r.docId ?? null;
  const file = await updateFileMetadata(id, patch);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ file });
}

// DELETE /api/files/:id
export async function DELETE(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const ok = await deleteFile(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
