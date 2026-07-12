import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { resetSitrepCache } from "@/lib/sitrep";
import { listLimfacs, createLimfac, updateLimfacStatus, openEndLimfac, deleteLimfac, type LimfacInput } from "@/lib/limfacStore";
import type { Capability, LimfacStatus } from "@/lib/limfac";

export const dynamic = "force-dynamic";

// Commander-entered SITREP LIMFACs. SHARED per base — any allowlisted crew
// member can add / resolve, attributed to whoever entered it (squadron tool).
//   GET  ?icao=      → active LIMFACs for a base
//   POST { icao, fn, capability, driver, impact, ... } → create
//   POST { op:"status", id, status } → new/ongoing/improving/worsening/resolved
//   DELETE ?id=      → remove

async function requireBase(icao: string): Promise<boolean> {
  const prefs = await getUserPrefs().catch(() => null);
  return Boolean(prefs?.sitrepBases.some((b) => b.icao === icao.toUpperCase()));
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const icao = new URL(req.url).searchParams.get("icao")?.toUpperCase() ?? "";
  if (!/^[A-Z0-9]{4}$/.test(icao)) return NextResponse.json({ error: "icao required" }, { status: 400 });
  return NextResponse.json({ limfacs: await listLimfacs(icao).catch(() => []) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Status change (resolve / update trend).
  if (body.op === "status") {
    const id = String(body.id ?? "");
    const status = String(body.status ?? "") as LimfacStatus;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const ok = await updateLimfacStatus(id, status);
    if (!ok) return NextResponse.json({ error: "Invalid status or id" }, { status: 400 });
    resetSitrepCache();
    return NextResponse.json({ ok: true });
  }

  // "Keep active" on a stale LIMFAC — drop the passed end window (→ UFN).
  if (body.op === "extend") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const ok = await openEndLimfac(id);
    if (!ok) return NextResponse.json({ error: "id not found" }, { status: 400 });
    resetSitrepCache();
    return NextResponse.json({ ok: true });
  }

  const icao = String(body.icao ?? "").toUpperCase();
  if (!(await requireBase(icao))) return NextResponse.json({ error: "Base not configured for SITREP" }, { status: 404 });

  const input: LimfacInput = {
    icao,
    fn: String(body.fn ?? ""),
    capability: String(body.capability ?? "pmc") as Capability,
    driver: String(body.driver ?? ""),
    impact: String(body.impact ?? ""),
    mitigation: body.mitigation == null ? null : String(body.mitigation),
    ask: body.ask == null ? null : String(body.ask),
    ccir: Boolean(body.ccir),
    fromISO: body.fromISO == null ? null : String(body.fromISO),
    toISO: body.toISO == null ? null : String(body.toISO),
    enteredBy: normEmail(session.user?.email),
  };
  const created = await createLimfac(input);
  if (!created) return NextResponse.json({ error: "fn, driver and impact are required" }, { status: 400 });
  resetSitrepCache();
  return NextResponse.json({ ok: true, limfac: created });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteLimfac(id);
  resetSitrepCache();
  return NextResponse.json({ ok: true });
}
