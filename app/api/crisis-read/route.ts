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

export const dynamic = "force-dynamic";

// AI "map read" — a tight AMC watch-officer SITREP of what's currently on the
// Crisis map (disasters, hub weather, tropical, NEO, kinetic activity), AOR-tagged. Cached 10 min
// so it isn't regenerated on every click. Same data the map/Global Reach Watch
// use; no new feeds.
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
    for (const d of threats.disasters.slice(0, 12)) lines.push(`DISASTER ${d.severity} ${d.type} "${d.title}" [${d.aor}]${d.nearLocations.length ? ` near ${d.nearLocations.join("/")}` : ""} hadr=${d.hadrScore}`);
    for (const z of threats.hazards) lines.push(`HUB-WX ${z.severity} ${z.label}: ${z.flags.join(", ")}`);
    for (const t of threats.tropical) lines.push(`TROPICAL ${t.category} ${t.name} ${t.intensityKt ?? "?"}kt moving ${t.movement}`);
    for (const a of advisories.filter((x) => x.orderedDeparture || x.authorizedDeparture)) lines.push(`NEO ${a.country} [${a.aor}] ${a.orderedDeparture ? "ordered" : "authorized"} departure`);
    // Kinetic picture for the contested-environment read. Prefer ACLED's
    // structured strikes (precise type/actors/fatalities) when configured; fall
    // back to the GDELT density read otherwise so the SITREP still covers it.
    if (acled.length > 0) {
      const top = [...acled].sort((a, b) => (b.fatalities - a.fatalities) || b.date.localeCompare(a.date)).slice(0, 10);
      for (const e of top) lines.push(`STRIKE [${aorFromCoords(e.lat, e.lon)}] ${e.subType} ${[e.location, e.country].filter(Boolean).join(", ")}${e.actors ? ` (${e.actors})` : ""}${e.fatalities > 0 ? ` ${e.fatalities} killed` : ""} [ACLED]`);
    } else {
      for (const c of conflict.slice(0, 8)) lines.push(`KINETIC [${aorFromCoords(c.lat, c.lon)}] "${c.title || c.name}"${c.title && c.name ? ` (${c.name})` : ""} reports=${c.count}`);
    }

    if (lines.length === 0) {
      const text = "No active crises on the board — quiet across the tracked AORs and hub network.";
      cache = { text, expires: Date.now() + TTL };
      return NextResponse.json({ text });
    }

    const prompt = `You are an Air Mobility Command (AMC) watch officer. From this raw signal list, write a tight situation read for an air-mobility audience: what's happening, which AORs/bases it touches, and the airlift implication (HADR pull, NEO/evacuation, kinetic activity shaping the threat/permissive picture, weather impeding reach). 3-4 sentences, no preamble, no bullet points, <=90 words. This is coarse open-source SA, not tasking.\n\n${lines.join("\n")}`;
    const modelStart = Date.now();
    const resp = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 240, messages: [{ role: "user", content: prompt }] });
    logCall({ route: "crisis_read", model: "claude-haiku-4-5", usage: resp.usage, durationMs: Date.now() - modelStart }).catch(() => {});
    const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
    cache = { text, expires: Date.now() + TTL };
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 502 });
  }
}
