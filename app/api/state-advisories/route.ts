import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStateAdvisories } from "@/lib/stateAdvisories";

export const dynamic = "force-dynamic";

// NEO / evacuation watch: U.S. State Dept Level-4 + embassy-departure advisories,
// AOR-tagged. Cached 30 min in the lib. Surfaced in the Glance "Global Reach
// Watch" card.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ advisories: [] }, { status: 401 });
  const advisories = await getStateAdvisories();
  return NextResponse.json({ advisories });
}
