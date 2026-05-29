import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recordFeedback, recordOpen } from "@/lib/articlePrefs";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set(["useful", "not_useful", "opened"]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (Number(req.headers.get("content-length") ?? "0") > 5_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: { title?: unknown; source?: unknown; action?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (
    typeof body.title !== "string" ||
    typeof body.source !== "string" ||
    typeof body.action !== "string" ||
    !VALID_ACTIONS.has(body.action)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const title = body.title.slice(0, 500);
  const source = body.source.slice(0, 100);
  if (body.action === "opened") {
    await recordOpen(title, source);
  } else {
    await recordFeedback(title, source, body.action as "useful" | "not_useful");
  }
  return NextResponse.json({ ok: true });
}
