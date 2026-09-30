import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyXUploadToken } from "@/lib/xUploadToken";
import { computeAlerts } from "@/lib/alerts";
import { dispatchPush } from "@/lib/pushDispatch";
import { touchDailySeries } from "@/lib/dailyHeartbeat";

export const dynamic = "force-dynamic";

// Escalation check for out-of-app alerting. The list itself lives in
// lib/alerts.ts (stable ids, 5-min cache, no per-client watermark); this route
// is the door for pollers — the capture extension, a dashboard tab's heartbeat,
// an installed PWA's periodic sync — and every call ALSO drives web-push
// dispatch (rate-limited in lib/pushDispatch.ts), which is the only way pushes
// go out on a host with no cron.
//
// Auth: interactive session OR the per-user capture bearer token (the
// extension polls with the token it already holds; read-only summary data).

export async function GET(req: Request) {
  const session = await auth();
  let authed = Boolean(session?.accessToken);
  if (!authed) {
    const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (m) authed = Boolean(await verifyXUploadToken(m[1].trim()).catch(() => null));
  }
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await computeAlerts();
  // Fire-and-forget: the poller should not wait on N push sends.
  dispatchPush(body.alerts).catch(() => {});
  // The same poll keeps the daily series observed on days nobody opens the
  // dashboard (lib/dailyHeartbeat — rate-limited, background, no model call).
  touchDailySeries();
  return NextResponse.json(body);
}
