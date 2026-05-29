"use client";

import { useEffect, useState } from "react";
import { SpaceWeather } from "@/lib/types";

// NOAA scale colour mapping (G/R/S 0..5). G0/R0/S0 = green; rises through
// yellow/orange/red to deep red.
const SCALE_COLOUR = ["bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                      "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
                      "bg-amber-500/15 text-amber-400 border-amber-500/30",
                      "bg-orange-500/15 text-orange-400 border-orange-500/30",
                      "bg-red-500/15 text-red-400 border-red-500/30",
                      "bg-red-500/30 text-red-200 border-red-500/60"];

function scaleClass(label: string): string {
  const n = parseInt(label.slice(1) || "0", 10);
  return SCALE_COLOUR[Math.max(0, Math.min(5, n))];
}

function kpClass(kp: number): string {
  if (kp >= 7) return "text-red-400";
  if (kp >= 5) return "text-orange-400";
  if (kp >= 4) return "text-amber-400";
  return "text-emerald-400";
}

export default function SpaceWeatherCard() {
  const [data, setData] = useState<SpaceWeather | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/weather/space")
      .then((r) => r.json())
      .then((d) => setData(d.space ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 animate-pulse">
        <div className="h-3 bg-slate-800 rounded w-32 mb-3" />
        <div className="grid grid-cols-3 gap-3">
          <div className="h-12 bg-slate-800 rounded" />
          <div className="h-12 bg-slate-800 rounded" />
          <div className="h-12 bg-slate-800 rounded" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Crude 8-point sparkline from kpHistory.
  const maxKp = 9;
  const w = 80, h = 24;
  const pts = data.kpHistory.length > 1
    ? data.kpHistory.map((p, i) => {
        const x = (i / (data.kpHistory.length - 1)) * w;
        const y = h - (Math.min(p.value, maxKp) / maxKp) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ")
    : "";

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <span className="text-violet-400 text-[10px]">☀</span>
        </div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Space Weather
        </h3>
        <span className="ml-auto text-[9px] text-slate-700 font-mono">NOAA SWPC</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {/* Kp index + sparkline */}
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/60 sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Kp Index</p>
              <p className={`text-2xl font-bold ${kpClass(data.currentKp ?? 0)}`}>
                {data.currentKp != null ? data.currentKp.toFixed(2) : "—"}
              </p>
            </div>
            {pts && (
              <svg width={w} height={h} className="opacity-80">
                <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5"
                  className={kpClass(data.currentKp ?? 0)} />
              </svg>
            )}
          </div>
          <p className="text-[9px] text-slate-600 mt-1 font-mono">last 24h, 3-hourly</p>
        </div>

        {/* Geomagnetic storm scale */}
        <div className={`rounded-lg p-3 border ${scaleClass(data.geoStorm)}`}>
          <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">Geomagnetic</p>
          <p className="text-2xl font-bold">{data.geoStorm}</p>
          <p className="text-[9px] mt-1 font-mono opacity-70">G-scale storm</p>
        </div>

        {/* Radio blackout / X-ray flare */}
        <div className={`rounded-lg p-3 border ${scaleClass(data.radioBlackout)}`}>
          <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">X-Ray Flare</p>
          <p className="text-2xl font-bold">{data.currentFlareClass}</p>
          <p className="text-[9px] mt-1 font-mono opacity-70">→ {data.radioBlackout} blackout</p>
        </div>
      </div>

      <p className="text-[9px] text-slate-700 mt-2 leading-relaxed">
        Kp ≥ 5 = G1 storm (HF degradation). X-class flares = HF radio blackout on the dayside; M5+ may impact SATCOM links.
      </p>
    </div>
  );
}
