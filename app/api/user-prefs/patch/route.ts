import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { patchPrefScalars } from "@/lib/userPrefs";
import { clearBriefingCacheFor } from "@/lib/briefingCache";
import { isValidTz } from "@/lib/worldClocks";

export const dynamic = "force-dynamic";

// POST { timezone?, timezoneMode?, localCity?, localLat?, localLon? } — the
// personal scalars an inline control changes on its own (REVIEW-2026-10
// §12: the zone pin on the Glance / Calendar zone label, "set home" on the
// Weather tab). Any allowlisted user, their own values. Validated field by
// field; an absent field is untouched (unlike the full POST, which rebuilds
// the row). The brief is day-cached per zone, so it is dropped for the user.
export async function POST(req: Request) {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if ("timezoneMode" in body) {
    if (body.timezoneMode !== "auto" && body.timezoneMode !== "pinned") return NextResponse.json({ error: "timezoneMode must be auto or pinned" }, { status: 400 });
    patch.timezoneMode = body.timezoneMode;
  }
  if ("timezone" in body) {
    const tz = typeof body.timezone === "string" ? body.timezone.trim().slice(0, 50) : "";
    if (!tz || !isValidTz(tz)) return NextResponse.json({ error: "timezone is not a valid IANA zone" }, { status: 400 });
    patch.timezone = tz;
  }
  if ("localCity" in body) patch.localCity = String(body.localCity ?? "").trim().slice(0, 100);
  if ("localLat" in body || "localLon" in body) {
    const lat = body.localLat == null ? null : Number(body.localLat);
    const lon = body.localLon == null ? null : Number(body.localLon);
    const okLat = lat === null || (Number.isFinite(lat) && Math.abs(lat) <= 90);
    const okLon = lon === null || (Number.isFinite(lon) && Math.abs(lon) <= 180);
    if (!okLat || !okLon) return NextResponse.json({ error: "localLat / localLon out of range" }, { status: 400 });
    patch.localLat = lat; patch.localLon = lon;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  try {
    await patchPrefScalars(email, patch);
    clearBriefingCacheFor(email).catch(() => {});
    return NextResponse.json({ ok: true, applied: Object.keys(patch) });
  } catch (err) {
    console.error("user-prefs patch failed:", err);
    return NextResponse.json({ error: "Could not save — database error" }, { status: 500 });
  }
}
