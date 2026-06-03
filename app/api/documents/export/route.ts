import { NextResponse } from "next/server";
import { format } from "date-fns";
import JSZip from "jszip";
import { auth } from "@/lib/auth";
import { listDocuments, getDocument } from "@/lib/documents";
import { buildMarkdownExport, safeFilename } from "@/lib/documentExport";

// GET /api/documents/export — all docs (active + archived) as a zip of
// markdown files. Archived docs are tucked under archived/ inside the zip
// so the user can easily skip them when reviewing.
//
// Default limit 1000 docs to keep memory bounded; query param ?archived=1
// flips to just archived, ?archived=0 to just active.
//
// jszip builds in-memory then we return the Uint8Array. For our typical
// scale (low thousands of docs, small content each) this stays well under
// the platform's memory budget. If it ever explodes we can switch to a
// streaming writer.

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const archivedParam = url.searchParams.get("archived");

  const zip = new JSZip();
  // Active docs.
  if (archivedParam !== "1") {
    const summaries = await listDocuments({ archived: false, limit: 1000 });
    for (const s of summaries) {
      const doc = await getDocument(s.id);
      if (!doc) continue;
      zip.file(safeFilename(doc), buildMarkdownExport(doc));
    }
  }
  // Archived docs go under their own subfolder when both sets are included.
  if (archivedParam !== "0") {
    const summaries = await listDocuments({ archived: true, limit: 1000 });
    for (const s of summaries) {
      const doc = await getDocument(s.id);
      if (!doc) continue;
      zip.file(`archived/${safeFilename(doc)}`, buildMarkdownExport(doc));
    }
  }

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const stamp = format(new Date(), "yyyyMMdd-HHmm");
  // `bytes` is a real ArrayBuffer-backed Uint8Array; the cast only sidesteps
  // the lib's over-strict ArrayBufferLike (incl. SharedArrayBuffer) generic.
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="docs-${stamp}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
