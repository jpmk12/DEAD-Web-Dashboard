import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMemory, saveMemory, clearMemory } from "@/lib/userMemory";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const memory = await getMemory();
  return NextResponse.json({ memory });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 20_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const raw = body as { content?: unknown };
  const content = typeof raw.content === "string" ? raw.content : "";
  await saveMemory(content);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearMemory();
  return NextResponse.json({ ok: true });
}
