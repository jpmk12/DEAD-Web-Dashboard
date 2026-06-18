"use client";

import { useEffect, useState } from "react";
import { ForecastPeriod, WeatherAlert, TrackedLocation } from "@/lib/types";
import type { CurrentConditions } from "@/lib/currentConditions";
import { Sparkline, PrecipBars } from "./Sparkline";
import {
  WeatherIcon, conditionIconId, wmoIconId, WEATHER_ICON_LABEL,
  SunriseIcon, SunsetIcon,
} from "@/lib/weatherIcon";

interface LocationCardProps {
  location: TrackedLocation;
  active: boolean;
  onSelect: () => void;
  tag?: "home" | "tdy";
}

const SEVERITY_COLOUR: Record<WeatherAlert["severity"], string> = {
  Extreme:  "bg-red-500 text-slate-950",
  Severe:   "bg-orange-500 text-slate-950",
  Moderate: "bg-amber-500 text-slate-950",
  Minor:    "bg-yellow-500/70 text-slate-950",
  Unknown:  "bg-slate-700 text-slate-200",
};

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function degToCompass(deg: number | null): string {
  if (deg == null) return "";
  return COMPASS[Math.round(deg / 22.5) % 16];
}

// Open-Meteo returns local ISO ("2026-06-17T05:42") because we request
// timezone=auto, so the clock time is already local — just format it.
function fmtLocalTime(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return "";
  let h = Number(m[1]);
  const ap = h < 12 ? "a" : "p";
  h = h % 12 || 12;
  return `${h}:${m[2]}${ap}`;
}

function fmtWindow(eff: string, exp: string): string {
  const t = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };
  const a = t(eff), b = t(exp);
  if (!a && !b) return "";
  return `${a || "now"} → ${b || "?"}`;
}

// Compact location card. Current temp + condition glyph, feels-like / humidity /
// gusts, today's high/low + precip, sunrise/sunset, the next 4 periods (with
// mini-icons), a 7-day trend, and an expandable alert. NWS drives the named
// periods/condition text; Open-Meteo (global) supplies the enrichment + a
// current-conditions fallback so the card isn't blank OCONUS.
export default function LocationCard({ location, active, onSelect, tag }: LocationCardProps) {
  const [periods, setPeriods] = useState<ForecastPeriod[]>([]);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [current, setCurrent] = useState<CurrentConditions | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    setUnavailable(false);
    setAlertOpen(false);
    const ctrl = new AbortController();
    Promise.all([
      fetch(`/api/weather/forecast?lat=${location.lat}&lon=${location.lon}`, { signal: ctrl.signal }).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/weather/alerts?lat=${location.lat}&lon=${location.lon}`, { signal: ctrl.signal }).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/weather/current?lat=${location.lat}&lon=${location.lon}`, { signal: ctrl.signal }).then((r) => r.json()).catch(() => ({})),
    ])
      .then(([f, a, c]) => {
        const ps: ForecastPeriod[] = f.periods ?? [];
        const cur: CurrentConditions | null = c.current ?? null;
        setPeriods(ps);
        setAlerts(a.alerts ?? []);
        setCurrent(cur);
        // Unavailable only if BOTH sources are empty (NWS US-only; Open-Meteo global).
        if (ps.length === 0 && !cur) setUnavailable(true);
      })
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [location.lat, location.lon]);

  const now = periods[0];
  const topAlert = alerts[0];

  // Display values: prefer NWS for temp/condition wording, fall back to Open-Meteo.
  const hasNws = !!now;
  const tempF = hasNws ? now.tempF : current?.tempF ?? null;
  const isDay = hasNws ? now.isDaytime : current?.isDay ?? true;
  const iconId = hasNws
    ? conditionIconId(now.shortForecast, now.isDaytime)
    : current?.weatherCode != null ? wmoIconId(current.weatherCode, current.isDay) : "cloudsun";
  const conditionText = hasNws ? now.shortForecast : (current?.weatherCode != null ? WEATHER_ICON_LABEL[iconId] : "");
  const windText = hasNws
    ? `${now.windSpeed} ${now.windDirection}`.trim()
    : current?.windMph != null ? `${current.windMph} mph ${degToCompass(current.windDir)}`.trim() : "";
  const precipPct = now?.precipPercent ?? current?.precipChancePct ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={`text-left bg-slate-900/70 rounded-xl border p-3 transition-all w-full cursor-pointer ${
        active
          ? "border-sky-500/60 shadow-[0_0_14px_-4px_rgb(56_189_248_/_0.5)]"
          : "border-slate-800 hover:border-slate-700"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          {tag && (
            <span
              className={`inline-flex items-center gap-1 mb-0.5 px-1.5 py-0.5 rounded border text-[8px] font-bold uppercase tracking-wider ${
                tag === "home"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/40"
              }`}
            >
              {tag === "home" ? "🏠 Home" : "✈ TDY"}
            </span>
          )}
          <p className="text-xs font-bold text-slate-200 truncate">{location.label}</p>
          <p className="text-[9px] text-slate-600 font-mono">
            {location.lat.toFixed(2)}, {location.lon.toFixed(2)}
          </p>
        </div>
        {topAlert && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setAlertOpen((o) => !o); }}
            className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${SEVERITY_COLOUR[topAlert.severity]}`}
            title={topAlert.headline}
          >
            ⚠ {topAlert.severity}
          </button>
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
          Forecast unavailable for this location.
        </p>
      )}

      {!loading && !unavailable && (
        <>
          <div className="flex items-center gap-2.5 mb-1">
            <WeatherIcon id={iconId} isDay={isDay} size={30} title={conditionText || undefined} />
            <span className="text-2xl font-bold text-slate-100 leading-none">{tempF != null ? `${tempF}°` : "—"}</span>
            {windText && <span className="text-[10px] text-slate-500 font-mono uppercase leading-tight">{windText}{current?.gustMph != null ? <> · <span className="text-red-400">G{current.gustMph}</span></> : null}</span>}
          </div>
          {conditionText && <p className="text-[10px] text-slate-400 line-clamp-1">{conditionText}</p>}

          {/* Metrics: precip · feels-like · humidity · high/low */}
          {(precipPct != null || current?.feelsLikeF != null || current?.humidityPct != null || current?.highF != null) && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[10px] text-slate-400">
              {precipPct != null && <span>💧 <b className="text-slate-300 font-semibold">{precipPct}%</b></span>}
              {current?.feelsLikeF != null && <span>feels <b className="text-slate-300 font-semibold">{current.feelsLikeF}°</b></span>}
              {current?.humidityPct != null && <span>hum <b className="text-slate-300 font-semibold">{current.humidityPct}%</b></span>}
              {current?.highF != null && current?.lowF != null && <span>↑<b className="text-slate-300 font-semibold">{current.highF}°</b> ↓<b className="text-slate-300 font-semibold">{current.lowF}°</b></span>}
            </div>
          )}

          {/* Sunrise / sunset */}
          {(current?.sunrise || current?.sunset) && (
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
              {current?.sunrise && <span className="inline-flex items-center gap-1"><SunriseIcon size={13} className="text-amber-400" /> {fmtLocalTime(current.sunrise)}</span>}
              {current?.sunset && <span className="inline-flex items-center gap-1"><SunsetIcon size={13} className="text-orange-400" /> {fmtLocalTime(current.sunset)}</span>}
            </div>
          )}

          {/* Expanded alert detail */}
          {topAlert && alertOpen && (
            <div className="mt-2.5 px-2.5 py-2 rounded-lg bg-orange-500/[0.08] border border-orange-500/30">
              <p className="text-[11px] font-bold text-orange-300">{topAlert.event}</p>
              {topAlert.headline && <p className="text-[10px] text-slate-300 leading-snug my-1">{topAlert.headline}</p>}
              <p className="text-[9px] text-slate-500 font-mono">
                {fmtWindow(topAlert.effective, topAlert.expires)}{topAlert.areaDesc ? ` · ${topAlert.areaDesc.split(";")[0]}` : ""}
              </p>
            </div>
          )}

          {/* Next 4 periods with mini-icons (NWS only) */}
          {periods.length > 1 && (
            <div className="grid grid-cols-4 gap-1 mt-2 pt-2 border-t border-slate-800">
              {periods.slice(1, 5).map((p) => (
                <div key={p.startTime} className="text-center">
                  <p className="text-[9px] text-slate-600 truncate" title={p.name}>
                    {p.name.replace(/^(This|Tonight|Today)/, "").trim() || p.name.slice(0, 4)}
                  </p>
                  <div className="flex justify-center my-0.5">
                    <WeatherIcon id={conditionIconId(p.shortForecast, p.isDaytime)} isDay={p.isDaytime} size={16} strokeWidth={2} title={p.shortForecast || undefined} />
                  </div>
                  <p className="text-[11px] font-bold text-slate-300">{p.tempF}°</p>
                  {p.precipPercent != null && p.precipPercent > 0 && <p className="text-[8px] font-mono text-sky-400">{p.precipPercent}%</p>}
                </div>
              ))}
            </div>
          )}

          {/* 7-day trend: temperature sparkline + precip-probability bars (NWS only) */}
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

          {!hasNws && current && (
            <p className="text-[8px] text-slate-600 mt-1.5 font-mono">Current conditions · Open-Meteo</p>
          )}
        </>
      )}
    </div>
  );
}
