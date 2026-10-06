"use client";

import { useEffect, useState } from "react";
import { SpaceWeather } from "@/lib/types";
import { spaceWxSentence, type SpaceWxImpact, type NoaaScales } from "@/lib/spaceWeatherOps";

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

const LED_DOT: Record<string, string> = { g: "bg-emerald-400", a: "bg-amber-400", r: "bg-red-500", u: "bg-slate-600" };

interface SpaceOps { scales: NoaaScales; impacts: SpaceWxImpact[]; severe: { scale: string; level: number }[]; polar: boolean | null; gShare?: { hits: number; observed: number; label: string } | null }

/**
 * Space weather → ops (REVIEW-CYBER-SPACE §4.7). The Kp / G / R / S readings
 * stay, but the card now says what they mean for a crew — HF on oceanic
 * legs, GPS approach integrity, SATCOM margins, dose at altitude — with the
 * 3-day outlook, read against the Mission Profile's polar declaration.
 * Environment, never warning: the rows earn an LED, never an I&W level.
 */
export default function SpaceWeatherCard({ onLoaded }: { onLoaded?: (ok: boolean) => void } = {}) {
  const [data, setData] = useState<SpaceWeather | null>(null);
  const [ops, setOps] = useState<SpaceOps | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(false);

  useEffect(() => {
    fetch("/api/weather/space")
      .then((r) => r.json())
      .then((d) => { setData(d.space ?? null); setOps(d.ops ?? null); onLoaded?.(!!(d.ops?.scales?.live)); })
      .catch(() => onLoaded?.(false))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!data && !ops) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Space weather</h3>
        <p className="text-[11px] text-slate-500 mt-1"><b className="text-slate-300">Space weather UNKNOWN.</b> NOAA SWPC unreachable — HF / GPS / SATCOM impact not known, not quiet.</p>
      </div>
    );
  }

  // Crude 8-point sparkline from kpHistory.
  const maxKp = 9;
  const w = 80, h = 24;
  const hist = data?.kpHistory ?? [];
  const pts = hist.length > 1
    ? hist.map((p, i) => {
        const x = (i / (hist.length - 1)) * w;
        const y = h - (Math.min(p.value, maxKp) / maxKp) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ")
    : "";

  const severe = ops?.severe ?? [];
  // REVIEW-2026-10 W9: ONE sentence a crew can use leads; the scales and
  // the history fold under it.
  const sentence = ops ? spaceWxSentence(ops.scales, ops.impacts) : null;
  const toneCls = sentence?.tone === "r" ? "border-red-500/40" : sentence?.tone === "a" ? "border-amber-500/40" : "border-slate-800";

  return (
    <div className={`bg-slate-900/60 border rounded-xl p-4 ${toneCls}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-5 h-5 rounded bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <span className="text-violet-400 text-[10px]">☀</span>
        </div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Space weather</h3>
        {sentence && (
          <span className="text-[12.5px] text-slate-200 min-w-0">
            <b className={sentence.tone === "r" ? "text-red-300" : sentence.tone === "a" ? "text-amber-300" : sentence.tone === "u" ? "text-slate-300" : "text-emerald-300"}>{sentence.lead}</b> {sentence.detail}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[9px] text-slate-700 font-mono">NOAA SWPC</span>
          <button type="button" onClick={() => setDetail((v) => !v)} className="text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300">Kp · G/R/S · history {detail ? "▴" : "▾"}</button>
        </span>
      </div>
      {ops && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {ops.impacts.map((imp) => (
            <span key={imp.key} className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-400" title={`${imp.now} · outlook: ${imp.outlook}`}>
              <span className={`w-2 h-2 rounded-full ${LED_DOT[imp.led] ?? LED_DOT.u}`} />{imp.label}{imp.relevance === "not declared" ? <span className="text-slate-600"> — polar routes not declared</span> : null}
            </span>
          ))}
        </div>
      )}

      {detail && data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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

          <div className={`rounded-lg p-3 border ${scaleClass(data.geoStorm)}`}>
            <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">Geomagnetic</p>
            <p className="text-2xl font-bold">{data.geoStorm}</p>
            <p className="text-[9px] mt-1 font-mono opacity-70">G-scale · GPS / SATCOM</p>
          </div>

          <div className={`rounded-lg p-3 border ${scaleClass(data.radioBlackout)}`}>
            <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">Radio blackout</p>
            <p className="text-2xl font-bold">{data.radioBlackout}</p>
            <p className="text-[9px] mt-1 font-mono opacity-70">R-scale · flare {data.currentFlareClass} · HF</p>
          </div>

          <div className={`rounded-lg p-3 border ${scaleClass(data.radiationStorm)}`}>
            <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">Radiation</p>
            <p className="text-2xl font-bold">{data.radiationStorm}</p>
            <p className="text-[9px] mt-1 font-mono opacity-70">S-scale · polar dose / HF</p>
          </div>
        </div>
      )}

      {/* The reframe: what it means for the crew, with the outlook. */}
      {detail && ops && (
        <div className="mt-3 border-t border-slate-800/70 pt-2.5 space-y-1.5">
          {ops.impacts.map((imp) => (
            <div key={imp.key} className="flex items-start gap-2.5">
              <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${LED_DOT[imp.led] ?? LED_DOT.u}`} />
              <div className="min-w-0 text-[11.5px] text-slate-300 leading-relaxed">
                <b className="text-slate-200">{imp.label}:</b> {imp.now}
                {imp.relevance === "not declared" && <span className="text-slate-600"> · not declared</span>}
                <span className="block text-[9.5px] text-slate-600">outlook: {imp.outlook}</span>
              </div>
            </div>
          ))}
          {ops.scales.live && ops.scales.outlook.length > 0 && (
            <p className="text-[9.5px] text-slate-600 font-mono pt-1">
              3-day: {ops.scales.outlook.map((d) => `${d.date.slice(5)} R${d.R ?? "?"}/S${d.S ?? "?"}/G${d.G ?? "?"}`).join(" · ")}
            </p>
          )}
          {!ops.scales.live && <p className="text-[9.5px] text-slate-600">SWPC scales feed unreachable — outlook UNKNOWN.</p>}
          {ops.gShare && (
            <p className="text-[9.5px] text-slate-600 font-mono" title="From the app's own daily record of SWPC's observed G-scale; of days the app observed.">
              History: {ops.gShare.label}
            </p>
          )}
        </div>
      )}

      {detail && <p className="text-[9px] text-slate-700 mt-2 leading-relaxed">
        Environment, not warning: these rows colour the SITREP Spectrum card and the C2/Comms LIMFAC and page you at R3/G3/S3+; they never raise an I&amp;W level, and a G3+ storm is attributed before any GPS-jamming read.
        {ops?.polar === false && " Polar / HF routes: not declared (Mission Profile)."}
      </p>}
    </div>
  );
}
