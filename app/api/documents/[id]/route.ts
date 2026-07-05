import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getDocument,
  updateDocument,
  deleteDocument,
  getOutboundLinks,
  getBacklinks,
} from "@/lib/documents";
import { isDocType } from "@/lib/docTypes";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fold outbound + inbound link counts into the doc response so the editor
  // can render the backlinks footer without a second round trip.
  const [outbound, backlinks] = await Promise.all([
    getOutboundLinks(id),
    getBacklinks("doc", id),
  ]);

  return NextResponse.json({ doc, outbound, backlinks });
}

export async function PATCH(request: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 250_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const raw = body as { title?: unknown; content?: unknown; tags?: unknown; aliases?: unknown; collection?: unknown; docType?: unknown; props?: unknown; pinned?: unknown; archived?: unknown };
  const patch: Parameters<typeof updateDocument>[1] = {};
  if (typeof raw.title === "string") patch.title = raw.title;
  if (typeof raw.content === "string") patch.content = raw.content;
  if (Array.isArray(raw.tags)) patch.tags = raw.tags.filter((t): t is string => typeof t === "string");
  if (Array.isArray(raw.aliases)) patch.aliases = raw.aliases.filter((t): t is string => typeof t === "string");
  // collection: string sets, null clears, absent leaves alone.
  if (typeof raw.collection === "string" || raw.collection === null) patch.collection = raw.collection;
  if (isDocType(raw.docType)) patch.docType = raw.docType;
  if (raw.props && typeof raw.props === "object" && !Array.isArray(raw.props)) {
    patch.props = Object.fromEntries(Object.entries(raw.props as Record<string, unknown>).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]));
  }
  if (typeof raw.pinned === "boolean") patch.pinned = raw.pinned;
  if (typeof raw.archived === "boolean") patch.archived = raw.archived;

  const doc = await updateDocument(id, patch);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ doc });
}

export async function DELETE(_request: Request, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const ok = await deleteDocument(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
