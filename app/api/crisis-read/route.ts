import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { logCall } from "@/lib/anthropicLog";
import { getUserPrefs } from "@/lib/userPrefs";
import { getWeatherThreats, type NamedPoint } from "@/lib/severeWeather";
import { getStateAdvisories } from "@/lib/stateAdvisories";
import { getConflictPoints } from "@/lib/conflictEvents";
import { getAcledEvents } from "@/lib/acled";
import { aorFromCoords } from "@/lib/aor";
import { nearestAirfields } from "@/lib/airfields";
import { nearestOurAirports } from "@/lib/ourAirports";

// Compact "nearest mobility airfield(s)" hint for a demand point, so the read can
// name a real field for the access note. Curated set first; if nothing useful is
// close, fall back to the nearest OurAirports civil/military field (the "search
// others" hybrid) so even gateway-sparse regions get a candidate.
async function accessHint(lat: number | null, lon: number | null): Promise<string> {
  if (lat == null || lon == null) return "";
  const curated = nearestAirfields(lat, lon, 2, 4000);
  const parts = curated.map((a) => `${a.icao} ${a.name} ~${a.km}km`);
  if (curated.length === 0 || curated[0].km > 600) {
    const oa = await nearestOurAirports(lat, lon, 1, 2000).catch(() => []);
    if (oa[0]) parts.push(`${oa[0].ident} ${oa[0].name} ~${oa[0].km}km (civil)`);
  }
  return parts.length ? " | access: " + parts.join("; ") : " | access: no field <4000km";
}

export const dynamic = "force-dynamic";

// AI "mobility-demand read" — an anticipatory AMC plans-officer read of the
// Crisis board (disasters incl. humanitarian/complex emergencies, hub weather,
// tropical, NEO, conflict), AOR-tagged: where air-mobility demand is emerging,
// the likely tasking (HADR/aeromed/NEO/security-coop/strategic), and airfield-
// access implications. Cached 10 min. Same data as the map; no new feeds.
const TTL = 10 * 60 * 1000;
let cache: { text: string; expires: number } | null = null;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ text: "", disabled: true });
  if (cache && cache.expires > Date.now()) return NextResponse.json({ text: cache.text, cached: true });

  try {
    const prefs = await getUserPrefs().catch(() => null);
    const locations: NamedPoint[] = [];
    if (prefs?.localLat != null && prefs?.localLon != null) locations.push({ label: prefs.localCity || "Home", lat: prefs.localLat, lon: prefs.localLon });
    for (const t of prefs?.trackedLocations ?? []) locations.push({ label: t.label, lat: t.lat, lon: t.lon });

    const [threats, advisories, conflict, acled] = await Promise.all([getWeatherThreats(locations), getStateAdvisories(), getConflictPoints().catch(() => []), getAcledEvents().catch(() => [])]);

    const lines: string[] = [];
    for (const d of threats.disasters.slice(0, 16)) lines.push(`DISASTER ${d.severity} ${d.type} "${d.title}"${d.country ? ` (${d.country})` : ""} [${d.aor}]${d.nearLocations.length ? ` near ${d.nearLocations.join("/")}` : ""} hadr=${d.hadrScore}` + await accessHint(d.lat, d.lon));
    for (const z of threats.hazards) lines.push(`HUB-WX ${z.severity} ${z.label}: ${z.flags.join(", ")}`);
    for (const t of threats.tropical) lines.push(`TROPICAL ${t.category} ${t.name} ${t.intensityKt ?? "?"}kt moving ${t.movement}`);
    for (const a of advisories.filter((x) => x.orderedDeparture || x.authorizedDeparture)) lines.push(`NEO ${a.country} [${a.aor}] ${a.orderedDeparture ? "ordered" : "authorized"} departure`);
    // Kinetic / conflict picture. Prefer ACLED's structured strikes (precise
    // type/actors/fatalities) when configured; otherwise the conflict layer
    // (UCDP precise events, or the keyless ReliefWeb country-level fallback).
    if (acled.length > 0) {
      const top = [...acled].sort((a, b) => (b.fatalities - a.fatalities) || b.date.localeCompare(a.date)).slice(0, 10);
      for (const e of top) lines.push(`STRIKE [${aorFromCoords(e.lat, e.lon)}] ${e.subType} ${[e.location, e.country].filter(Boolean).join(", ")}${e.actors ? ` (${e.actors})` : ""}${e.fatalities > 0 ? ` ${e.fatalities} killed` : ""} [ACLED]`);
    } else {
      for (const c of conflict.slice(0, 10)) {
        lines.push((c.src === "reliefweb"
          ? `CONFLICT/EMERGENCY [${aorFromCoords(c.lat, c.lon)}] "${c.title || c.name}" (${c.name})`
          : `KINETIC [${aorFromCoords(c.lat, c.lon)}] "${c.title || c.name}"${c.title && c.name ? ` (${c.name})` : ""}${c.count > 1 ? ` ${c.count} fatalities` : ""}`) + await accessHint(c.lat, c.lon));
      }
    }

    if (lines.length === 0) {
      const text = "No active demand signals on the board — quiet across the tracked AORs and hub network.";
      cache = { text, expires: Date.now() + TTL };
      return NextResponse.json({ text });
    }

    const prompt = `You are an Air Mobility Command (AMC) plans officer preparing an anticipatory MOBILITY-DEMAND read for a senior planner. From this AOR-tagged signal board, identify where air-mobility demand is emerging or likely and the implication for airlift / tanker / aeromedical and AIRFIELD ACCESS (where we may need to open or reopen a field). No preamble. <=150 words. Format EXACTLY:

LEAD: <the single highest-priority emerging mobility demand — where, why, likely tasking>
<up to 4 lines, each formatted: AOR — location — driver — TASKING(HADR airlift | aeromedical | NEO/evacuation | security cooperation | strategic) — access note (terrain/airfield/weather limiting reach, if any)>
WATCH: <what could escalate demand in the coming days>

Weight partner/ally relevance in INDOPACOM, EUCOM, CENTCOM, AFRICOM, SOUTHCOM. Coarse open-source SA — not tasking.

SIGNAL BOARD:
${lines.join("\n")}`;
    const modelStart = Date.now();
    const resp = await anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 500, messages: [{ role: "user", content: prompt }] });
    logCall({ route: "crisis_read", model: "claude-sonnet-4-6", usage: resp.usage, durationMs: Date.now() - modelStart }).catch(() => {});
    const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
    cache = { text, expires: Date.now() + TTL };
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 502 });
  }
}
