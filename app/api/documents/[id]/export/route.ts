import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDocument } from "@/lib/documents";
import { buildMarkdownExport, safeFilename } from "@/lib/documentExport";

interface RouteCtx { params: Promise<{ id: string }> }

// GET /api/documents/:id/export — single doc as markdown with YAML
// frontmatter. Returns text/markdown with a Content-Disposition that the
// browser uses to drive a download.
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = buildMarkdownExport(doc);
  const filename = safeFilename(doc);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
