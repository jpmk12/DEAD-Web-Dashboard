import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { diagnoseNotams } from "@/lib/notams";

export const dynamic = "force-dynamic";

// Owner-only diagnostic for the DoD DAIP NOTAM feed. Probes TLS + the actual
// POST (with verification on AND off) so we can tell a fixable cert-chain gap
// from an unfixable IP/client-cert block. No secrets exposed.
export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || (process.env.OWNER_EMAIL && email !== process.env.OWNER_EMAIL)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const icao = new URL(req.url).searchParams.get("icao") || "KADW";
  try {
    return NextResponse.json(await diagnoseNotams(icao.toUpperCase().slice(0, 4)));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "diag failed" }, { status: 500 });
  }
}
