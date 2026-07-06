import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUiState, mergeUiState } from "@/lib/uiState";
import { normEmail } from "@/lib/allowlist";

export const dynamic = "force-dynamic";

// Cross-device UI state store (see lib/uiState.ts).
//   GET  → { state }            full blob
//   POST → { patch } → { ok }   shallow-merge the patch into the blob

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = await getUiState(normEmail(session.user?.email)).catch(() => ({}));
  return NextResponse.json({ state });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (Number(request.headers.get("content-length") ?? "0") > 64_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const patch = (body as { patch?: unknown })?.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return NextResponse.json({ error: "patch object required" }, { status: 400 });
  }

  const state = await mergeUiState(normEmail(session.user?.email), patch as Record<string, unknown>).catch(() => null);
  if (!state) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
