import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { anthropic } from "@/lib/claude";
import { logCall } from "@/lib/anthropicLog";
import { getUserPrefs } from "@/lib/userPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { getCountryDossier } from "@/lib/groundTruth";
import { getAllStateAdvisories } from "@/lib/stateAdvisories";
import { getHealthEvents } from "@/lib/health";
import { civilCalendarEvents } from "@/lib/civilCalendar";

export const dynamic = "force-dynamic";

// Per-country "ground situation" AI SITREP for the Ground Truth tab. Synthesizes
// the country's incidents + local news + civil/health into a short read. The
// fused posture (composite + drivers) is passed from the client (already computed
// by /api/force-protection) so we don't recompute it. Gated on the chat AI
// feature; cached 15 min per country+posture.
const TTL = 15 * 60 * 1000;
const cache = new Map<string, { text: string; expires: number }>();

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(the|of|republic|democratic|peoples?)\b/g, "").trim();
}
const countryMatch = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ text: "", disabled: true });

  const prefs = await getUserPrefs().catch(() => null);
  if (prefs && !isFeatureEnabled("chat", prefs)) return NextResponse.json({ text: "", disabled: true });

  let body: { country?: string; composite?: string; drivers?: string[]; cocom?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const country = String(body.country ?? "").trim().slice(0, 60);
  if (!country) return NextResponse.json({ error: "country required" }, { status: 400 });
  const composite = String(body.composite ?? "").toUpperCase();
  const drivers = Array.isArray(body.drivers) ? body.drivers.slice(0, 10).map((d) => String(d).slice(0, 160)) : [];

  const cacheKey = `${country.toLowerCase()}|${composite}|${drivers.join("|").slice(0, 200)}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return NextResponse.json({ text: hit.text, cached: true });

  try {
    const [dossier, advisories, health] = await Promise.all([
      getCountryDossier(country),
      getAllStateAdvisories().catch(() => []),
      getHealthEvents().catch(() => ({ live: false, events: [] })),
    ]);
    const adv = advisories.find((a) => countryMatch(a.country, country));
    const civil = civilCalendarEvents(country, Date.now()).slice(0, 4);
    const who = health.events.filter((e) => countryMatch(e.country, country)).slice(0, 3);

    const lines: string[] = [];
    lines.push(`POSTURE: ${composite || "—"}${drivers.length ? ` — ${drivers.join("; ")}` : ""}`);
    if (adv) lines.push(`ADVISORY: State Level ${adv.level ?? "?"}${adv.orderedDeparture ? " (ordered departure)" : adv.authorizedDeparture ? " (authorized departure)" : ""}`);
    if (civil.length) lines.push(`CIVIL CALENDAR: ${civil.map((e) => `${e.label} (${e.active ? "active" : `in ${e.daysUntil}d`})`).join("; ")}`);
    if (who.length) lines.push(`HEALTH: ${who.map((e) => `${e.disease}`).join("; ")}`);
    if (dossier.incidents.length) lines.push("INCIDENTS:\n" + dossier.incidents.slice(0, 8).map((i) => `- [${i.src.toUpperCase()}] ${i.type} @ ${i.location}${i.km != null ? ` (~${i.km}km)` : ""}${i.fatalities > 0 ? ` ${i.fatalities} killed` : ""}`).join("\n"));
    if (dossier.news.length) lines.push("LOCAL NEWS:\n" + dossier.news.slice(0, 8).map((n) => `- ${n.title} (${n.source})`).join("\n"));

    const prompt = `You are a force-protection watch officer writing a short GROUND SITUATION read for ${country} for a senior air-mobility commander. Synthesize the signals below into what's happening on the ground RIGHT NOW and what it means for US forces/aircraft operating there. No preamble. <=140 words. Format EXACTLY:

<one-line lead: overall read + a single-word tone (Quiet / Watchful / Deteriorating / Volatile)>
<2-4 short sentences: the security, civil, and on-the-ground picture, tied to force protection>
WATCH: <what could change in the coming days>

Be specific and operational. Treat any UNKNOWN as a gap, never "clear". Coarse open-source SA — not authoritative tasking.

SIGNALS (${country}):
${lines.join("\n")}`;

    const modelStart = Date.now();
    const resp = await anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 420, messages: [{ role: "user", content: prompt }] });
    logCall({ route: "ground_sitrep", model: "claude-sonnet-4-6", usage: resp.usage, durationMs: Date.now() - modelStart, user: normEmail(session.user?.email) }).catch(() => {});
    const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
    cache.set(cacheKey, { text, expires: Date.now() + TTL });
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "sitrep failed" }, { status: 502 });
  }
}
