"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import WarningBoard from "@/components/osint/WarningBoard";
import SitrepPanel from "@/components/osint/SitrepPanel";
import type { SitrepSummary } from "@/lib/sitrep";
import type { WarningLevel } from "@/lib/warning";

// The OSINT command dashboard — one scroll answers the morning scan in
// priority order: is anything WARNING (I&W strip) → how are MY BASES (SITREP
// LED strip) → what's the THEATER PICTURE (the Crisis map + its boards).
// The strips are cheap (both endpoints are server-cached); the deep dives
// (full warning board, full per-base SITREP) expand INLINE instead of living
// behind separate pane chips.
//
// Mount contract: the parent keeps this pane hidden-mounted after first
// activation so the Crisis map doesn't re-fetch its ~15 sources on every pane
// hop. Render nothing until first activated (all tabs mount at app load — the
// map must not start fetching before the user ever opens OSINT).

const CrisisMap = dynamic(() => import("@/components/osint/CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse flex items-center justify-center text-xs text-slate-600 font-mono uppercase tracking-wider">
      Loading crisis map…
    </div>
  ),
});

interface IwProblem {
  problemId: string;
  label: string;
  level: WarningLevel;
  anomaly: number;
  trajectory: "deteriorating" | "improving" | "stable";
  learning?: boolean;
  drivers?: { id: string; description: string }[];
}

const LVL_CHIP: Record<string, string> = {
  alert: "text-red-300 border-red-500/50 bg-red-500/10",
  warning: "text-orange-300 border-orange-500/50 bg-orange-500/10",
  watch: "text-amber-300 border-amber-500/50 bg-amber-500/10",
  calm: "text-slate-400 border-slate-700 bg-transparent",
};
const TRAJ: Record<string, string> = { deteriorating: "↗", improving: "↘", stable: "→" };
const LED: Record<string, string> = { g: "bg-emerald-500", a: "bg-amber-500", r: "bg-red-500", u: "bg-slate-600" };

export default function WatchPane({ active }: { active: boolean }) {
  // Lazy-arm on first activation, then stay armed (the parent hidden-mounts us).
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  const [iw, setIw] = useState<IwProblem[] | null>(null);
  const [iwOpen, setIwOpen] = useState(false);
  const [sitreps, setSitreps] = useState<SitrepSummary[]>([]);
  const [sitrepOpen, setSitrepOpen] = useState<string | null>(null);

  // I&W strip — one compact card per active warning problem.
  useEffect(() => {
    if (!armed) return;
    const load = () => {
      fetch("/api/warning")
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d?.problems)) setIw(d.problems); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [armed]);

  // SITREP LED strip — same deterministic rollup Glance and the Brief use.
  useEffect(() => {
    if (!armed) return;
    const load = () => {
      fetch("/api/sitrep/summary")
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d?.bases)) setSitreps(d.bases); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [armed]);

  if (!armed) return null;

  return (
    <div className="space-y-4">
      {/* ── I&W strip ── */}
      {iw && iw.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2">
            {iw.map((p) => (
              <button
                key={p.problemId}
                onClick={() => setIwOpen((v) => !v)}
                title="Open the full indicator board"
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition-colors hover:bg-slate-800/40 ${
                  p.level === "alert" || p.level === "warning" ? "border-orange-500/50" : p.level === "watch" ? "border-amber-500/40" : "border-slate-800"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-slate-100 truncate">{p.label}</span>
                  <span className="block text-[10px] text-slate-500 truncate">
                    {p.learning ? "learning mode — baseline forming" : p.drivers?.[0]?.description?.slice(0, 70) ?? "no active drivers"}
                  </span>
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-widest border rounded px-2 py-0.5 flex-shrink-0 ${LVL_CHIP[p.level] ?? LVL_CHIP.calm}`}>
                  {p.level}
                </span>
                <span className={`text-xs font-mono font-bold flex-shrink-0 ${p.level === "calm" ? "text-slate-500" : "text-amber-300"}`}>
                  {p.anomaly >= 0 ? "+" : "−"}{Math.abs(p.anomaly).toFixed(2)} {TRAJ[p.trajectory] ?? "→"}
                </span>
                <span className="text-slate-600 text-[10px] flex-shrink-0">{iwOpen ? "▴" : "▾"}</span>
              </button>
            ))}
          </div>
          {iwOpen && (
            <div className="mt-3">
              <WarningBoard active={active && iwOpen} />
            </div>
          )}
        </div>
      )}

      {/* ── SITREP LED strip ── */}
      {sitreps.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {sitreps.map((s) => {
              const worstRed = Object.values(s.status).includes("r");
              const worstAmber = Object.values(s.status).includes("a");
              const open = sitrepOpen === s.icao;
              return (
                <button
                  key={s.icao}
                  onClick={() => setSitrepOpen(open ? null : s.icao)}
                  title={`${s.label} — ${s.driver || "all green"}${s.worse.length ? ` · worse than yesterday: ${s.worse.join(", ")}` : ""}`}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors hover:bg-slate-800/50 ${
                    open ? "bg-slate-800/60 border-emerald-500/50" : worstRed ? "border-red-500/50" : worstAmber ? "border-amber-500/40" : "border-slate-800"
                  }`}
                >
                  <span className="text-[11px] font-mono font-bold text-slate-200">{s.icao}</span>
                  <span className="flex gap-1">
                    {(["wx", "ops", "threat", "infra"] as const).map((k) => (
                      <span key={k} className={`w-1.5 h-1.5 rounded-full ${LED[s.status[k]] ?? LED.u}`} />
                    ))}
                  </span>
                  {s.worse.length > 0 && <span className="text-[9px] font-bold text-amber-400">↑</span>}
                  {(worstRed || worstAmber) && !open && (
                    <span className="hidden md:block text-[10px] text-slate-500 max-w-[180px] truncate">{s.driver}</span>
                  )}
                  <span className="text-slate-600 text-[9px]">{open ? "▴" : "▾"}</span>
                </button>
              );
            })}
            <span className="text-[10px] text-slate-600">click a base for the full SITREP</span>
          </div>
          {sitrepOpen && (
            <div className="mt-3 border border-slate-800 rounded-xl p-3 bg-slate-950/40">
              <SitrepPanel active={active && sitrepOpen !== null} focusIcao={sitrepOpen} />
            </div>
          )}
        </div>
      )}

      {/* ── The theater picture ── */}
      <CrisisMap />
    </div>
  );
}
