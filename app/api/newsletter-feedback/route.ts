import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recordOpen, recordDeepDive, recordFeedback, normalizeSubject, setDismissed, setKept } from "@/lib/newsletterPrefs";

const MAX_SUBJECT_LENGTH = 500;
const VALID_ACTIONS = new Set(["opened", "deep_dive", "useful", "not_useful"]);
// Id-only actions that sync the cross-device hide/keep sets (no subject needed).
const ID_ACTIONS = new Set(["hide", "show", "keep", "unkeep"]);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (Number(request.headers.get("content-length") ?? "0") > 5_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { id, subject, action } = body as Record<string, unknown>;

  // Hide/keep sync is keyed only by the newsletter id — no subject required.
  if (typeof action === "string" && ID_ACTIONS.has(action)) {
    if (typeof id !== "string" || !id || id.length > 256) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    if (action === "hide") await setDismissed(id, true);
    else if (action === "show") await setDismissed(id, false);
    else if (action === "keep") await setKept(id, true);
    else await setKept(id, false);
    return NextResponse.json({ ok: true });
  }

  if (typeof subject !== "string" || !subject) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return NextResponse.json({ error: "subject too long" }, { status: 400 });
  }

  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (action === "opened" || action === "deep_dive") {
    // Guard against empty normalized keys corrupting openCounts
    if (!normalizeSubject(subject)) {
      return NextResponse.json({ error: "subject invalid" }, { status: 400 });
    }
    if (action === "deep_dive") await recordDeepDive(subject);
    else await recordOpen(subject);
  } else {
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    await recordFeedback(id, action as "useful" | "not_useful");
  }

  return NextResponse.json({ ok: true });
}
