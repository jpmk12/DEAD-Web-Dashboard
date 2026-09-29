"use client";

import { useCallback, useEffect, useState } from "react";
import type { EconomicWarfareBody, ActorBoard } from "@/lib/economicWarfareAssess";
import { INSTRUMENTS, INSTRUMENT_META, type Instrument } from "@/lib/economicWarfare";
import type { WarningLevel, Trajectory, ObservedState } from "@/lib/warning";
import type { Modality } from "@/lib/chokepointSignals";

// The Economy tab's organising unit is the ACTOR. One tile per tracked actor
// (level · anomaly · trajectory · instrument chips lit only where a graded
// signal exists), then the coercion board: actor → target → instrument →
// grade → evidence → corroboration → affects. Same presentation vocabulary
// as the OSINT I&W board — red is reserved for ALERT, learning mode is said
// out loud, and every row states the phrase it rests on.

const LEVEL_PILL: Record<WarningLevel, string> = {
  calm: "text-slate-400 border-slate-600 bg-slate-500/10",
  watch: "text-amber-300 border-amber-500/55 bg-amber-500/[0.12]",
  warning: "text-orange-300 border-orange-500/55 bg-orange-500/[0.12]",
  alert: "text-white border-red-500 bg-red-500/80",
};
const LEVEL_LABEL: Record<WarningLevel, string> = { calm: "Calm", watch: "Watch", warning: "Warning", alert: "Alert" };
const CARD_ACCENT: Record<WarningLevel, string> = {
  calm: "border-slate-800",
  watch: "border-amber-500/40",
  warning: "border-orange-500/45 shadow-[0_0_18px_-6px_rgba(249,115,22,0.35)]",
  alert: "border-red-500/60 shadow-[0_0_20px_-6px_rgba(239,68,68,0.45)]",
};
const TRAJ: Record<Trajectory, { t: string; c: string }> = {
  deteriorating: { t: "↗ deteriorating", c: "text-orange-300" },
  improving: { t: "↘ improving", c: "text-emerald-300" },
  stable: { t: "→ stable", c: "text-slate-500" },
};
const STATE_CHIP: Record<ObservedState, string> = {
  confirmed: "text-red-200 border-red-500/60 bg-red-500/15",
  active: "text-orange-200 border-orange-500/55 bg-orange-500/[0.12]",
  watching: "text-amber-200 border-amber-500/50 bg-amber-500/10",
  dormant: "text-slate-600 border-slate-800",
};
const MODALITY_CHIP: Record<Modality, { text: string; cls: string }> = {
  act: { text: "reported act", cls: "text-red-200 border-red-500/55 bg-red-500/15" },
  threat: { text: "declared threat", cls: "text-amber-200 border-amber-500/50 bg-amber-500/10" },
  analysis: { text: "analysis only", cls: "text-slate-400 border-slate-600 bg-slate-700/25" },
};

const age = (d: number | null) => (d === null ? "undated" : d === 0 ? "today" : `${d}d`);
const fmtAnom = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

function ActorTile({ b, selected, onSelect }: { b: ActorBoard; selected: boolean; onSelect: () => void }) {
  const a = b.assessment;
  return (
    <button
      onClick={onSelect}
      className={`text-left rounded-xl border bg-slate-900/60 p-3 transition-colors hover:bg-slate-800/30 ${CARD_ACCENT[a.level]} ${selected ? "ring-1 ring-sky-500/50" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-100 truncate">{b.actor.label}</div>
          <div className="text-[9.5px] text-slate-600 font-mono truncate">{b.actor.aor} · {b.actor.kind === "nonstate" ? "non-state" : "state"}</div>
        </div>
        <span className={`flex-shrink-0 text-[9.5px] font-extrabold font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded-md border ${LEVEL_PILL[a.level]}`}>{LEVEL_LABEL[a.level]}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-[20px] font-mono font-bold leading-none ${a.anomaly > 0.05 ? "text-slate-100" : "text-slate-500"}`}>{fmtAnom(a.anomaly)}</span>
        <span className="text-[9px] text-slate-600 uppercase tracking-wider">anomaly</span>
        <span className={`ml-auto text-[10px] font-mono ${TRAJ[a.trajectory].c}`}>{TRAJ[a.trajectory].t}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {b.instruments.map((i) => (
          <span key={i.instrument} title={`${INSTRUMENT_META[i.instrument].label}: ${i.why}`}
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${STATE_CHIP[i.state]}`}>
            {INSTRUMENT_META[i.instrument].glyph} {INSTRUMENT_META[i.instrument].label.split(" /")[0]}
          </span>
        ))}
        <span title={`Counter-pressure: ${b.counterPressure.why}`} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${STATE_CHIP[b.counterPressure.state]}`}>⇐ U.S.</span>
      </div>
      {a.learning && <p className="mt-1.5 text-[9px] text-slate-600">baseline forming — held at Watch</p>}
      {a.drivers.length > 0 && (
        <p className="mt-1.5 text-[10px] text-slate-400 leading-snug truncate">
          {a.drivers.map((d) => `${INSTRUMENT_META[d.id as Instrument]?.label.split(" /")[0] ?? "U.S. pressure"} ${d.state}`).join(" · ")}
        </p>
      )}
      {b.corroboration.length > 0 && <p className="mt-1 text-[9.5px] text-sky-300/80 truncate">{b.corroboration.join(" · ")}</p>}
    </button>
  );
}

export default function EconomicWarfareBoard({ active, refreshKey = 0 }: { active: boolean; refreshKey?: number }) {
  const [body, setBody] = useState<EconomicWarfareBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [actor, setActor] = useState<string | null>(null);
  const [inst, setInst] = useState<Instrument | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  const load = useCallback(() => {
    setError(null);
    fetch("/api/markets/economic-warfare")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (d && Array.isArray(d.actors)) setBody(d); })
      .catch((e) => setError(e instanceof Error ? e.message : "failed"));
  }, []);

  useEffect(() => { if (armed) load(); }, [armed, load, refreshKey]);

  if (error && !body) {
    return (
      <div className="bg-slate-900/60 border border-red-500/30 rounded-xl p-3 text-[11px] text-red-300">
        Economic warfare board unavailable ({error}). UNKNOWN, not calm.
      </div>
    );
  }
  if (!body) return <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-600 font-mono">Reading the actor register…</div>;

  const rows = body.moves.filter((m) => (!actor || m.actorId === actor) && (inst === "all" || m.instrument === inst));
  const byMods = { act: rows.filter((m) => m.modality === "act").length, threat: rows.filter((m) => m.modality === "threat").length };
  const worst = body.actors[0]?.assessment.level ?? "calm";

  return (
    <div className="space-y-3">
      {/* Actor tiles */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
          <span className="text-[11px] font-bold uppercase tracking-widest text-orange-300">Actors</span>
          <span className="text-[10px] text-slate-600">{body.actors.length} tracked · worst {LEVEL_LABEL[worst]}</span>
          <span className="ml-auto text-[9.5px] text-slate-600 font-mono hidden sm:inline">
            {[body.sources.gdelt ? "GDELT" : null, body.sources.federalRegister ? "Fed. Register" : null, body.sources.chokepoints ? "chokepoints" : null, ...body.sources.ownSources].filter(Boolean).join(" · ") || "no live sensor"}
          </span>
        </div>
        {body.actors.length === 0 ? (
          <p className="px-3.5 py-3 text-[11px] text-slate-500">{body.note}</p>
        ) : (
          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {body.actors.map((b) => (
              <ActorTile key={b.actor.id} b={b} selected={actor === b.actor.id} onSelect={() => setActor(actor === b.actor.id ? null : b.actor.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Coercion board */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
          <span className="text-[11px] font-bold uppercase tracking-widest text-orange-300">Coercion board</span>
          <span className="text-[10px] text-slate-600">
            {rows.length === 0 ? "nothing instrument-shaped in the window" : `${rows.length} moves · ${byMods.act} acts · ${byMods.threat} threats · ${body.windowDays}d`}
          </span>
          <div className="ml-auto flex flex-wrap gap-1">
            <button onClick={() => setInst("all")} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${inst === "all" ? "text-slate-100 border-slate-500 bg-slate-700/40" : "text-slate-500 border-slate-800 hover:text-slate-300"}`}>all</button>
            {INSTRUMENTS.map((i) => {
              const n = body.moves.filter((m) => m.instrument === i && (!actor || m.actorId === actor)).length;
              return (
                <button key={i} onClick={() => setInst(inst === i ? "all" : i)} disabled={n === 0}
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${inst === i ? "text-slate-100 border-slate-500 bg-slate-700/40" : n ? "text-slate-400 border-slate-700 hover:text-slate-200" : "text-slate-700 border-slate-800/60"}`}>
                  {INSTRUMENT_META[i].glyph} {INSTRUMENT_META[i].label.split(" /")[0]}{n ? ` ${n}` : ""}
                </button>
              );
            })}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-3.5 py-3 text-[10.5px] text-slate-600">
            No graded move for this selection. A bare mention of an actor scores nothing here; a quiet board is absence of instrument-shaped reporting, not evidence of calm.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/60">
            <div className="hidden md:grid grid-cols-[110px_110px_92px_1fr_120px] gap-2 px-3.5 py-1.5 text-[8.5px] font-bold uppercase tracking-widest text-slate-600">
              <span>actor → target</span><span>instrument</span><span>grade</span><span>evidence</span><span>age · source</span>
            </div>
            {rows.map((m) => {
              const isOpen = open === m.id;
              const meta = INSTRUMENT_META[m.instrument];
              return (
                <div key={m.id}>
                  <button onClick={() => setOpen(isOpen ? null : m.id)} className="w-full text-left px-3.5 py-2 hover:bg-slate-800/20 grid grid-cols-1 md:grid-cols-[110px_110px_92px_1fr_120px] gap-x-2 gap-y-1 items-start">
                    <span className="text-[11px] text-slate-200 truncate">
                      {m.direction === "by" ? <>{m.actorLabel} <span className="text-slate-600">→</span> {m.target}</> : <>U.S. <span className="text-slate-600">→</span> {m.target}</>}
                    </span>
                    <span className="text-[10.5px] text-slate-300 truncate" title={m.cls}>{meta.glyph} {m.cls}</span>
                    <span className={`justify-self-start text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${MODALITY_CHIP[m.modality].cls}`}>{MODALITY_CHIP[m.modality].text}</span>
                    <span className="text-[11px] text-slate-200 leading-snug line-clamp-2">{m.own && <span className="text-sky-300/80 mr-1">own·</span>}{m.title}</span>
                    <span className="text-[9.5px] font-mono text-slate-600 truncate">{age(m.ageDays)}{m.source ? ` · ${m.source}` : ""}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3.5 pb-2.5 space-y-1 text-[10.5px]">
                      <p className="text-slate-500">matched &ldquo;{m.phrase}&rdquo; · {m.direction === "by" ? "attributed to the actor (by)" : "done to the actor (against)"}{m.own ? " · from your own sources — corroborates, never alone confirms" : ""}</p>
                      <p><span className="text-slate-600 uppercase tracking-wider text-[8.5px] font-bold mr-1.5">corroboration</span><span className="text-slate-300">{m.corroboration.length ? m.corroboration.join(" · ") : "none attached"}</span></p>
                      <p><span className="text-slate-600 uppercase tracking-wider text-[8.5px] font-bold mr-1.5">affects</span><span className="text-slate-300">{m.affects}</span></p>
                      <p><span className="text-slate-600 uppercase tracking-wider text-[8.5px] font-bold mr-1.5">falsifier</span><span className="text-slate-400">{meta.falsifier}</span></p>
                      {m.link && <a href={m.link} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:text-sky-200 underline decoration-slate-700">open source ↗</a>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
          {body.note} Levels are earned by the anomaly against each actor&rsquo;s own 30-day baseline in the same engine as the OSINT I&amp;W boards; U.S. actions come from the Federal Register and are the only foreign-policy record here — foreign counter-measures still arrive through news. Unofficial posture aid, not intelligence.
        </p>
      </div>
    </div>
  );
}
