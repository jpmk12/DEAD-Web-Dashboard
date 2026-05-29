import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { SpaceWeather } from "@/lib/types";

export const dynamic = "force-dynamic";

const TTL_MS = 10 * 60 * 1000;
let cached: { data: SpaceWeather; expires: number } | null = null;

// Map Kp index to NOAA G-scale geomagnetic storm level.
function kpToGStorm(kp: number): string {
  if (kp >= 9) return "G5";
  if (kp >= 8) return "G4";
  if (kp >= 7) return "G3";
  if (kp >= 6) return "G2";
  if (kp >= 5) return "G1";
  return "G0";
}

// Map x-ray flare class string to NOAA R-scale radio blackout level.
// X-class boundaries: M5+/X1+ etc. Simplification: class letter + magnitude.
function flareToRBlackout(flareClass: string): string {
  if (!flareClass || flareClass === "Quiet") return "R0";
  const m = flareClass.match(/^([ABCMX])(\d+(?:\.\d+)?)/i);
  if (!m) return "R0";
  const letter = m[1].toUpperCase();
  const mag = parseFloat(m[2]);
  if (letter === "X" && mag >= 20) return "R5";
  if (letter === "X" && mag >= 10) return "R4";
  if (letter === "X") return "R3";
  if (letter === "M" && mag >= 5) return "R2";
  if (letter === "M") return "R1";
  return "R0";
}

// Categorise the peak-flux X-ray reading into the standard flare-class string.
function fluxToFlareClass(flux: number): string {
  if (!Number.isFinite(flux) || flux <= 0) return "Quiet";
  if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(1)}`;
  if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(1)}`;
  if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(1)}`;
  if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(1)}`;
  return `A${(flux / 1e-8).toFixed(1)}`;
}

async function fetchSpaceWeather(): Promise<SpaceWeather> {
  // Kp index — recent (planetary K-index, 3-hourly).
  const headers = { "User-Agent": "DEAD-Dashboard" };
  const [kpRes, xrayRes] = await Promise.all([
    fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", { headers, cache: "no-store" }).catch(() => null),
    fetch("https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json", { headers, cache: "no-store" }).catch(() => null),
  ]);

  // Track which feeds actually succeeded so we don't cache a "Quiet" / G0
  // fabricated state when both upstreams failed.
  let kpOk = false;
  let xrayOk = false;

  let currentKp: number | null = null;
  let kpHistory: { time: string; value: number }[] = [];
  if (kpRes && kpRes.ok) {
    kpOk = true;
    const arr = await kpRes.json();
    // Format: [["time_tag","Kp","a_running","station_count"], ...]
    if (Array.isArray(arr) && arr.length > 1) {
      const rows = arr.slice(1) as [string, string, string, string][];
      kpHistory = rows.slice(-8).map((r) => ({
        time: r[0],
        value: Number(r[1]) || 0,
      }));
      currentKp = kpHistory.length > 0 ? kpHistory[kpHistory.length - 1].value : null;
    }
  }

  // X-ray flares — last 6 hours peak flux on GOES long-wave band (~1-8 Å).
  let currentFlareClass = "Quiet";
  if (xrayRes && xrayRes.ok) {
    xrayOk = true;
    const arr = await xrayRes.json();
    if (Array.isArray(arr) && arr.length > 0) {
      // Each entry: {time_tag, satellite, flux, energy, …}; "0.1-0.8nm" is the long band.
      const longBand = arr.filter((e: { energy?: string }) => e.energy === "0.1-0.8nm");
      const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
      const recent = longBand.filter((e: { time_tag?: string }) => {
        const t = new Date(e.time_tag ?? "").getTime();
        return Number.isFinite(t) && t > sixHoursAgo;
      });
      const peakFlux = recent.reduce((max: number, e: { flux?: number }) => {
        const f = Number(e.flux ?? 0);
        return f > max ? f : max;
      }, 0);
      currentFlareClass = fluxToFlareClass(peakFlux);
    }
  }

  // If neither feed yielded anything usable, throw rather than fabricate a
  // "quiet" payload — the GET handler caches successful responses, and we'd
  // otherwise lock in 10 minutes of all-zeros on a transient NOAA outage.
  if (!kpOk && !xrayOk) {
    throw new Error("No NOAA SWPC data available");
  }

  return {
    currentKp,
    kpHistory,
    currentFlareClass,
    geoStorm: kpToGStorm(currentKp ?? 0),
    radioBlackout: flareToRBlackout(currentFlareClass),
    // Radiation-storm (S-scale) needs the proton-flux feed; left at S0 for v1
    // — the meaningful proton events also produce X-class flares we already
    // surface, so the operational signal is already there.
    radiationStorm: "S0",
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (cached && cached.expires > Date.now()) {
    return NextResponse.json({ space: cached.data, cached: true });
  }

  try {
    const data = await fetchSpaceWeather();
    cached = { data, expires: Date.now() + TTL_MS };
    return NextResponse.json({ space: data });
  } catch (err) {
    console.error("Space weather fetch failed:", err);
    return NextResponse.json({ space: null, error: "Unavailable" }, { status: 502 });
  }
}
