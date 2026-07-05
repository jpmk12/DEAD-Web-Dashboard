import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDocGraph } from "@/lib/documents";

export const dynamic = "force-dynamic";

// GET /api/documents/graph?id=<docId>&depth=1|2 — the local link
// neighbourhood for the Docs graph view: nodes (id/title/type/depth) +
// doc-edges (from/to/relation/note), capped server-side.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const depth = url.searchParams.get("depth") === "2" ? 2 : 1;

  const graph = await getDocGraph(id, depth);
  if (!graph) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(graph);
}
