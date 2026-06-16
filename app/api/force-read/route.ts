import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { logCall } from "@/lib/anthropicLog";
import { getUserPrefs } from "@/lib/userPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { getForceProtection, CATEGORY_LABEL } from "@/lib/forceProtection";
import { AOR_LABELS, type Aor } from "@/lib/aor";

export const dynamic = "force-dynamic";

// AI "Force Protection read" — a force-protection officer's take on the scored
// board: which watched locations need attention first and why, across COCOMs.
// Same data as /api/force-protection; cached 10 min. Sibling of crisis-read
// (which is demand-focused); this one is threat-to-our-forces-focused.
const TTL = 10 * 60 * 1000;
let cache: { key: string; text: string; expires: number } | null = null;

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ text: "", disabled: true });

  const prefs = await getUserPrefs().catch(() => null);
  if (prefs && !isFeatureEnabled("chat", prefs)) return NextResponse.json({ text: "", disabled: true });

  const countries = prefs?.countriesOfInterest ?? [];
  const bases = prefs?.forceLocations ?? [];
  if (countries.length === 0 && bases.length === 0) return NextResponse.json({ text: "No countries or bases are being watched. Add countries of interest in Preferences → Force Protection.", empty: true });
  const key = [...countries.map((c) => `c:${c.id}:${c.country}`), ...bases.map((l) => `b:${l.id}:${l.lat},${l.lon}:${l.icao ?? ""}`)].join("|");
  if (cache && cache.key === key && cache.expires > Date.now()) return NextResponse.json({ text: cache.text, cached: true });

  try {
    const { assessments } = await getForceProtection(countries, bases);

    // Compact signal board: one block per watch entry, worst categories first.
    const lines: string[] = [];
    for (const a of assessments) {
      const cocomLabel = AOR_LABELS[a.cocom as Aor] ?? a.cocom;
      const cats = a.categories
        .filter((c) => c.severity !== "green")
        .map((c) => `${CATEGORY_LABEL[c.category]}=${c.severity.toUpperCase()} (${c.signals.join("; ")})`);
      lines.push(`${a.composite.toUpperCase()} ${a.kind === "country" ? "COUNTRY" : "BASE"} ${a.label}${a.icao ? ` [${a.icao}]` : ""} — ${cocomLabel} — ${a.country}${a.note ? ` — ${a.note}` : ""}${cats.length ? ` :: ${cats.join(" | ")}` : " :: no elevated categories"}`);
    }

    const prompt = `You are a force-protection / antiterrorism officer briefing a senior air-mobility commander on threats to OUR forces and aircraft at the watched locations below. Each line is one location with its fused threat posture (RED/AMBER/GREEN/UNKNOWN) across categories: Conflict, Aviation Wx, GPS/Comms, Airspace/NOTAM (runway closures, approach outages), Civil/Diplomatic, Hazard. Tell the commander WHERE TO FOCUS to protect people and tails. No preamble. <=160 words. Format EXACTLY:

FOCUS: <the single location needing attention first — where, why, what to do>
<one line per other notable location: LOCATION (COCOM) — driver — recommended attention>
WATCH: <what could deteriorate in the coming days across these locations>

Be specific and operational (crosswind/ceiling for airfields, GPS-degraded approaches, conflict proximity, civil unrest, embassy posture, cultural/observance windows, disease outbreaks). Treat any category marked UNKNOWN as a BLIND SPOT (a feed was unavailable) — call it out as a gap to close, never as "clear". Coarse open-source SA — not authoritative tasking.

WATCHED LOCATIONS:
${lines.join("\n")}`;

    const modelStart = Date.now();
    const resp = await anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 520, messages: [{ role: "user", content: prompt }] });
    logCall({ route: "force_read", model: "claude-sonnet-4-6", usage: resp.usage, durationMs: Date.now() - modelStart }).catch(() => {});
    const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
    cache = { key, text, expires: Date.now() + TTL };
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 502 });
  }
}
