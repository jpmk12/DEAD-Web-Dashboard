import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyXUploadToken } from "@/lib/xUploadToken";
import { getUserPrefs } from "@/lib/userPrefs";
import { getForceProtection } from "@/lib/forceProtection";
import { getWeatherThreats, type NamedPoint } from "@/lib/severeWeather";
import { getAllStateAdvisories } from "@/lib/stateAdvisories";
import { activeWarningProblems } from "@/lib/warningProblems";
import { assessWarning } from "@/lib/warningAssess";

export const dynamic = "force-dynamic";

// Escalation check for out-of-app alerting — the transport-agnostic half of
// "the app comes to you". Returns the CURRENT alert-worthy conditions with
// STABLE ids; the caller (the capture extension's alarm poll, later a service
// worker) keeps a seen-set and notifies only on new ids — so the server needs
// no per-client watermark state. Reuses the exact predicates Glance already
// renders: force-protection RED (worse when freshly escalated), life-
// threatening/extreme weather at tracked points, ordered-departure advisories,
// and I&W boards at warning/alert.
//
// Auth: interactive session OR the per-user capture bearer token (the
// extension polls with the token it already holds; read-only summary data).

export interface AlertItem {
  id: string;                 // stable across polls while the condition holds
  severity: "red" | "amber";
  kind: "force" | "weather" | "neo" | "warning";
  title: string;
  sub: string;
}

const TTL = 5 * 60 * 1000;
let cache: { at: number; body: { now: number; alerts: AlertItem[] } } | null = null;

export async function GET(req: Request) {
  const session = await auth();
  let authed = Boolean(session?.accessToken);
  if (!authed) {
    const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (m) authed = Boolean(await verifyXUploadToken(m[1].trim()).catch(() => null));
  }
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (cache && Date.now() - cache.at < TTL) return NextResponse.json(cache.body);

  const alerts: AlertItem[] = [];
  const prefs = await getUserPrefs().catch(() => null);

  // Force-protection RED (escalations flagged in the title).
  try {
    const fp = await getForceProtection(prefs?.countriesOfInterest ?? [], prefs?.forceLocations ?? []);
    for (const a of fp.assessments.filter((x) => x.composite === "red")) {
      const escalated = !!a.previousComposite;
      alerts.push({
        id: `force-${a.label}-red`,
        severity: "red",
        kind: "force",
        title: `${escalated ? "⬆ " : ""}Force protection RED — ${a.label}`,
        sub: a.topDriver,
      });
    }
  } catch { /* feed down → no force alerts this cycle */ }

  // Life-threatening / extreme weather at home + tracked points.
  try {
    const locations: NamedPoint[] = [];
    if (prefs?.localLat != null && prefs?.localLon != null) locations.push({ label: prefs.localCity || "Home", lat: prefs.localLat, lon: prefs.localLon });
    for (const t of prefs?.trackedLocations ?? []) locations.push({ label: t.label, lat: t.lat, lon: t.lon });
    if (locations.length) {
      const wx = await getWeatherThreats(locations);
      for (const t of wx.threats.filter((x) => x.lifeThreatening || x.severity === "Extreme")) {
        alerts.push({
          id: `wx-${t.id}`,
          severity: "red",
          kind: "weather",
          title: `Severe weather — ${t.event}`,
          sub: t.locations.join(", "),
        });
      }
    }
  } catch { /* ignore */ }

  // In-effect ordered departures (the classic NEO trigger).
  try {
    const adv = await getAllStateAdvisories();
    for (const a of adv.filter((x) => x.orderedDeparture)) {
      alerts.push({
        id: `neo-${a.country}-ordered`,
        severity: "red",
        kind: "neo",
        title: `Ordered departure — ${a.country}`,
        sub: "State Dept ordered-departure advisory in effect",
      });
    }
  } catch { /* ignore */ }

  // I&W boards at warning/alert (calm/watch stay quiet — color is earned).
  try {
    const problems = await activeWarningProblems();
    for (const p of problems) {
      const a = await assessWarning(p.def.id).catch(() => null);
      if (a && (a.level === "warning" || a.level === "alert")) {
        alerts.push({
          id: `iw-${p.def.id}-${a.level}`,
          severity: a.level === "alert" ? "red" : "amber",
          kind: "warning",
          title: `I&W ${a.level.toUpperCase()} — ${p.def.label}`,
          sub: a.drivers?.[0]?.description?.slice(0, 160) ?? "anomaly over baseline",
        });
      }
    }
  } catch { /* ignore */ }

  const body = { now: Date.now(), alerts };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
