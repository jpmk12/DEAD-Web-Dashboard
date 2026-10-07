import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail, isOwner } from "@/lib/allowlist";
import { getTrackingRegistry, searchTrackCandidates, buildTrackRequest, applyTrackRequest, restoreExclusion, applyOwnForceOps, type TrackBody } from "@/lib/trackingOps";

export const dynamic = "force-dynamic";

// The ONE door for "track this" (REVIEW-2026-10 §7).
//   GET            → { registry, canEdit }   everything tracked, with roles
//   GET ?q=amman   → { candidates }          airfields + countries matching
//   POST { op: "track", kind, …, roles }     → owner: plan + save, returns
//                                              { changes, warnings, undo, registry }
//   POST { op: "restore", id }               → owner: lift an exclusion
//   POST { op: "role", ops: [{icao, role}], then? }
//                                            → owner: hub / spoke / none for
//                                              own-force fields (the command
//                                              board's role switch); `then` is
//                                              an optional track request run
//                                              on the same write (the ✕ on a
//                                              hub/spoke). Returns the same
//                                              { changes, warnings, undo }.
// Tracking lists are team config, so writes are owner-gated like the
// user-prefs POST and the Mission Profile.

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const email = normEmail(session.user?.email);
  const q = new URL(req.url).searchParams.get("q");
  try {
    if (q != null) {
      return NextResponse.json({ candidates: await searchTrackCandidates(q) });
    }
    return NextResponse.json({ registry: await getTrackingRegistry(), canEdit: isOwner(email) });
  } catch (err) {
    console.error("track GET failed:", err);
    return NextResponse.json({ error: "Tracking registry unavailable — database error." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(normEmail(session.user?.email))) {
    return NextResponse.json({ error: "Tracking is shared team config — owner only." }, { status: 403 });
  }
  let body: { op?: unknown; id?: unknown; ops?: unknown; then?: unknown } & TrackBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    if (body.op === "role") {
      const then = body.then && typeof body.then === "object" ? (body.then as TrackBody) : null;
      const out = await applyOwnForceOps(body.ops ?? { icao: body.icao, role: (body as { role?: unknown }).role }, then);
      if (typeof out === "string") return NextResponse.json({ error: out }, { status: 400 });
      const { undoRole, ...rest } = out;
      return NextResponse.json({ ok: true, ...rest, undo: undoRole });
    }
    if (body.op === "restore") {
      const id = String(body.id ?? "").trim().slice(0, 60);
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await restoreExclusion(id)) });
    }
    if (body.op === "track" || body.op == null) {
      const request = await buildTrackRequest(body);
      if (typeof request === "string") return NextResponse.json({ error: request }, { status: 400 });
      const out = await applyTrackRequest(request);
      return NextResponse.json({ ok: true, ...out });
    }
    return NextResponse.json({ error: "op must be track | restore" }, { status: 400 });
  } catch (err) {
    console.error("track POST failed:", err);
    return NextResponse.json({ error: "Could not save — database unavailable." }, { status: 500 });
  }
}
