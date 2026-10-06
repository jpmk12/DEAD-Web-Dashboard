import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { setEmailPref } from "@/lib/emailPrefs";
import type { EmailPriority } from "@/lib/types";

export const dynamic = "force-dynamic";

// The user's own call on ONE email (REVIEW-2026-10 E1/E2).
//   POST { id, accountEmail, priority?: "High"|"Medium"|"Low"|null, keep?: boolean,
//          priorityModel?, from?, subject? } → { ok }
// `priority` null clears the override; `priorityModel` is what the model
// (after VIP/mute) had said, so the write is also a correction the learning
// layer can read. Per user — a crew member's keep is their own.

const VALID = new Set(["High", "Medium", "Low"]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userEmail = normEmail(session.user?.email);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const id = typeof body.id === "string" ? body.id : "";
  const accountEmail = normEmail(typeof body.accountEmail === "string" ? body.accountEmail : "");
  if (!/^[a-zA-Z0-9]{6,32}$/.test(id)) return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  if (!accountEmail) return NextResponse.json({ error: "accountEmail required" }, { status: 400 });

  let prioritySet: EmailPriority | null | undefined = undefined;
  if (body.priority === null) prioritySet = null;
  else if (typeof body.priority === "string") {
    if (!VALID.has(body.priority)) return NextResponse.json({ error: "priority must be High, Medium or Low" }, { status: 400 });
    prioritySet = body.priority as EmailPriority;
  }
  const keep = typeof body.keep === "boolean" ? body.keep : undefined;
  if (prioritySet === undefined && keep === undefined) return NextResponse.json({ error: "nothing to set" }, { status: 400 });

  const priorityModel = typeof body.priorityModel === "string" && VALID.has(body.priorityModel) ? (body.priorityModel as EmailPriority) : undefined;
  const from = typeof body.from === "string" ? body.from.replace(/[\n\r]/g, " ").slice(0, 255) : undefined;
  const subject = typeof body.subject === "string" ? body.subject.replace(/[\n\r]/g, " ").slice(0, 255) : undefined;

  try {
    await setEmailPref(userEmail, { accountEmail, messageId: id, prioritySet, keep, priorityModel, sender: from, subject });
  } catch (err) {
    console.error("email pref write failed:", err);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
