import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  listDocuments,
  createDocument,
  recordExternalLink,
  type LinkTargetType,
} from "@/lib/documents";
import { isDocType } from "@/lib/docTypes";

export const dynamic = "force-dynamic";

const VALID_LINK_TYPES = new Set<LinkTargetType>(["doc", "article", "email", "event"]);

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.slice(0, 200) ?? undefined;
  const tag = url.searchParams.get("tag")?.slice(0, 64) ?? undefined;
  const pinnedOnly = url.searchParams.get("pinned") === "1";
  const archived = url.searchParams.get("archived") === "1";

  const docs = await listDocuments({ search, tag, pinnedOnly, archived });
  return NextResponse.json({ docs });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 250_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const raw = body as {
    title?: unknown; content?: unknown; tags?: unknown; aliases?: unknown;
    collection?: unknown; docType?: unknown; props?: unknown;
    // Optional link recorded at creation time (e.g. "save article to notes").
    link?: { type?: unknown; id?: unknown; title?: unknown };
  };

  const title = typeof raw.title === "string" ? raw.title : "Untitled";
  const content = typeof raw.content === "string" ? raw.content : "";
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [];
  const aliases = Array.isArray(raw.aliases) ? raw.aliases.filter((t): t is string => typeof t === "string") : [];
  const collection = typeof raw.collection === "string" ? raw.collection : null;
  const docType = isDocType(raw.docType) ? raw.docType : "note";
  const props = raw.props && typeof raw.props === "object" && !Array.isArray(raw.props)
    ? Object.fromEntries(Object.entries(raw.props as Record<string, unknown>).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]))
    : {};

  const doc = await createDocument({ title, content, tags, aliases, collection, docType, props });

  if (raw.link && typeof raw.link === "object") {
    const t = raw.link.type;
    const id = raw.link.id;
    const tt = raw.link.title;
    if (typeof t === "string" && VALID_LINK_TYPES.has(t as LinkTargetType) && typeof id === "string" && id) {
      await recordExternalLink(
        doc.id,
        t as LinkTargetType,
        id,
        typeof tt === "string" ? tt : undefined
      );
    }
  }

  return NextResponse.json({ doc });
}
