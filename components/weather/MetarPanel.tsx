"use client";

import { useEffect, useState } from "react";
import { MetarStation, StationWx, FlightCategory } from "@/lib/types";

const CATEGORY_STYLE: Record<FlightCategory, { cls: string; title: string }> = {
  VFR:     { cls: "text-green-400 bg-green-500/10 border-green-500/30",       title: "Visual conditions" },
  MVFR:    { cls: "text-sky-400 bg-sky-500/10 border-sky-500/30",            title: "Marginal visual conditions" },
  IFR:     { cls: "text-red-400 bg-red-500/10 border-red-500/30",            title: "Instrument conditions" },
  LIFR:    { cls: "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30", title: "Low instrument conditions" },
  UNKNOWN: { cls: "text-slate-400 bg-slate-700/40 border-slate-600/40",      title: "Unknown" },
};

function obsAge(iso: string): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

function tafTime(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-[10px] font-mono">
      <span className="text-slate-600 uppercase">{label}</span>
      <span className="text-slate-300">{value}</span>
    </span>
  );
}

function StationCard({ station, wx }: { station: MetarStation; wx: StationWx | undefined }) {
  const [showDetail, setShowDetail] = useState(false);
  const m = wx?.metar ?? null;
  const cat = m?.flightCategory ?? "UNKNOWN";
  const style = CATEGORY_STYLE[cat];

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200 truncate">{station.label}</span>
            <span className="text-[10px] font-mono text-slate-500">{station.icao}</span>
          </div>
          {m?.observedAt && (
            <span className="text-[9px] text-slate-600 font-mono">obs {obsAge(m.observedAt)}</span>
          )}
        </div>
        <span
          title={style.title}
          className={`flex-shrink-0 text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${style.cls}`}
        >
          {cat}
        </span>
      </div>

      {wx?.error || !m ? (
        <p className="mt-2 text-[11px] text-slate-600 italic">{wx?.error ?? "No current observation."}</p>
      ) : (
        <>
          <p className="mt-2 text-[11px] text-slate-300 leading-relaxed">{m.summary}</p>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {m.windSpeedKt != null && (
              <Chip label="wind" value={m.windSpeedKt === 0 ? "calm" : `${m.windVariable ? "VRB" : m.windDir ?? "—"}@${m.windSpeedKt}${m.windGustKt ? `G${m.windGustKt}` : ""}kt`} />
            )}
            {m.visibilityMi != null && <Chip label="vis" value={`${m.visibilityMi >= 10 ? "10+" : m.visibilityMi} mi`} />}
            <Chip label="ceil" value={m.ceilingFt != null ? `${m.ceilingFt.toLocaleString()} ft` : "none"} />
            {m.tempC != null && <Chip label="temp" value={`${m.tempC}°C`} />}
            {m.altimeterInHg != null && <Chip label="alt" value={`${m.altimeterInHg.toFixed(2)}"`} />}
            {m.pressureTendency != null && m.pressureTendency !== 0 && (
              <Chip label="baro" value={m.pressureTendency > 0 ? "↑ rising" : "↓ falling"} />
            )}
          </div>

          {m.weather && <p className="mt-1.5 text-[10px] text-amber-400">⚠ {m.weather}</p>}

          <button
            onClick={() => setShowDetail((v) => !v)}
            className="mt-2 text-[10px] font-mono text-slate-500 hover:text-sky-400 transition-colors"
          >
            {showDetail ? "− hide raw / forecast" : "+ raw & TAF forecast"}
          </button>

          {showDetail && (
            <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
              <pre className="text-[10px] font-mono text-slate-500 whitespace-pre-wrap break-words">{m.raw}</pre>
              {wx?.taf && wx.taf.periods.length > 0 ? (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">
                    TAF{wx.taf.issuedAt ? ` · issued ${tafTime(wx.taf.issuedAt)}` : ""}
                  </p>
                  <ul className="space-y-1">
                    {wx.taf.periods.map((p, i) => (
                      <li key={i} className="flex gap-2 text-[10px]">
                        <span className={`flex-shrink-0 font-bold w-9 text-center rounded ${CATEGORY_STYLE[p.flightCategory].cls}`}>
                          {p.flightCategory}
                        </span>
                        <span className="text-slate-600 font-mono flex-shrink-0 w-20">{tafTime(p.from)}</span>
                        <span className="text-slate-400 min-w-0">{p.changeType ? `${p.changeType}: ` : ""}{p.summary}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[10px] text-slate-600 italic">No TAF issued for this field.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MetarPanel({ stations, refreshKey = 0 }: { stations: MetarStation[]; refreshKey?: number }) {
  const [data, setData] = useState<Record<string, StationWx>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (stations.length === 0) { setData({}); return; }
    const ids = stations.map((s) => s.icao).join(",");
    setLoading(true);
    const controller = new AbortController();
    fetch(`/api/weather/metar?ids=${encodeURIComponent(ids)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setData(d.stations ?? {}))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [stations, refreshKey]);

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">METAR / TAF — Decoded</h3>
        <div className="flex items-center gap-2">
          {loading && <span className="text-[9px] text-slate-600 font-mono animate-pulse">loading…</span>}
          <a
            href="https://aviationweather.gov/gfa/#sigmet"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono font-bold text-amber-400 hover:text-amber-300 transition-colors"
          >
            SIGMET ↗
          </a>
        </div>
      </div>

      {stations.length === 0 ? (
        <p className="text-[11px] text-slate-600 font-mono">
          Add airfields in <span className="text-emerald-400">Preferences → METAR / TAF Stations</span>.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {stations.map((s) => (
            <StationCard key={s.icao} station={s} wx={data[s.icao]} />
          ))}
        </div>
      )}
    </div>
  );
}
