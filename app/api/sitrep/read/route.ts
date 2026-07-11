import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { logCall } from "@/lib/anthropicLog";
import { normEmail } from "@/lib/allowlist";
import { getUserPrefs } from "@/lib/userPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { assembleSitrep } from "@/lib/sitrep";
import { extractJsonObject } from "@/lib/aiJson";

export const dynamic = "force-dynamic";

// POST { icao } → the Commander's Read: a BLUF + watch items synthesized from
// the assembled SITREP (server-side — the payload comes from the same 10-min
// cache the pane reads, so this costs one model call, not a re-fetch fan-out).
// Gated on the chat AI feature; cached 15 min per base + status fingerprint.
const TTL = 15 * 60 * 1000;
const cache = new Map<string, { bluf: string[]; watch: string[]; asks: string[]; expires: number }>();

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ bluf: [], watch: [], asks: [], disabled: true });

  const prefs = await getUserPrefs().catch(() => null);
  if (prefs && !isFeatureEnabled("chat", prefs)) return NextResponse.json({ bluf: [], watch: [], asks: [], disabled: true });

  let body: { icao?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const icao = String(body.icao ?? "").trim().toUpperCase();
  const base = prefs?.sitrepBases.find((b) => b.icao === icao);
  if (!base) return NextResponse.json({ error: "Base not configured" }, { status: 404 });

  const s = await assembleSitrep(base);
  const fingerprint = [
    s.status.wx, s.status.ops, s.status.threat, s.status.infra,
    s.mission.state, s.mission.limfacs.length, s.mission.ccir.length,
    s.weather.tafWorst?.worst ?? "-",
    s.ops.notamCount, s.threats.news.length, s.threats.disasters.length,
  ].join("|");
  const cacheKey = `${icao}|${fingerprint}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return NextResponse.json({ bluf: hit.bluf, watch: hit.watch, asks: hit.asks, cached: true });

  const lines: string[] = [];
  lines.push(`BASE: ${base.icao} — ${base.label}`);
  // Mission-impact picture leads — the read is FOR LEADERSHIP.
  const mi = s.mission;
  lines.push(`AIRFIELD MISSION CAPABILITY: ${mi.state.toUpperCase()}`);
  for (const c of mi.ccir) lines.push(`CCIR: ${c.text}`);
  for (const f of mi.functions) if (f.capability !== "fmc") lines.push(`FUNCTION ${f.label}: ${f.capability.toUpperCase()} — ${f.driver}${f.window ? ` (${f.window})` : ""}`);
  for (const l of mi.limfacs) {
    lines.push(`LIMFAC ${l.id} [${l.capability.toUpperCase()}/${l.source}] ${l.fnLabel}${l.window ? ` (${l.window})` : ""}: ${l.driver}. IMPACT: ${l.impact}${l.mitigation ? ` MITIGATION: ${l.mitigation}` : ""}${l.ask ? ` ASK: ${l.ask}` : ""}`);
  }
  const w = s.weather;
  lines.push(`WEATHER NOW: ${w.now ? `${w.now.flightCategory}, wind ${w.now.windKt ?? "?"}kt${w.now.gustKt ? `G${w.now.gustKt}` : ""}, vis ${w.now.visMi ?? "?"}mi, ceiling ${w.now.ceilingFt ?? "none"}` : "UNKNOWN"}`);
  if (w.metarRaw) lines.push(`METAR: ${w.metarRaw}`);
  if (w.tafWorst) lines.push(`TAF WORST (24h): ${w.tafWorst.worst}${w.tafWorst.fromISO ? ` from ${w.tafWorst.fromISO}` : ""}`);
  for (const a of w.alerts) lines.push(`WX ALERT: [${a.severity}${a.lifeThreatening ? "/LIFE-THREAT" : ""}] ${a.event} — ${a.headline.slice(0, 140)}`);
  for (const d of w.outlook) lines.push(`OUTLOOK ${d.date}: ${d.hiF ?? "?"}/${d.loF ?? "?"}F, precip ${d.precipPct ?? "?"}%, wind ${d.windMph ?? "?"}mph`);
  const o = s.ops;
  lines.push(`AIRFIELD: ${o.fieldClosed ? "CLOSED (NOTAM)" : o.limiting ? "LIMITED" : o.configured && o.live ? "OPEN" : "STATUS UNKNOWN"} · ${o.notamCount} active NOTAMs${o.capability ? ` · longest rwy ${o.capability.lengthFt}ft ${o.capability.surface} (${o.capability.cls})` : ""}`);
  for (const g of o.groups) for (const n of g.items.slice(0, 3)) lines.push(`NOTAM [${g.label}${n.amber ? "/LIMITING" : ""}]: ${n.text.slice(0, 160)}`);
  const xw = o.runwayWinds.filter((r) => r.flag !== "g");
  if (xw.length > 0) lines.push(`CROSSWIND (advisory): ${xw.map((r) => `RWY ${r.ident} cross ${r.crossKt}kt${r.gustCrossKt ? ` gust ${r.gustCrossKt}` : ""}`).join("; ")}`);
  else if (o.runwayWinds.length > 0) lines.push(`CROSSWIND: all runway ends within advisory limits (best headwind RWY ${o.runwayWinds[0].ident})`);
  if (o.fuel) lines.push(`FUEL NOTAMS: ${o.fuel.live ? (o.fuel.items.length ? o.fuel.items.join(" | ").slice(0, 300) : "none referencing this field") : "feed UNREACHABLE — UNKNOWN"}`);
  lines.push(`ASTRO: civil dawn ${s.astro.civilDawnZ?.slice(11, 16) ?? "—"}Z sunrise ${s.astro.sunriseZ?.slice(11, 16) ?? "—"}Z sunset ${s.astro.sunsetZ?.slice(11, 16) ?? "—"}Z civil dusk ${s.astro.civilDuskZ?.slice(11, 16) ?? "—"}Z · moon ${s.astro.moon.illumPct}% ${s.astro.moon.phaseName}`);
    if (o.center) {
    lines.push(`CENTER (${o.center.code} ARTCC): ${o.center.live ? `${o.center.count} active enroute NOTAMs` : "UNREACHABLE — UNKNOWN"}`);
    for (const n of o.center.items.slice(0, 4)) lines.push(`CENTER NOTAM${n.amber ? " [SIGNIFICANT]" : ""}: ${n.text.slice(0, 160)}`);
  }
  const inf = s.infra;
  lines.push(`INTERNET (${inf.internet.entity ?? "region"}): ${inf.internet.live ? (inf.internet.led === "g" ? "no macro degradation (IODA)" : inf.internet.series.filter((x) => (x.dropPct ?? 0) >= 50).map((x) => `${x.label} down ~${x.dropPct}%`).join(", ") || "minor variation") : "IODA UNREACHABLE — UNKNOWN"}`);
  if (inf.nas) {
    lines.push(`FAA NAS: ${inf.nas.live ? `${inf.nas.counts.groundStops} ground stops / ${inf.nas.counts.groundDelays} ground delays / ${inf.nas.counts.closures} closures nationally` : "UNREACHABLE — UNKNOWN"}`);
    for (const p of inf.nas.nearby.slice(0, 4)) lines.push(`NAS NEARBY (${p.km}km): ${p.kind === "groundStop" ? "GROUND STOP" : p.kind === "closure" ? "CLOSURE" : p.kind === "groundDelay" ? "ground delay" : "delay"} at ${p.airport} — ${p.reason}${p.detail ? ` (${p.detail})` : ""}`);
  }
  if (inf.powerNews.length > 0) lines.push(`POWER (news-derived, unverified): ${inf.powerNews.map((n) => n.title.slice(0, 100)).join(" | ")}`);
  if (inf.commsNews.length > 0) lines.push(`COMMS (news-derived, unverified): ${inf.commsNews.map((n) => n.title.slice(0, 100)).join(" | ")}`);
  if (s.threats.fp) {
    lines.push(`FORCE PROTECTION: ${s.threats.fp.composite.toUpperCase()} — ${s.threats.fp.topDriver}`);
    for (const ax of s.threats.fp.axes) if (ax.severity !== "green") lines.push(`FP AXIS ${ax.key}: ${ax.severity} — ${ax.summary.slice(0, 120)}`);
  }
  for (const d of s.threats.disasters) lines.push(`DISASTER ${d.km}km: [${d.severity}] ${d.type} — ${d.title.slice(0, 120)}`);
  for (const n of s.threats.news) lines.push(`LOCAL NEWS (${n.matched.join(",")}): ${n.title.slice(0, 140)}`);

  const prompt =
    `You are writing the leadership BLUF of a mobility squadron airfield SITREP about ${base.label} (${base.icao}). ` +
    `The audience is the commander briefing UP the chain. Frame everything as MISSION IMPACT and LIMITING FACTORS (LIMFACs), not raw data. ` +
    `Return ONLY JSON: {"bluf":["...","...","..."],"watch":["...","..."],"asks":["..."]}. ` +
    `bluf = exactly 3 short bullets: (1) the airfield mission-capability call (FMC/PMC/NMC) and whether it supports operations now and through the next 24h, naming the driving LIMFAC(s) and window; ` +
    `(2) the single greatest mission impact and the recommended action; (3) projected recovery — when the LIMFACs clear and capability is restored. ` +
    `asks = 0-3 explicit requests for leadership decision/resources, each with a deadline in Z if time-sensitive (pull from the LIMFAC ASK fields; omit if none). ` +
    `watch = 0-3 items to re-check later. Be concrete: times in Z, runway numbers, capability terms (FMC/PMC/NMC). No hedging boilerplate; if the airfield is FMC say so plainly. ` +
    `Data marked UNKNOWN means the source was unreachable — say "unknown", never assume clear or FMC.\n\n${lines.join("\n")}`;

  try {
    const modelStart = Date.now();
    const resp = await anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 500, messages: [{ role: "user", content: prompt }] });
    logCall({ route: "sitrep_read", model: "claude-sonnet-4-6", usage: resp.usage, durationMs: Date.now() - modelStart , user: normEmail(session.user?.email) }).catch(() => {});
    const textBlock = resp.content.find((b) => b.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text : "{}";
    let bluf: string[] = [];
    let watch: string[] = [];
    let asks: string[] = [];
    try {
      const p = JSON.parse(extractJsonObject(raw)) as { bluf?: unknown[]; watch?: unknown[]; asks?: unknown[] };
      bluf = Array.isArray(p.bluf) ? p.bluf.map((x) => String(x).slice(0, 300)).slice(0, 3) : [];
      watch = Array.isArray(p.watch) ? p.watch.map((x) => String(x).slice(0, 200)).slice(0, 3) : [];
      asks = Array.isArray(p.asks) ? p.asks.map((x) => String(x).slice(0, 250)).slice(0, 3) : [];
    } catch { /* fall through to empty */ }
    if (bluf.length === 0) return NextResponse.json({ error: "Read generation failed" }, { status: 502 });
    cache.set(cacheKey, { bluf, watch, asks, expires: Date.now() + TTL });
    return NextResponse.json({ bluf, watch, asks });
  } catch (err) {
    console.error("sitrep read failed:", err);
    return NextResponse.json({ error: "Read generation failed" }, { status: 500 });
  }
}
