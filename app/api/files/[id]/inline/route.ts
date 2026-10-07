import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFileWithData } from "@/lib/files";

interface RouteCtx { params: Promise<{ id: string }> }

const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "application/pdf", "text/plain", "text/csv", "application/json"]);

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
  // Only types a browser renders WITHOUT running anything are served inline
  // on the app origin. An uploaded .html or .svg opened in a tab would run
  // its scripts as the signed-in user (stored XSS — code review 2026-10-07),
  // so anything else downloads; <img>/<iframe> previews of the allowed types
  // are unaffected. nosniff stops a browser guessing a type we did not send.
  const type = (file.mimeType || "").toLowerCase().split(";")[0].trim();
  const inline = INLINE_TYPES.has(type);
  // Cast sidesteps the lib's over-strict ArrayBufferLike generic; file.data is
  // a real ArrayBuffer-backed Buffer and a valid response body at runtime.
  return new NextResponse(file.data as unknown as BodyInit, {
    headers: {
      "Content-Type": inline ? type : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "Content-Length": String(file.sizeBytes),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
