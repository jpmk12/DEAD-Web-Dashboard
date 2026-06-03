"use client";

import { useEffect, useState } from "react";
import { ForecastPeriod, WeatherAlert, TrackedLocation } from "@/lib/types";
import { Sparkline, PrecipBars } from "./Sparkline";

interface LocationCardProps {
  location: TrackedLocation;
  active: boolean;
  onSelect: () => void;
}

const SEVERITY_COLOUR: Record<WeatherAlert["severity"], string> = {
  Extreme:  "bg-red-500 text-slate-950",
  Severe:   "bg-orange-500 text-slate-950",
  Moderate: "bg-amber-500 text-slate-950",
  Minor:    "bg-yellow-500/70 text-slate-950",
  Unknown:  "bg-slate-700 text-slate-200",
};

// Compact location card. Shows current temp/condition, today's high/low,
// any active NWS alert, and the next 4 forecast periods.
export default function LocationCard({ location, active, onSelect }: LocationCardProps) {
  const [periods, setPeriods] = useState<ForecastPeriod[]>([]);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setLoading(true);
    setUnavailable(false);
    const ctrl = new AbortController();
    Promise.all([
      fetch(`/api/weather/forecast?lat=${location.lat}&lon=${location.lon}`, { signal: ctrl.signal })
        .then((r) => r.json()),
      fetch(`/api/weather/alerts?lat=${location.lat}&lon=${location.lon}`, { signal: ctrl.signal })
        .then((r) => r.json()),
    ])
      .then(([f, a]) => {
        const ps: ForecastPeriod[] = f.periods ?? [];
        setPeriods(ps);
        setAlerts(a.alerts ?? []);
        if (ps.length === 0) setUnavailable(true);
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [location.lat, location.lon]);

  const now = periods[0];
  const topAlert = alerts[0];

  return (
    <button
      onClick={onSelect}
      className={`text-left bg-slate-900/70 rounded-xl border p-3 transition-all w-full ${
        active
          ? "border-sky-500/60 shadow-[0_0_14px_-4px_rgb(56_189_248_/_0.5)]"
          : "border-slate-800 hover:border-slate-700"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-200 truncate">{location.label}</p>
          <p className="text-[9px] text-slate-600 font-mono">
            {location.lat.toFixed(2)}, {location.lon.toFixed(2)}
          </p>
        </div>
        {topAlert && (
          <span
            className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${SEVERITY_COLOUR[topAlert.severity]}`}
            title={topAlert.headline}
          >
            ⚠ {topAlert.severity}
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-1.5">
          <div className="h-3 bg-slate-800 rounded animate-pulse w-3/4" />
          <div className="h-2 bg-slate-800 rounded animate-pulse w-1/2" />
        </div>
      )}

      {!loading && unavailable && (
        <p className="text-[10px] text-slate-600 italic">
          Forecast unavailable (NWS covers US territory only).
        </p>
      )}

      {!loading && !unavailable && now && (
        <>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold text-slate-100 leading-none">{now.tempF}°</span>
            <span className="text-[10px] text-slate-500 font-mono uppercase">
              {now.windSpeed} {now.windDirection}
            </span>
          </div>
          <p className="text-[10px] text-slate-400 line-clamp-1 mb-2">{now.shortForecast}</p>

          {/* Next 4 periods strip */}
          <div className="grid grid-cols-4 gap-1 mt-2 pt-2 border-t border-slate-800">
            {periods.slice(1, 5).map((p) => (
              <div key={p.startTime} className="text-center">
                <p className="text-[9px] text-slate-600 truncate" title={p.name}>
                  {p.name.replace(/^(This|Tonight|Today)/, "").trim() || p.name.slice(0, 4)}
                </p>
                <p className="text-[11px] font-bold text-slate-300">{p.tempF}°</p>
              </div>
            ))}
          </div>

          {/* 7-day trend: temperature sparkline + precip-probability bars */}
          {periods.length >= 4 && (() => {
            const temps = periods.map((p) => p.tempF);
            const precip = periods.map((p) => p.precipPercent ?? 0);
            const maxTemp = Math.max(...temps);
            const minTemp = Math.min(...temps);
            const maxPrecip = Math.max(...precip);
            return (
              <div className="mt-2 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[8px] uppercase tracking-widest text-slate-600">7-day trend</span>
                  <span className="text-[9px] font-mono text-slate-500">
                    {minTemp}°–{maxTemp}°{maxPrecip > 0 ? ` · ${maxPrecip}% precip` : ""}
                  </span>
                </div>
                <Sparkline values={temps} width={170} height={26} />
                {maxPrecip > 0 && <PrecipBars values={precip} width={170} height={10} />}
              </div>
            );
          })()}
        </>
      )}
    </button>
  );
}
