import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { WeatherAlert } from "@/lib/types";

export const dynamic = "force-dynamic";

const TTL_MS = 3 * 60 * 1000; // 3 min — alerts are time-sensitive
const cache = new Map<string, { data: WeatherAlert[]; expires: number }>();

const SEVERITIES = new Set<WeatherAlert["severity"]>(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]);

async function fetchAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  const headers = {
    "User-Agent": "DEAD-Dashboard",
    Accept: "application/geo+json",
  };
  const res = await fetch(
    `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
    { headers, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`alerts: ${res.status}`);
  const data = await res.json();
  const features: unknown[] = data?.features ?? [];
  return features.flatMap((f): WeatherAlert[] => {
    if (!f || typeof f !== "object") return [];
    const props = (f as { properties?: Record<string, unknown> }).properties ?? {};
    const rawSeverity = String(props.severity ?? "Unknown") as WeatherAlert["severity"];
    return [{
      id: String((f as { id?: string }).id ?? ""),
      event: String(props.event ?? ""),
      severity: SEVERITIES.has(rawSeverity) ? rawSeverity : "Unknown",
      urgency: String(props.urgency ?? ""),
      headline: String(props.headline ?? "").slice(0, 300),
      effective: String(props.effective ?? ""),
      expires: String(props.expires ?? ""),
      areaDesc: String(props.areaDesc ?? "").slice(0, 200),
    }];
  });
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json({ alerts: hit.data, cached: true });
  }

  try {
    const alerts = await fetchAlerts(lat, lon);
    cache.set(key, { data: alerts, expires: Date.now() + TTL_MS });
    return NextResponse.json({ alerts });
  } catch (err) {
    console.error("Weather alerts fetch failed:", err);
    return NextResponse.json({ alerts: [] });
  }
}
