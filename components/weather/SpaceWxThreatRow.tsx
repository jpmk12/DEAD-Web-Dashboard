"use client";

import { useEffect, useState } from "react";
import type { SpaceWxImpact } from "@/lib/spaceWeatherOps";

// A single threat-board row for space weather, rendered ONLY when a NOAA
// scale is at 3 or above (REVIEW-CYBER-SPACE §4.7) — the same "colour is
// earned" rule as the rest of the board. Reads the same route as the card.
export default function SpaceWxThreatRow({ refreshKey = 0 }: { refreshKey?: number }) {
  const [severe, setSevere] = useState<{ scale: string; level: number }[]>([]);
  const [impacts, setImpacts] = useState<SpaceWxImpact[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/weather/space", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => {
        setSevere(Array.isArray(d?.ops?.severe) ? d.ops.severe : []);
        setImpacts(Array.isArray(d?.ops?.impacts) ? d.ops.impacts : []);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [refreshKey]);

  if (severe.length === 0) return null;
  const red = impacts.filter((i) => i.led === "r");
  return (
    <div className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-red-400">☀</span>
        <p className="text-[9px] font-bold uppercase tracking-widest text-red-300">Space weather — {severe.map((s) => `${s.scale}${s.level}`).join(" · ")}</p>
        <span className="ml-auto text-[9px] text-slate-600 font-mono">NOAA SWPC</span>
      </div>
      <ul className="mt-1 space-y-0.5">
        {(red.length ? red : impacts.filter((i) => i.led === "a")).map((i) => (
          <li key={i.key} className="text-[11px] text-slate-300"><b className="text-slate-200">{i.label}:</b> {i.now}</li>
        ))}
      </ul>
    </div>
  );
}
