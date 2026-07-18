"use client";

import { useEffect, useState } from "react";
import type { WarningAssessmentPlus } from "@/lib/warningAssess";
import type { WarningLevel, Trajectory, ObservedState, IndicatorScore } from "@/lib/warning";

// Presentation vocabulary — one glyph/colour per level/state, red reserved for
// ALERT so it means something (§5). Short indicator labels live here (client
// presentation), keyed by the taxonomy ids.
const LEVEL_PILL: Record<WarningLevel, string> = {
  calm: "text-slate-400 border-slate-600 bg-slate-500/10",
  watch: "text-amber-300 border-amber-500/55 bg-amber-500/[0.12]",
  warning: "text-orange-300 border-orange-500/55 bg-orange-500/[0.12]",
  alert: "text-white border-red-500 bg-red-500/80",
};
const LEVEL_LABEL: Record<WarningLevel, string> = { calm: "Calm", watch: "Watch", warning: "Warning", alert: "Alert" };
const CARD_ACCENT: Record<WarningLevel, string> = {
  calm: "border-slate-800",
  watch: "border-amber-500/40 shadow-[0_0_18px_-6px_rgba(245,158,11,0.3)]",
  warning: "border-orange-500/45 shadow-[0_0_18px_-6px_rgba(249,115,22,0.35)]",
  alert: "border-red-500/60 shadow-[0_0_20px_-6px_rgba(239,68,68,0.45)]",
};
const STATE_DOT: Record<ObservedState, string> = { confirmed: "bg-red-500", active: "bg-orange-400", watching: "bg-amber-400", dormant: "bg-slate-600" };
const TRAJ: Record<Trajectory, { t: string; c: string }> = {
  deteriorating: { t: "↗ deteriorating", c: "text-orange-300 border-orange-500/40" },
  improving: { t: "↘ improving", c: "text-emerald-300 border-emerald-500/40" },
  stable: { t: "→ stable", c: "text-slate-400 border-slate-700" },
};
const IND_LABEL: Record<string, string> = {
  conflict_intensity_gulf: "Conflict intensity — Gulf",
  escalatory_strike_signal: "Escalatory strike / rhetoric signal",
  mobility_divergence: "Airlift mobility divergence",
  neo_departure_posture: "NEO / departure posture",
  airspace_gps_disruption: "Airspace / GPS disruption",
  hormuz_interdiction_signal: "Strait of Hormuz interdiction",
};
const label = (id: string) => IND_LABEL[id] ?? id;
const fmtAnom = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;

const QUADRANT_LABEL: Record<string, string> = {
  early_warning: "Early-warning window — demand exists, lift only partial",
  anomaly: "Anomaly — lift moving with no public trigger",
  corroboration: "Expected response underway — low novelty",
  quiet: "Quiet — nothing implied, nothing moving",
};

export default function WarningBoard({ active }: { active: boolean }) {
  const [problems, setProblems] = useState<WarningAssessmentPlus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || problems !== null) return;
    fetch("/api/warning")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setProblems(Array.isArray(d.problems) ? d.problems : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [active, problems]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-slate-100">◎ Indications &amp; Warning</h2>
        <span className="text-[11px] text-slate-500">anomaly &amp; trajectory — calm by default. Color is earned by crossing a threshold, never by standing level.</span>
      </div>

      {error && <div className="text-[11px] text-red-400 font-mono">Failed to load I&amp;W: {error}</div>}
      {problems === null && !error && <div className="text-xs text-slate-500 py-6">Assembling warning picture…</div>}
      {problems && problems.length === 0 && <div className="text-xs text-slate-500 py-6">No warning problems configured.</div>}

      {problems?.map((p) => <ProblemCard key={p.problemId} p={p} />)}

      {problems && problems.length > 0 && (
        <div className="text-[10px] text-slate-600 leading-relaxed border-t border-slate-800 pt-3">
          <span className="text-amber-400 font-semibold">Unofficial &amp; personal.</span> Not a USAF/DoD position, product, or endorsement.
          Fused from open sources; indicator taxonomy sourced from open doctrine (ISW · CSIS · RAND · Grabo).
          Sources: ACLED (Armed Conflict Location &amp; Event Data Project — acleddata.com) · UCDP · GDELT · GDACS · USGS · ReliefWeb · State Dept · gpsjam.org · community ADS-B.
        </div>
      )}
    </div>
  );
}

function ProblemCard({ p }: { p: WarningAssessmentPlus }) {
  const unreachable = p.sensorHealth.filter((h) => !h.live);
  const anomHot = p.level !== "calm";
  return (
    <div className={`border ${CARD_ACCENT[p.level]} bg-slate-900/50 rounded-2xl p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-slate-100">{p.label}</div>
          <div className="text-[11.5px] text-slate-400 mt-0.5 max-w-[560px]">{p.scenario}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-[12px] font-extrabold font-mono uppercase tracking-[0.12em] px-3 py-1.5 rounded-lg border ${LEVEL_PILL[p.level]}`}>{LEVEL_LABEL[p.level]}</span>
          <span className="text-[10px] font-mono text-slate-600">raw {p.rawScore.toFixed(2)} · base {p.baseline.toFixed(2)}{p.learning ? " · learning" : ""}</span>
        </div>
      </div>

      <div className="flex items-baseline gap-4 flex-wrap">
        <span className={`text-[30px] font-extrabold font-mono leading-none ${anomHot ? "text-amber-300" : "text-slate-500"}`}>{fmtAnom(p.anomaly)}</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500 leading-tight">anomaly vs<br />baseline (Δ)</span>
        <span className={`text-[11px] font-mono font-bold px-2 py-1 rounded-md border ${TRAJ[p.trajectory].c}`}>{TRAJ[p.trajectory].t}</span>
        {p.learning && <span className="ml-auto text-[10px] font-mono text-slate-600">baseline still forming — capped at Watch</span>}
      </div>

      <div className="text-[11px] text-slate-400 border-l-2 border-slate-700 pl-2.5 py-1">
        <span className="text-emerald-400 font-bold uppercase text-[9px] tracking-[0.1em]">Decision linkage — </span>{p.decisionLinkage}
      </div>

      {/* Drivers */}
      {p.drivers.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600 mb-1.5">Drivers — what&apos;s moving the score</p>
          {p.drivers.map((d) => <DriverRow key={d.id} d={d} />)}
        </div>
      )}

      {/* Airlift divergence 2×2 */}
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600 mb-1.5">Airlift divergence — implied demand × observed response</p>
        <div className="grid grid-cols-[70px_1fr_1fr] gap-1.5 text-center">
          <span />
          <span className="text-[8.5px] font-mono uppercase tracking-wider text-slate-500 self-center">Observed ≈ none</span>
          <span className="text-[8.5px] font-mono uppercase tracking-wider text-slate-500 self-center">Observed surge</span>
          <span className="text-[8.5px] font-mono uppercase tracking-wider text-slate-500 self-center text-right pr-1">Implied high</span>
          <DivCell active={p.divergence.quadrant === "early_warning"} loud title="Early-warning window" sub="Demand exists, lift hasn't moved." />
          <DivCell active={p.divergence.quadrant === "corroboration"} title="Expected response" sub="Corroboration, low novelty." />
          <span className="text-[8.5px] font-mono uppercase tracking-wider text-slate-500 self-center text-right pr-1">Implied ≈ none</span>
          <DivCell active={p.divergence.quadrant === "quiet"} title="Quiet" sub="Nothing implied, nothing moving." />
          <DivCell active={p.divergence.quadrant === "anomaly"} loud title="Anomaly — sit up" sub="Lift moving, no public trigger." />
        </div>
        <p className="text-[10px] text-slate-500 mt-1.5 font-mono">{p.divergence.observedCount} mobility/tanker near AOR hubs · {QUADRANT_LABEL[p.divergence.quadrant]}</p>
      </div>

      {/* Indicators */}
      <div>
        <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600 mb-1">Indicators ({p.indicators.length}) — tap for falsifier &amp; provenance</p>
        {p.indicators.map((i) => {
          const h = p.sensorHealth.find((x) => x.indicatorId === i.id);
          return <IndicatorRow key={i.id} i={i} unreachable={h ? !h.live : false} note={h?.note} />;
        })}
      </div>

      {unreachable.length > 0 && (
        <p className="text-[10px] text-slate-600 font-mono">⚠ {unreachable.length} sensor{unreachable.length === 1 ? "" : "s"} unreachable this cycle — shown UNKNOWN, never implied-clear.</p>
      )}
    </div>
  );
}

function DriverRow({ d }: { d: IndicatorScore }) {
  const pct = Math.min(100, Math.round((d.contribution / (d.weight || 1)) * 100));
  return (
    <div className="flex items-center gap-2.5 py-1.5 border-t border-slate-800/60">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATE_DOT[d.state]}`} />
      <span className="text-[8.5px] font-mono uppercase tracking-wider text-slate-500 w-14 flex-shrink-0">{d.state}</span>
      <span className="text-[12px] text-slate-200 flex-1 min-w-0 truncate">{label(d.id)}</span>
      <span className="w-24 h-1.5 rounded-full bg-slate-700/50 overflow-hidden flex-shrink-0"><span className="block h-full bg-amber-400" style={{ width: `${pct}%` }} /></span>
      <span className="text-[11px] font-mono font-bold text-slate-300 w-10 text-right flex-shrink-0">{d.contribution.toFixed(2)}</span>
    </div>
  );
}

function IndicatorRow({ i, unreachable, note }: { i: IndicatorScore; unreachable: boolean; note?: string }) {
  return (
    <details className="border-t border-slate-800/60">
      <summary className="list-none cursor-pointer py-2 flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATE_DOT[i.state]}`} />
        <span className="text-[8.5px] font-mono uppercase tracking-wider text-slate-500 w-14 flex-shrink-0">{unreachable ? "unknown" : i.state}</span>
        <span className="text-[12px] text-slate-200 flex-1 min-w-0 truncate">{label(i.id)}{unreachable && <span className="ml-2 text-[9px] text-slate-600">· sensor unreachable</span>}</span>
        <span className="text-[11px] font-mono font-bold text-slate-400 w-10 text-right flex-shrink-0">{i.contribution.toFixed(2)}</span>
      </summary>
      <div className="text-[10.5px] text-slate-400 pl-[18px] pb-2.5 space-y-1">
        <p>{i.description}</p>
        <p><span className="text-slate-600 font-bold uppercase text-[8.5px] tracking-wider">Falsifier:</span> {i.falsifier}</p>
        <p className="text-slate-600">Provenance: {i.provenance} · Source: {i.sourceFeed}{note ? ` · ${note}` : ""}</p>
      </div>
    </details>
  );
}

function DivCell({ active, loud, title, sub }: { active: boolean; loud?: boolean; title: string; sub: string }) {
  const cls = active
    ? "border-amber-500/60 bg-amber-500/[0.1] shadow-[0_0_14px_-6px_rgba(245,158,11,0.4)]"
    : loud
      ? "border-cyan-500/40 bg-cyan-500/[0.06]"
      : "border-slate-800 bg-slate-950/40";
  const tcls = active ? "text-amber-300" : loud ? "text-cyan-300" : "text-slate-500";
  return (
    <div className={`border rounded-lg p-2.5 min-h-[62px] text-left ${cls}`}>
      <div className={`text-[10px] font-mono font-bold uppercase tracking-wide ${tcls}`}>{active ? "◀ " : ""}{title}</div>
      <div className="text-[9.5px] text-slate-400 mt-1">{sub}</div>
    </div>
  );
}
