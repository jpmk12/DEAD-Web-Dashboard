import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBacklinks, type LinkTargetType } from "@/lib/documents";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set<LinkTargetType>(["doc", "article", "email", "event"]);

// "What docs reference this external object?" Called by article cards,
// email cards, calendar events so they can show "you have N notes on this."
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!VALID_TYPES.has(type as LinkTargetType) || !id) {
    return NextResponse.json({ error: "type and id required" }, { status: 400 });
  }

  const docs = await getBacklinks(type as LinkTargetType, id.slice(0, 255));
  return NextResponse.json({ docs });
}
