import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDocument, appendToDocument, recordExternalLink, type LinkTargetType } from "@/lib/documents";
import { appendEntry } from "@/lib/docAppend";

export const dynamic = "force-dynamic";

interface RouteCtx { params: Promise<{ id: string }> }
const VALID_LINK_TYPES = new Set<LinkTargetType>(["doc", "article", "email", "event"]);

// POST /api/documents/:id/append — the Append-to command's write
// (REVIEW-2026-10 D4). Body: { date, text, source, sourceTitle?, sourceUrl?,
// thread?, link?: { type, id, title } }. A snapshot is taken first so the
// entry is undoable from History; the source is recorded as a link so the
// log shows in the article's / email's backlinks.
export async function POST(request: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const r = (body ?? {}) as { date?: unknown; text?: unknown; source?: unknown; sourceTitle?: unknown; sourceUrl?: unknown; thread?: unknown; link?: { type?: unknown; id?: unknown; title?: unknown } };
  const text = typeof r.text === "string" ? r.text.trim().slice(0, 20_000) : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  const date = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : new Date().toISOString().slice(0, 10);
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const next = appendEntry(doc.content, {
    date, text,
    source: typeof r.source === "string" ? r.source.slice(0, 120) : "note",
    sourceTitle: typeof r.sourceTitle === "string" ? r.sourceTitle.slice(0, 240) : undefined,
    sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl.slice(0, 2000) : undefined,
    thread: typeof r.thread === "string" ? r.thread.slice(0, 80) : undefined,
  });
  const updated = await appendToDocument(id, next);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (r.link && typeof r.link === "object") {
    const t = r.link.type, lid = r.link.id;
    if (typeof t === "string" && VALID_LINK_TYPES.has(t as LinkTargetType) && typeof lid === "string" && lid) {
      await recordExternalLink(id, t as LinkTargetType, lid, typeof r.link.title === "string" ? r.link.title : undefined).catch(() => {});
    }
  }
  return NextResponse.json({ doc: updated });
}
