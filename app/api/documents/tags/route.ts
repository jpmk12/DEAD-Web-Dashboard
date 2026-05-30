import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listAllTags, updateTagAcrossDocs } from "@/lib/documents";

// Read: aggregate of every tag used across the user's documents, with the
// count of docs carrying each. Drives the Manage tags modal.
//
// Mutations: a single endpoint handling rename / merge / delete since they
// all reduce to "replace tag from with tag to (or null)" across the doc set.

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const tags = await listAllTags();
    return NextResponse.json({ tags });
  } catch (err) {
    console.error("listAllTags failed:", err);
    return NextResponse.json({ error: "Failed to load tags" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = body as { op?: unknown; from?: unknown; to?: unknown };
  if (typeof r.op !== "string") return NextResponse.json({ error: "op required" }, { status: 400 });
  const from = typeof r.from === "string" ? r.from.trim().slice(0, 64) : "";
  if (!from) return NextResponse.json({ error: "from required" }, { status: 400 });

  try {
    if (r.op === "rename" || r.op === "merge") {
      const to = typeof r.to === "string" ? r.to.trim().slice(0, 64) : "";
      if (!to) return NextResponse.json({ error: "to required" }, { status: 400 });
      if (to === from) return NextResponse.json({ error: "from and to are equal" }, { status: 400 });
      const result = await updateTagAcrossDocs(from, to);
      return NextResponse.json(result);
    }
    if (r.op === "delete") {
      const result = await updateTagAcrossDocs(from, null);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (err) {
    console.error("tag op failed:", err);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
