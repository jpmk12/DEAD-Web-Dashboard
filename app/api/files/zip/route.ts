import { NextResponse } from "next/server";
import JSZip from "jszip";
import { auth } from "@/lib/auth";
import { getFilesWithData } from "@/lib/files";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/files/zip?ids=a,b,c — the selected files as one .zip (jszip is
// already a dependency for the docs export; STORE compression — the files are
// mostly PDFs and images, already compressed). Duplicate filenames get a
// numeric suffix so nothing silently overwrites inside the archive.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
  const files = await getFilesWithData(ids);
  if (!files.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.filename.replace(/[\\/:*?"<>|]/g, "_") || "file";
    if (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${base} (${n})${ext}`.toLowerCase())) n++;
      name = `${base} (${n})${ext}`;
    }
    used.add(name.toLowerCase());
    zip.file(name, f.data, { date: new Date(f.uploadedAt) });
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="dead-files-${stamp}.zip"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
