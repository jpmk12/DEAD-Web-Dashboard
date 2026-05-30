import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  listFiles,
  createFile,
  getQuotaUsage,
  MAX_FILE_SIZE_BYTES,
  MAX_TOTAL_SIZE_BYTES,
} from "@/lib/files";

export const dynamic = "force-dynamic";
// Large multipart body — opt the route out of the default 1MB cap.
export const maxDuration = 60;

// GET /api/files — list every file's metadata (no blob bodies) plus quota.
// POST /api/files — multipart upload, optional docId / description / tags.

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const docId = url.searchParams.get("docId") ?? undefined;
  const [files, quota] = await Promise.all([
    listFiles({ docId }),
    getQuotaUsage(),
  ]);
  return NextResponse.json({ files, quota });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "Multipart parse failed" }, { status: 400 }); }

  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  // Per-file size enforcement before pulling bytes into memory.
  if (fileEntry.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({
      error: `File too large — limit is ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB`,
      sizeBytes: fileEntry.size,
      maxBytes: MAX_FILE_SIZE_BYTES,
    }, { status: 413 });
  }

  // Aggregate quota enforcement — fetch usage AFTER per-file check so we
  // don't run a count when the per-file limit already rejected.
  const quota = await getQuotaUsage();
  if (quota.usedBytes + fileEntry.size > MAX_TOTAL_SIZE_BYTES) {
    return NextResponse.json({
      error: `Storage quota exceeded — ${Math.round(quota.usedBytes / 1024 / 1024)}/${Math.round(MAX_TOTAL_SIZE_BYTES / 1024 / 1024)} MB used. Delete some files first.`,
      usedBytes: quota.usedBytes,
      limitBytes: MAX_TOTAL_SIZE_BYTES,
    }, { status: 413 });
  }

  const bytes = Buffer.from(await fileEntry.arrayBuffer());

  // Optional metadata accompanying the upload.
  const description = typeof form.get("description") === "string" ? String(form.get("description")) : undefined;
  const docId = typeof form.get("docId") === "string" && String(form.get("docId")).length > 0
    ? String(form.get("docId"))
    : undefined;
  const tagsRaw = form.get("tags");
  const tags = typeof tagsRaw === "string"
    ? tagsRaw.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
    : undefined;

  try {
    const file = await createFile({
      filename: fileEntry.name || "untitled",
      mimeType: fileEntry.type || "application/octet-stream",
      data: bytes,
      description,
      tags,
      docId,
    });
    return NextResponse.json({ file });
  } catch (err) {
    console.error("file upload failed:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
