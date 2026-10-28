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
import { getForceProtectionCached as getForceProtection } from "./forceProtectionCached";
import { getWeatherThreats, type NamedPoint } from "./severeWeather";
import { getAllStateAdvisories } from "./stateAdvisories";
import { activeWarningProblems } from "./warningProblems";
import { assessWarning } from "./warningAssess";
import { getSpectrumSummary } from "./spectrum";
import { getIodaOutageAlerts } from "./cyberSources";
import { outageAlertsFor } from "./cyberSignals";
import { getRadar, getRadarBgp, getRadarTraffic } from "./cloudflareRadar";
import { radarReadsFor, RADAR_LEVEL_ORDINAL } from "./radarSignals";
import { bgpReadsFor, BGP_LEVEL_ORDINAL } from "./radarBgp";
import { countryIso2 } from "./holidays";
import { recordSensorDay } from "./sensorStore";
import { sensorKey } from "./sensorKeys";
import { getLineReads } from "./lineReadAssemble";
import { getChokepointReads } from "./chokepointReads";
import { todayZulu, addDaysYmd } from "./missionLines";

export interface AlertItem {
  id: string;                 // stable across polls while the condition holds
  severity: "red" | "amber";
  kind: "force" | "weather" | "neo" | "warning" | "spectrum" | "line";
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

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

async function build(): Promise<AlertCheck> {
  const prefs = await getUserPrefs().catch(() => null);
  // The stages are independent, so they run AT ONCE and their alerts are
  // concatenated in a fixed order (code review 2026-10-28: run one after
  // another — force protection, weather, advisories, boards, spectrum, IODA,
  // Radar, BGP, NetFlows — a cold pass could pass a minute on a request
  // path). Each stage fails alone; a dead stage raises nothing this cycle.
  const stage = (fn: (out: AlertItem[]) => Promise<void>): Promise<AlertItem[]> => {
    const out: AlertItem[] = [];
    return fn(out).then(() => out, () => out);
  };

  const parts = await Promise.all([
  // Force-protection RED (escalations flagged in the title).
  stage(async (out) => {
    const fp = await getForceProtection(prefs?.countriesOfInterest ?? [], prefs?.forceLocations ?? []);
    for (const a of fp.assessments.filter((x) => x.composite === "red")) {
      const escalated = !!a.previousComposite;
      out.push({
        id: `force-${a.label}-red`,
        severity: "red",
        kind: "force",
        title: `${escalated ? "⬆ " : ""}Force protection RED — ${a.label}`,
        sub: a.topDriver,
      });
    }
  }),
  // Life-threatening / extreme weather at home + tracked points.
  stage(async (out) => {
    const locations: NamedPoint[] = [];
    if (prefs?.localLat != null && prefs?.localLon != null) locations.push({ label: prefs.localCity || "Home", lat: prefs.localLat, lon: prefs.localLon });
    for (const t of prefs?.trackedLocations ?? []) locations.push({ label: t.label, lat: t.lat, lon: t.lon });
    if (locations.length) {
      const wx = await getWeatherThreats(locations);
      for (const t of wx.threats.filter((x) => x.lifeThreatening || x.severity === "Extreme")) {
        out.push({
          id: `wx-${t.id}`,
          severity: "red",
          kind: "weather",
          title: `Severe weather — ${t.event}`,
          sub: t.locations.join(", "),
        });
      }
    }
  }),
  // In-effect ordered departures (the classic NEO trigger).
  stage(async (out) => {
    const adv = await getAllStateAdvisories();
    for (const a of adv.filter((x) => x.orderedDeparture)) {
      out.push({
        id: `neo-${a.country}-ordered`,
        severity: "red",
        kind: "neo",
        title: `Ordered departure — ${a.country}`,
        sub: "State Dept ordered-departure advisory in effect",
      });
    }
  }),
  // I&W boards at warning/alert (calm/watch stay quiet — color is earned).
  stage(async (out) => {
    const problems = await activeWarningProblems();
    // In parallel and bounded — this used to run the boards one after another
    // on the request path (code review 2026-10-07). A board past the wait
    // raises nothing this cycle; its assessment keeps running into the cache.
    const assessed = await Promise.all(problems.map((p) => within(assessWarning(p.def.id).catch(() => null), 15_000)));
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      const a = assessed[i];
      if (a && (a.level === "warning" || a.level === "alert")) {
        out.push({
          id: `iw-${p.def.id}-${a.level}`,
          severity: a.level === "alert" ? "red" : "amber",
          kind: "warning",
          title: `I&W ${a.level.toUpperCase()} — ${p.def.label}`,
          sub: a.drivers?.[0]?.description?.slice(0, 160) ?? "anomaly over baseline",
        });
      }
    }
  }),
  // Spectrum (REVIEW-CYBER-SPACE §4.9), four predicates with stable ids:
  // SWPC scale at 3+; PNT / cyber indicator at active or confirmed on a
  // board; KEV entry on a declared vendor; a critical connectivity outage
  // in a tracked country. Bounded: a cold summary is skipped this cycle.
  stage(async (out) => {
    const sp = await getSpectrumSummary({ maxWaitMs: 5_000 });
    if (!sp.pending) {
      for (const s of sp.spaceWx.severe) {
        const imp = sp.spaceWx.impacts.find((i) => i.led === "r") ?? sp.spaceWx.impacts[0];
        out.push({ id: `swx-${s.scale}${s.level}`, severity: s.level >= 4 ? "red" : "amber", kind: "spectrum", title: `Space weather ${s.scale}${s.level} — ${imp?.label ?? "ops impact"}`, sub: imp?.now ?? "NOAA SWPC scale at 3 or above" });
      }
      for (const [label, key, r] of [["PNT denial", "pnt", sp.pnt], ["Cyber pressure", "cyber", sp.cyber], ["Counterspace", "counterspace", sp.counterspace ?? null]] as const) {
        if (r && r.live && (r.state === "active" || r.state === "confirmed")) {
          out.push({ id: `iw-${r.problemId}-${key}-${r.state}`, severity: r.state === "confirmed" ? "red" : "amber", kind: "spectrum", title: `${label} ${r.state.toUpperCase()} — ${r.board}`, sub: r.why.slice(0, 160) });
        }
      }
      for (const h of sp.edge.hits) {
        out.push({ id: `kev-${h.cve}`, severity: h.ransomware ? "red" : "amber", kind: "spectrum", title: `KEV — ${h.vendor} ${h.product}`, sub: `${h.cve}: ${h.name.slice(0, 120)}${h.ransomware ? " · known ransomware use" : ""}` });
      }
    }
  }),
  stage(async (out) => {
    const tracked = [...(prefs?.countriesOfInterest ?? []).map((c) => c.country), ...(prefs?.forceLocations ?? []).map((l) => l.country).filter((c): c is string => !!c)];
    if (tracked.length) {
      const byCode = new Map<string, string>();
      for (const c of new Set(tracked)) { const code = countryIso2(c); if (code) byCode.set(code, c); }
      // All four outage reads start together; each is consumed in order below.
      const ioP = getIodaOutageAlerts(24);
      const radarP = getRadar();
      const bgpP = byCode.size ? getRadarBgp() : null;
      const trP = byCode.size ? getRadarTraffic([...byCode.keys()]) : null;
      for (const p of [ioP, radarP, bgpP, trP]) p?.catch(() => {});
      const io = await ioP;
      if (io.live) {
        const hits = outageAlertsFor(io.alerts, tracked);
        for (const o of hits.filter((x) => x.level === "critical")) {
          out.push({ id: `outage-${o.country}`, severity: "amber", kind: "spectrum", title: `Connectivity outage — ${o.country}`, sub: `IODA critical alert (${o.sources} source${o.sources === 1 ? "" : "s"}, 24 h)` });
        }
        // Outage series per tracked country (PLAN §7 E1): worst level ordinal
        // that day, 0 when the feed answered and named nothing — an observed
        // quiet day is a fact; a dead feed writes nothing.
        const day = new Date().toISOString().slice(0, 10);
        const LEVEL: Record<string, number> = { critical: 3, warning: 2, normal: 1 };
        for (const c of new Set(tracked)) {
          const worst = hits.filter((h) => h.country.toLowerCase() === c.toLowerCase()).reduce((m, h) => Math.max(m, LEVEL[h.level] ?? 1), 0);
          recordSensorDay(sensorKey("outage", c), day, worst).catch(() => {});
        }
      }
      // Cloudflare Radar — the second, independent outage source. An ONGOING
      // NATIONWIDE outage from a hostile or governmental cause in a tracked
      // country is RED; any other ongoing nationwide annotation is amber;
      // regional / network reads stay on the country room. Not configured or
      // dead → nothing here (the Outages cell says UNKNOWN), never a fake
      // quiet day in the series.
      const day = new Date().toISOString().slice(0, 10);
      const radar = await radarP;
      if (radar.configured && radar.live) {
        const reads = radarReadsFor(radar.outages, radar.anomalies, [...byCode.keys()], Date.now());
        for (const code of byCode.keys()) {
          const r = reads.find((x) => x.code === code);
          recordSensorDay(sensorKey("cfout", code), day, r ? RADAR_LEVEL_ORDINAL[r.level] : 0).catch(() => {});
        }
        for (const r of reads) {
          const name = byCode.get(r.code) ?? r.name;
          const nationwide = r.outages.some((o) => o.scope === "NATIONWIDE" && (o.endMs == null || o.endMs > Date.now()));
          if (r.level === "red") out.push({ id: `outage-cf-${name}`, severity: "red", kind: "spectrum", title: `Nationwide outage — ${name}`, sub: `Cloudflare Radar: ${r.why}` });
          else if (r.level === "amber" && nationwide) out.push({ id: `outage-cf-${name}`, severity: "amber", kind: "spectrum", title: `Nationwide outage — ${name}`, sub: `Cloudflare Radar: ${r.why}` });
        }
      }
      // Cloudflare Radar BGP — a HIGH-confidence, recent hijack of a tracked
      // country's prefixes is an amber alert (a routing event, not a life
      // signal — never red here); the `bgp:` series takes the day-peak level
      // ordinal. Dead or not configured → nothing written.
      if (bgpP && trP) {
        const bgp = await bgpP;
        if (bgp.configured && bgp.live) {
          const reads = bgpReadsFor(bgp.hijacks, bgp.leaks, bgp.asnInfo, [...byCode.keys()], Date.now());
          for (const code of byCode.keys()) {
            const r = reads.find((x) => x.code === code);
            recordSensorDay(sensorKey("bgp", code), day, r ? BGP_LEVEL_ORDINAL[r.level] : 0).catch(() => {});
          }
          for (const r of reads) {
            if (r.level !== "red") continue;
            const name = byCode.get(r.code) ?? r.code;
            out.push({ id: `bgp-${name}`, severity: "amber", kind: "spectrum", title: `BGP hijack — ${name}`, sub: `Cloudflare Radar: ${r.why}` });
          }
        }
        // Cloudflare NetFlows — the raw traffic. `nflow:` takes the hour-
        // matched ratio ×100 (LAST policy) only from a read that produced
        // one (learning / stale / dead write nothing); a COLLAPSED read is an
        // amber alert — raw evidence of a shutdown-class drop before (or
        // without) a curated annotation.
        const tr = await trP;
        if (tr.configured) {
          for (const [code, r] of Object.entries(tr.reads)) {
            if (!r) continue;
            // A RAW_VALUES read records its ratio; a MIN0_MAX read (what
            // production negotiates) has no ratio — it records its drop in
            // range units under its own key, so the two units never mix.
            // The collapse alert is the STATE, read whichever way (code
            // review 2026-10-28: the ratio guard made it unreachable).
            if (r.ratio != null) recordSensorDay(sensorKey("nflow", code), day, Math.round(r.ratio * 100)).catch(() => {});
            else if (r.drop != null) recordSensorDay(sensorKey("nflowdrop", code), day, Math.round(r.drop * 100)).catch(() => {});
            if (r.state === "collapsed") {
              const name = byCode.get(code) ?? code;
              out.push({ id: `traffic-cf-${name}`, severity: "amber", kind: "spectrum", title: `Internet traffic collapsed — ${name}`, sub: `Cloudflare NetFlows: ${r.why}` });
            }
          }
        }
      }
    }
  }),
  // A UKMTO-reported ACT (attack, seizure, boarding) at a strait a board
  // watches, in the last 72 h — the authority's own record, so it alerts
  // without waiting for the board to climb (code review 2026-10-28). Keyed
  // by strait + day so a second incident the same day joins the first.
  stage(async (out) => {
    const problems = await activeWarningProblems();
    const ids = [...new Set(problems.map((p) => p.geo.chokepoint?.id).filter((x): x is string => !!x))];
    if (!ids.length) return;
    const body = await within(getChokepointReads(ids), 8_000);
    for (const sig of body?.signals ?? []) {
      const l = sig.lead;
      if (!l || l.modality !== "act" || l.source !== "UKMTO") continue;
      const t = l.pubDate ? Date.parse(l.pubDate) : NaN;
      if (!Number.isFinite(t) || Date.now() - t > 72 * 3_600_000) continue;
      out.push({ id: `ukmto-${sig.id}-${new Date(t).toISOString().slice(0, 10)}`, severity: "amber", kind: "warning", title: `UKMTO — ${l.cls} reported near ${sig.name}`, sub: l.title.slice(0, 160) });
    }
  }),
  // A declared line whose read is RED today or tomorrow (code review
  // 2026-10-28: a line through a field closed NOW raised nothing). Amber at
  // the alert level — the line is the crew's own declaration, and the
  // field's own condition alerts through its own predicate. Bounded: a cold
  // line read raises nothing this cycle.
  stage(async (out) => {
    const lr = await within(getLineReads(), 6_000);
    if (!lr || !lr.reads.length) return;
    const today = todayZulu(), tomorrow = addDaysYmd(today, 1);
    for (const r of lr.reads) {
      if (r.worst !== "r" || (r.day !== today && r.day !== tomorrow)) continue;
      const lead = r.drivers[0];
      out.push({ id: `line-${r.id}-${r.day}`, severity: "amber", kind: "line", title: `Line RED — ${r.label} (${r.dayLabel})`, sub: lead ? `${lead.icao}: ${lead.text}` : r.summary });
    }
  }),
  ]);
  const alerts: AlertItem[] = parts.flat();

  const body: AlertCheck = { now: Date.now(), alerts };
  cache = { at: Date.now(), body };
  return body;
}
