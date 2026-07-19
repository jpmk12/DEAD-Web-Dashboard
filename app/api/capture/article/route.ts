import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { verifyXUploadToken } from "@/lib/xUploadToken";
import { parseArticleCapture } from "@/lib/articleCapture";
import { upsertArticle, getArticleStatus, clearArticles } from "@/lib/articleStore";

export const dynamic = "force-dynamic";

// Reader-capture ingest — a SINGLE analysis article the user manually captured
// from content they're reading via their own access (e.g. DoD MWR Libraries
// WSJ). Same auth model as x-import: interactive session OR a per-user bearer
// token (the extension's "capture this article" action). Personal-use, not a
// bulk harvester.
//   POST   dead-article JSON → validate + upsert
//   GET    → status { count, newest, sources }
//   DELETE → clear

const MAX_BODY_BYTES = 1 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  let email = session?.accessToken ? normEmail(session.user?.email) : "";
  if (!session?.accessToken) {
    const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (m) email = (await verifyXUploadToken(m[1].trim()).catch(() => null)) ?? "";
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Article too large (1 MB max)." }, { status: 413 });

  const parsed = parseArticleCapture(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    await upsertArticle(parsed.article, email);
    const status = await getArticleStatus();
    return NextResponse.json({ ok: true, title: parsed.article.title, source: parsed.article.source, total: status.count });
  } catch (err) {
    console.error("article capture failed:", err);
    return NextResponse.json({ error: "Capture failed — database unavailable." }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await getArticleStatus()); }
  catch { return NextResponse.json({ count: 0, newest: null, sources: [] }); }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearArticles().catch(() => {});
  return NextResponse.json({ ok: true });
}
