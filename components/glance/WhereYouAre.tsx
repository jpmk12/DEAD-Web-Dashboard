"use client";

import { useEffect, useState } from "react";
import { WeatherIcon, wmoIconId, WEATHER_ICON_LABEL } from "@/lib/weatherIcon";
import type { HereWeather } from "@/app/api/weather/here/route";

// Weather where you are — under the clocks on Glance (REVIEW-2026-10 W1).
// The clocks already know where you are (TDY › home); this strip says what
// the sky is doing there, what your nearest tracked airfield is reading
// (flight category, the TAF turn, the 30-h model hazard) and home in one
// muted phrase when you are away. One cached route, no model call, a door
// to the Weather tab. UNKNOWN is a word here, never a blank.

const CAT_CLS: Record<string, string> = {
  VFR: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  MVFR: "text-sky-300 bg-sky-500/10 border-sky-500/30",
  IFR: "text-red-300 bg-red-500/10 border-red-500/30",
  LIFR: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30",
  UNKNOWN: "text-slate-400 bg-slate-700/30 border-slate-600/40",
};

const Cat = ({ cat }: { cat: string }) => (
  <span className={`text-[9px] font-bold tracking-wider px-1 py-px rounded border ${CAT_CLS[cat] ?? CAT_CLS.UNKNOWN}`}>{cat}</span>
);

const zHour = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${String(d.getUTCHours()).padStart(2, "0")}Z`; };
const compass = (deg: number | null) => deg == null ? "" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];

export default function WhereYouAre({ onOpen }: { onOpen: () => void }) {
  const [d, setD] = useState<HereWeather | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const device = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
    const load = () => fetch(`/api/weather/here?device=${encodeURIComponent(device)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: HereWeather | null) => { if (alive) setD(j); })
      .catch(() => { if (alive) setD(null); });
    load();
    const t = setInterval(load, 10 * 60_000);
    const on = () => load();
    window.addEventListener("tracking:changed", on);
    window.addEventListener("dashboard-cache-cleared", on);
    return () => { alive = false; clearInterval(t); window.removeEventListener("tracking:changed", on); window.removeEventListener("dashboard-cache-cleared", on); };
  }, []);

  if (d === undefined) return <div className="h-9 rounded-lg border border-slate-800 bg-slate-900/40 animate-pulse" />;
  if (!d || !d.here) {
    return (
      <button onClick={onOpen} className="w-full text-left rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-500 hover:border-slate-700">
        <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-sky-400/80 mr-2">Where you are</span>
        no home location set — Preferences → You → Home Location
      </button>
    );
  }
  const h = d.here;
  const c = h.current;
  const icon = c?.weatherCode != null ? wmoIconId(c.weatherCode, c.isDay) : null;
  const cond = icon ? WEATHER_ICON_LABEL[icon] : "";
  const af = d.airfield;
  const tafTurn = af?.taf && af.taf.worst !== af.cat && af.taf.worst !== "UNKNOWN" && af.taf.worst !== "VFR" ? af.taf : null;
  const hm = d.home;
  const hmIcon = hm?.current?.weatherCode != null ? wmoIconId(hm.current.weatherCode, hm.current.isDay) : null;

  return (
    <button onClick={onOpen} title="Open the Weather tab" className="w-full text-left rounded-lg border border-sky-500/30 bg-sky-500/[0.04] hover:bg-sky-500/[0.07] px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 transition-colors">
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-sky-300/90">Where you are</span>
      <span className="flex items-center gap-2 min-w-0">
        {icon && <WeatherIcon id={icon} isDay={c?.isDay ?? true} size={18} />}
        <span className="text-lg font-extrabold font-mono text-slate-100 leading-none">{c?.tempF != null ? `${c.tempF}°` : "—"}</span>
        <span className="text-[12px] font-semibold text-slate-200 truncate">{h.label}</span>
        {h.tdy && <span className="text-[9px] font-mono text-amber-300/90">TDY · day {h.tdy.day} of {h.tdy.days}</span>}
      </span>
      <span className="hidden sm:block w-px h-4 bg-slate-700" />
      <span className="text-[11px] text-slate-300 min-w-0 truncate">
        {c ? [cond ? cond.toLowerCase() : null, c.highF != null && c.lowF != null ? `↑${c.highF}° ↓${c.lowF}°` : null, c.precipChancePct != null ? `💧 ${c.precipChancePct}%` : null, c.windMph != null ? `${c.windMph} mph ${compass(c.windDir)}` : null].filter(Boolean).join(" · ") : <span className="text-slate-500">conditions UNKNOWN — Open-Meteo unreachable</span>}
      </span>
      {af && (
        <>
          <span className="hidden sm:block w-px h-4 bg-slate-700" />
          <span className="flex items-center gap-1.5 text-[11px] text-slate-300 min-w-0">
            <span className="font-mono font-bold text-slate-100">{af.icao}</span>
            <Cat cat={af.cat} />
            {tafTurn && <><span className="text-slate-500">→</span><Cat cat={tafTurn.worst} /><span className="text-slate-400">by {zHour(tafTurn.fromISO)}</span></>}
            {af.hazard && <span className={`text-[10px] ${af.hazard.severity === "severe" ? "text-red-300" : "text-amber-300"} truncate`} title={af.hazard.flags.join(" · ")}>{af.hazard.flags[0]}</span>}
            {!d.live.awc && <span className="text-[9px] text-slate-500">AWC down</span>}
          </span>
        </>
      )}
      {hm && (
        <>
          <span className="hidden sm:block w-px h-4 bg-slate-700" />
          <span className="flex items-center gap-1.5 text-[10.5px] text-slate-500 min-w-0 truncate">
            home {hm.label} {hm.current?.tempF != null ? `${hm.current.tempF}°` : ""} {hmIcon ? WEATHER_ICON_LABEL[hmIcon].toLowerCase() : ""}
            {hm.icao && <><span className="font-mono text-slate-400">{hm.icao}</span>{hm.cat && <Cat cat={hm.cat} />}</>}
          </span>
        </>
      )}
      <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-500">Weather →</span>
    </button>
  );
}
