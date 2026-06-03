"use client";

import { useEffect, useState } from "react";
import { WeatherThreats, SevereThreat, DisasterEvent } from "@/lib/types";

const DISASTER_ICON: Record<DisasterEvent["type"], string> = {
  earthquake: "⊕", cyclone: "🌀", flood: "≈", volcano: "⛰", drought: "☼",
  tsunami: "≋", epidemic: "✚", wildfire: "🔥", other: "•",
};
const DISASTER_SEV: Record<DisasterEvent["severity"], string> = {
  red: "text-red-400", orange: "text-orange-400", green: "text-emerald-500", unknown: "text-slate-400",
};

const SEV_COLOUR: Record<SevereThreat["severity"], string> = {
  Extreme:  "border-red-500 bg-red-500/10 text-red-300",
  Severe:   "border-orange-500 bg-orange-500/10 text-orange-300",
  Moderate: "border-amber-500 bg-amber-500/10 text-amber-300",
  Minor:    "border-yellow-500/60 bg-yellow-500/5 text-yellow-300",
  Unknown:  "border-slate-700 bg-slate-800/40 text-slate-400",
};

const EMPTY: WeatherThreats = { threats: [], tropical: [], disasters: [], summary: { extreme: 0, severe: 0, lifeThreatening: 0, total: 0, topEvent: null, disasters: 0, disastersRed: 0 } };

export default function ThreatBoard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<WeatherThreats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    const controller = new AbortController();
    fetch("/api/weather/threats", { signal: controller.signal })
      .then((r) => r.json())
      .then((d: WeatherThreats) => setData(d ?? EMPTY))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [refreshKey]);

  const { threats, tropical, disasters, summary } = data;
  if (loading && threats.length === 0 && tropical.length === 0 && disasters.length === 0) return null;

  const allClear = threats.length === 0 && tropical.length === 0 && disasters.length === 0;

  return (
    <div className="space-y-2">
      {/* Summary banner */}
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
        summary.lifeThreatening > 0 ? "border-red-500/50 bg-red-500/10"
        : threats.length > 0 ? "border-amber-500/40 bg-amber-500/5"
        : "border-slate-800 bg-slate-900/60"
      }`}>
        <span className={summary.lifeThreatening > 0 ? "text-red-400" : threats.length > 0 ? "text-amber-400" : "text-emerald-500"}>
          {allClear ? "✓" : "⚠"}
        </span>
        <h3 className="text-[10px] font-bold uppercase tracking-widest flex-1 text-slate-300">
          Threats &amp; Disasters
        </h3>
        {allClear ? (
          <span className="text-[10px] text-slate-500 font-mono">no active threats</span>
        ) : (
          <span className="text-[10px] font-mono text-slate-400">
            {summary.lifeThreatening > 0 && <span className="text-red-400 font-bold">{summary.lifeThreatening} life-threatening · </span>}
            {summary.total} alert{summary.total === 1 ? "" : "s"}
            {tropical.length > 0 && <span className="text-sky-400"> · {tropical.length} tropical</span>}
            {disasters.length > 0 && <span className={summary.disastersRed > 0 ? "text-red-400" : "text-orange-400"}> · {disasters.length} disaster{disasters.length === 1 ? "" : "s"}</span>}
          </span>
        )}
      </div>

      {/* Global disaster watch (GDACS / USGS / ReliefWeb) */}
      {disasters.length > 0 && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-orange-400 mb-1">Global Disaster Watch</p>
          <ul className="space-y-1">
            {disasters.slice(0, 8).map((d) => (
              <li key={d.id} className="text-[11px] flex flex-wrap items-baseline gap-x-2">
                <span className={`flex-shrink-0 ${DISASTER_SEV[d.severity]}`}>{DISASTER_ICON[d.type]}</span>
                <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-emerald-400 transition-colors">
                  {d.title}
                </a>
                {d.country && <span className="text-slate-500 text-[10px]">{d.country}</span>}
                {d.nearLocations.length > 0 && (
                  <span className="text-[9px] font-bold uppercase tracking-wider text-red-400 border border-red-500/40 rounded px-1">
                    near {d.nearLocations.join(", ")}
                  </span>
                )}
                <span className="text-slate-700 text-[9px] font-mono">{d.source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tropical systems */}
      {tropical.length > 0 && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-sky-400 mb-1">Active Tropical Systems</p>
          <ul className="space-y-1">
            {tropical.map((s) => (
              <li key={s.id} className="text-[11px] text-slate-300 flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold text-sky-300">{s.category} {s.name}</span>
                {s.intensityKt != null && <span className="text-slate-400 font-mono text-[10px]">{s.intensityKt} kt</span>}
                {s.pressureMb != null && <span className="text-slate-500 font-mono text-[10px]">{s.pressureMb} mb</span>}
                {s.movement && <span className="text-slate-500 text-[10px]">moving {s.movement}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Alerts */}
      {threats.map((a) => {
        const open = expanded.has(a.id);
        return (
          <div key={a.id} className={`border-l-4 rounded-md ${SEV_COLOUR[a.severity]}`}>
            <button
              onClick={() => setExpanded((p) => { const n = new Set(p); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}
              className="w-full text-left px-3 py-2 flex items-baseline justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold truncate">
                  {a.lifeThreatening && <span className="text-red-400 mr-1">●</span>}
                  {a.event}
                  <span className="text-slate-400 font-normal ml-2">· {a.locations.join(", ")}</span>
                </p>
                {!open && <p className="text-[10px] text-slate-400 truncate">{a.headline}</p>}
              </div>
              <span className="text-[10px] font-mono opacity-70 flex-shrink-0">{open ? "▲" : "▼"}</span>
            </button>
            {open && (
              <div className="px-3 pb-2 text-[11px] leading-relaxed">
                <p className="mb-1.5">{a.headline}</p>
                <p className="text-slate-400 font-mono text-[10px]">Area: <span className="text-slate-300">{a.areaDesc}</span></p>
                {a.expires && (
                  <p className="text-slate-400 font-mono text-[10px]">
                    Expires: <span className="text-slate-300">{new Date(a.expires).toLocaleString()}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
