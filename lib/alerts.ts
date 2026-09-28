// The escalation check — the transport-agnostic half of "the app comes to you".
//
// Server-only. Returns the CURRENT alert-worthy conditions with STABLE ids; the
// server keeps no per-client watermark, so every consumer (the capture
// extension's alarm poll, the web-push dispatcher) keeps its own seen-set and
// speaks only on new ids. Reuses the exact predicates Glance already renders:
// force-protection RED (worse when freshly escalated), life-threatening /
// extreme weather at tracked points, ordered-departure advisories, and I&W
// boards at warning/alert. Lifted out of /api/alerts/check so the push
// dispatcher can read the same list without an HTTP hop.
//
// Cached 5 min in-process — cheap to call, and calling it is what drives
// dispatch (see lib/pushDispatch.ts).

import { getUserPrefs } from "./userPrefs";
import { getForceProtection } from "./forceProtection";
import { getWeatherThreats, type NamedPoint } from "./severeWeather";
import { getAllStateAdvisories } from "./stateAdvisories";
import { activeWarningProblems } from "./warningProblems";
import { assessWarning } from "./warningAssess";

export interface AlertItem {
  id: string;                 // stable across polls while the condition holds
  severity: "red" | "amber";
  kind: "force" | "weather" | "neo" | "warning";
  title: string;
  sub: string;
}

export interface AlertCheck {
  now: number;
  alerts: AlertItem[];
}

const TTL = 5 * 60 * 1000;
let cache: { at: number; body: AlertCheck } | null = null;
let inFlight: Promise<AlertCheck> | null = null;

export async function computeAlerts(): Promise<AlertCheck> {
  if (cache && Date.now() - cache.at < TTL) return cache.body;
  if (inFlight) return inFlight;
  inFlight = build().finally(() => { inFlight = null; });
  return inFlight;
}

async function build(): Promise<AlertCheck> {
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

  const body: AlertCheck = { now: Date.now(), alerts };
  cache = { at: Date.now(), body };
  return body;
}
