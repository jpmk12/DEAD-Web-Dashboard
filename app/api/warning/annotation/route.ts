import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { listAnnotations, createAnnotation, resolveAnnotation, deleteOpenAnnotation } from "@/lib/annotationStore";
import { sortAnnotations, validateAnnotationDraft } from "@/lib/annotations";

export const dynamic = "force-dynamic";

// I&W analyst annotations — a dated note on a board or one indicator. Shared
// per problem like the decision log and attributed by email.
//
// GET    ?problemId=…                         → that problem's notes, open first
// POST   {problemId, indicatorId?, note}      → add a note
// PATCH  {id}                                 → resolve (one-way; any crew member)
// DELETE ?id=…                                → only your own, only while open

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const problemId = new URL(req.url).searchParams.get("problemId")?.trim();
  if (!problemId) return NextResponse.json({ error: "problemId is required" }, { status: 400 });
  const entries = await listAnnotations(problemId);
  if (!entries) return NextResponse.json({ error: "Notes unavailable — the store did not answer.", unavailable: true }, { status: 503 });
  return NextResponse.json({ entries: sortAnnotations(entries) });
}

export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const err = validateAnnotationDraft(body ?? {});
  if (err) return NextResponse.json({ error: err }, { status: 422 });

  const entry = await createAnnotation({
    problemId: String(body!.problemId),
    indicatorId: typeof body!.indicatorId === "string" && body!.indicatorId ? String(body!.indicatorId) : null,
    note: String(body!.note).trim(),
    by: email,
  });
  if (!entry) return NextResponse.json({ error: "Could not save the note." }, { status: 500 });
  return NextResponse.json({ entry });
}

export async function PATCH(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await resolveAnnotation(id, email);
  if (!ok) return NextResponse.json({ error: "Already resolved, or not found." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const ok = await deleteOpenAnnotation(id, email);
  if (!ok) return NextResponse.json({ error: "Not yours, or already resolved." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
