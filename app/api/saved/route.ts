import { NextResponse } from "next/server";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { getSaved, addSaved, removeSaved } from "@/lib/saved";
import { SavedItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await getSaved(normEmail(session.user?.email));
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const item = body as Partial<SavedItem>;
  if (!item.id || !item.title || !item.type) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const safe: SavedItem = {
    id: String(item.id).slice(0, 200),
    type: item.type === "newsletter-bullet" ? "newsletter-bullet" : "article",
    title: String(item.title ?? "").slice(0, 500),
    content: String(item.content ?? "").slice(0, 2000),
    source: String(item.source ?? "").slice(0, 100),
    link: item.link ? String(item.link).slice(0, 500) : undefined,
    savedAt: new Date().toISOString(),
  };

  await addSaved(normEmail(session.user?.email), safe);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await removeSaved(normEmail(session.user?.email), String(id).slice(0, 200));
  return NextResponse.json({ ok: true });
}
