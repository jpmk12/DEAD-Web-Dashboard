import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFileWithData } from "@/lib/files";

interface RouteCtx { params: Promise<{ id: string }> }

// GET /api/files/:id/inline — serves the file with inline disposition so
// browser image / pdf / text viewers can render it in place rather than
// triggering a download. Same auth gate as the regular download path.
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const file = await getFileWithData(id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const safeName = file.filename.replace(/[\r\n"]/g, "");
  return new NextResponse(file.data, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Content-Length": String(file.sizeBytes),
      "Cache-Control": "private, max-age=300",
    },
  });
}
