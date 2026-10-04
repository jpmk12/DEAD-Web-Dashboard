import type { NextRequest } from "next/server";
import { beginSecondaryOAuth } from "@/lib/secondaryStart";

export const dynamic = "force-dynamic";

// Clean, never-before-seen path for the secondary-Gmail OAuth hop — see
// lib/secondaryStart.ts for why it replaced `?step=initiate` as the link
// target (a phone's cached copy of the old redirect was replaying a stale
// authorize URL). The legacy query form still works and routes here.
export async function GET(request: NextRequest) {
  return beginSecondaryOAuth(request);
}
