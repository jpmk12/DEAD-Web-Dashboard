import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listDocuments } from "@/lib/documents";

export const dynamic = "force-dynamic";

// GET /api/documents/titles — the lightweight name index: every active doc's
// id + title + aliases. Powers the unlinked-mentions scanner and hover-preview
// title→id resolution without shipping content.
export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const docs = await listDocuments({ limit: 1000 });
  return NextResponse.json({
    docs: docs.map((d) => ({ id: d.id, title: d.title, aliases: d.aliases, collection: d.collection, docType: d.docType })),
  });
}
