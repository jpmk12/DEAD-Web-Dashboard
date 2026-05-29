"use client";

import { useEffect, useState } from "react";
import { WeatherAlert, TrackedLocation } from "@/lib/types";

interface AlertsPanelProps {
  locations: TrackedLocation[];
}

interface AlertWithLocation extends WeatherAlert {
  locationLabel: string;
}

const SEV_RANK: Record<WeatherAlert["severity"], number> = {
  Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4,
};

const SEV_COLOUR: Record<WeatherAlert["severity"], string> = {
  Extreme:  "border-red-500 bg-red-500/10 text-red-300",
  Severe:   "border-orange-500 bg-orange-500/10 text-orange-300",
  Moderate: "border-amber-500 bg-amber-500/10 text-amber-300",
  Minor:    "border-yellow-500/60 bg-yellow-500/5 text-yellow-300",
  Unknown:  "border-slate-700 bg-slate-800/40 text-slate-400",
};

// Aggregates NWS active alerts across every tracked location. Sorted by
// severity. Collapsed to a single line per alert unless expanded.
export default function AlertsPanel({ locations }: AlertsPanelProps) {
  const [alerts, setAlerts] = useState<AlertWithLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (locations.length === 0) { setLoading(false); return; }
    setLoading(true);
    Promise.all(
      locations.map((loc) =>
        fetch(`/api/weather/alerts?lat=${loc.lat}&lon=${loc.lon}`)
          .then((r) => r.json())
          .then((d: { alerts?: WeatherAlert[] }) =>
            (d.alerts ?? []).map((a) => ({ ...a, locationLabel: loc.label }))
          )
          .catch(() => [] as AlertWithLocation[])
      )
    ).then((results) => {
      const merged = results.flat();
      // Dedupe by id; one alert can cover multiple tracked locations.
      const seen = new Set<string>();
      const deduped = merged.filter((a) => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      });
      deduped.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
      setAlerts(deduped);
    }).finally(() => setLoading(false));
  }, [locations]);

  if (loading) return null;
  if (alerts.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
        <p className="text-[10px] text-slate-600 font-mono">
          ✓ No active NWS weather alerts for tracked locations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-amber-400 text-xs">⚠</span>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
          Active Alerts ({alerts.length})
        </h3>
      </div>
      {alerts.map((a) => {
        const open = expanded.has(a.id);
        return (
          <div key={a.id} className={`border-l-4 rounded-md ${SEV_COLOUR[a.severity]}`}>
            <button
              onClick={() => setExpanded((p) => {
                const n = new Set(p); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n;
              })}
              className="w-full text-left px-3 py-2 flex items-baseline justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold truncate">
                  {a.event}
                  <span className="text-slate-400 font-normal ml-2">· {a.locationLabel}</span>
                </p>
                {!open && (
                  <p className="text-[10px] text-slate-400 truncate">{a.headline}</p>
                )}
              </div>
              <span className="text-[10px] font-mono opacity-70 flex-shrink-0">
                {open ? "▲" : "▼"}
              </span>
            </button>
            {open && (
              <div className="px-3 pb-2 text-[11px] leading-relaxed">
                <p className="mb-1.5">{a.headline}</p>
                <p className="text-slate-400 font-mono text-[10px]">
                  Area: <span className="text-slate-300">{a.areaDesc}</span>
                </p>
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
