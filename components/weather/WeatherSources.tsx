"use client";

// The sources strip (REVIEW-2026-10 W2): one chip per feed, what it
// supplies, and whether it answered THIS render. The feeds are keyless and
// fill each other's gaps (NWS is US-only, Open-Meteo is global, AWC is the
// aviation truth), so none is user-removable — the strip says so, and what
// the operator edits is places and airfields (the Track command).

export type SourceStatus = "ok" | "down" | "na" | "idle";

export interface SourceStatuses {
  nws: SourceStatus;
  openMeteo: SourceStatus;
  awc: SourceStatus;
  nhc: SourceStatus;
  disasters: SourceStatus;
  swpc: SourceStatus;
}

const SOURCES: { key: keyof SourceStatuses | "windy"; name: string; gives: string; href: string }[] = [
  { key: "nws", name: "NWS", gives: "US forecast · alerts", href: "https://www.weather.gov" },
  { key: "openMeteo", name: "Open-Meteo", gives: "global now · 7-day · 30-h hazards", href: "https://open-meteo.com" },
  { key: "awc", name: "AWC", gives: "METAR · TAF", href: "https://aviationweather.gov" },
  { key: "nhc", name: "NHC", gives: "tropical", href: "https://www.nhc.noaa.gov" },
  { key: "disasters", name: "GDACS · USGS · ReliefWeb", gives: "disasters", href: "https://www.gdacs.org" },
  { key: "swpc", name: "SWPC", gives: "space", href: "https://www.swpc.noaa.gov" },
  { key: "windy", name: "Windy", gives: "map", href: "https://www.windy.com" },
];

const DOT: Record<SourceStatus, string> = { ok: "bg-emerald-400", down: "bg-amber-400", na: "bg-slate-600", idle: "bg-slate-700 animate-pulse" };
const TITLE: Record<SourceStatus, string> = { ok: "answered this render", down: "did not answer — rows from it read UNKNOWN, not clear", na: "no coverage at your points (NWS is US-only)", idle: "loading" };

export default function WeatherSources({ status }: { status: SourceStatuses }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SOURCES.map((s) => {
        const st: SourceStatus = s.key === "windy" ? "ok" : status[s.key];
        return (
          <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" title={`${s.name} — ${s.gives} · ${TITLE[st]}`}
            className={`inline-flex items-center gap-1.5 text-[10px] rounded-full border px-2 py-0.5 ${st === "down" ? "border-amber-500/50" : "border-slate-800"} bg-slate-900/60 text-slate-300 hover:border-slate-600`}>
            <span className={`w-1.5 h-1.5 rounded-full ${DOT[st]}`} />
            {s.name}<span className="text-slate-500 text-[9.5px]">{s.gives}{st === "down" ? " — unreachable" : st === "na" ? " — none here" : ""}</span>
          </a>
        );
      })}
      <span className="text-[10px] text-slate-600 ml-1">keyless feeds that fill each other&rsquo;s gaps — you edit the places and airfields, not the feeds</span>
    </div>
  );
}
