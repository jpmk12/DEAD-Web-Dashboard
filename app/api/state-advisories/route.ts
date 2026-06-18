import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStateAdvisories, diagnoseStateAdvisories } from "@/lib/stateAdvisories";

export const dynamic = "force-dynamic";

// NEO / evacuation watch: U.S. State Dept Level-4 + embassy-departure advisories,
// AOR-tagged. Cached 30 min in the lib. Surfaced in the Glance "Global Reach
// Watch" card. `?debug=1` (owner only) reports feed reachability + parse health.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ advisories: [] }, { status: 401 });

  if (new URL(request.url).searchParams.get("debug") === "1") {
    const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!owner || session.user.email?.toLowerCase() !== owner) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ diag: await diagnoseStateAdvisories() });
  }

  const advisories = await getStateAdvisories();
  return NextResponse.json({ advisories });
}
