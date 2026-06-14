import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getInformPoints, type InformProduct } from "@/lib/inform";

export const dynamic = "force-dynamic";

// INFORM anticipatory layers for the Crisis map:
//   ?product=risk     → structural country crisis risk (0-10), annual baseline
//   ?product=severity → current crisis severity (monthly)
// Country-level points { country, iso3, score, lat, lon }. Keyless (JRC DRMKC).
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ points: [] }, { status: 401 });
  const p = new URL(request.url).searchParams.get("product");
  const product: InformProduct = p === "severity" ? "severity" : "risk";
  const points = await getInformPoints(product).catch(() => []);
  return NextResponse.json({ points, product, ok: points.length > 0 }, { headers: { "Cache-Control": "private, max-age=300" } });
}
