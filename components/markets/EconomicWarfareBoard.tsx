"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EconomicWarfareBody, ActorBoard } from "@/lib/economicWarfareAssess";
import type { TimelineDot, DotKind } from "@/lib/economicTimeline";
import type { LeverageEntry } from "@/lib/leverage";
import type { EconomyEdits } from "@/lib/missionProfile";
import { INSTRUMENTS, INSTRUMENT_META, type Instrument } from "@/lib/economicWarfare";
import type { WarningLevel, Trajectory, ObservedState } from "@/lib/warning";
import type { Modality } from "@/lib/chokepointSignals";

// The Economy tab's organising unit is the ACTOR. One tile per tracked actor
// (level · anomaly · trajectory · instrument chips lit only where a graded
// signal exists · WHY it is on the board · the driver with its headline),
// then the moves-and-counter-moves strip with one lane PER ACTOR, then the
// coercion board: actor → target → instrument → grade → evidence →
// corroboration → affects. Same presentation vocabulary as the OSINT I&W
// board — red is reserved for ALERT, learning mode is said out loud ("day N
// of 14"), and every row states the phrase it rests on. REVIEW-2026-10 §10.

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
  reversal: { text: "reversal", cls: "text-emerald-200 border-emerald-500/40 bg-emerald-500/10" },
};
const MODALITY_WORD: Record<Modality, string> = { act: "act", threat: "threat", analysis: "analysis", reversal: "reversal" };

/** Learning-mode floor of the engine (lib/warning deriveWarning default). */
const BASELINE_DAYS = 14;

const age = (d: number | null) => (d === null ? "undated" : d === 0 ? "today" : `${d}d`);

// Timeline lanes, top to bottom: pressure first, then ONE lane PER ACTOR
// (REVIEW-2026-10 §10 E5 — "actor move" was one lane for every actor and
// the reader could not tell whose dot it was), then the strait incidents and
// the market. Colour is the KIND of move, never a level.
interface Lane { key: string; label: string; fill: string; kind: DotKind; actorId?: string }
const FIXED_TOP: Lane[] = [
  { key: "us", kind: "us", label: "U.S. action", fill: "#38bdf8" },
  { key: "foreign", kind: "foreign", label: "EU / UK", fill: "#818cf8" },
];
const FIXED_BOTTOM: Lane[] = [
  { key: "shipping", kind: "shipping", label: "strait incident", fill: "#f87171" },
  { key: "market", kind: "market", label: "Brent move", fill: "#facc15" },
];
const ACTOR_FILL = "#fb923c";
const laneKeyOf = (d: TimelineDot): string => (d.kind === "actor" ? `actor:${d.actorId ?? "?"}` : d.kind);

function TimelineStrip({ days, dots, lanes, onDot, picked }: { days: string[]; dots: TimelineDot[]; lanes: Lane[]; onDot: (d: TimelineDot | null, pin: boolean) => void; picked: TimelineDot | null }) {
  const W = 720, LEFT = 110, TOP = 8, ROW = 18, R = 3;
  const H = TOP + lanes.length * ROW + 16;
  const colW = (W - LEFT - 8) / Math.max(1, days.length);
  const x = (day: string) => LEFT + days.indexOf(day) * colW + colW / 2;
  const laneIdx = (d: TimelineDot) => lanes.findIndex((l) => l.key === laneKeyOf(d));
  const ticks = days.filter((_, i) => i % 7 === days.length % 7 || i === days.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Moves and counter-moves, last 30 days, one lane per actor">
      {lanes.map((l, i) => (
        <g key={l.key}>
          <line x1={LEFT} x2={W - 8} y1={TOP + i * ROW + ROW / 2} y2={TOP + i * ROW + ROW / 2} stroke="#1e293b" strokeWidth={1} />
          <text x={LEFT - 6} y={TOP + i * ROW + ROW / 2 + 3} textAnchor="end" fontSize={8.5} fill={l.kind === "actor" ? "#94a3b8" : "#64748b"} fontFamily="ui-monospace, monospace">{l.label.length > 18 ? `${l.label.slice(0, 17)}…` : l.label}</text>
        </g>
      ))}
      {ticks.map((d) => (
        <text key={d} x={x(d)} y={H - 3} textAnchor="middle" fontSize={7.5} fill="#475569" fontFamily="ui-monospace, monospace">{d.slice(5)}</text>
      ))}
      <line x1={x(days[days.length - 1])} x2={x(days[days.length - 1])} y1={TOP} y2={TOP + lanes.length * ROW} stroke="#334155" strokeDasharray="2 2" />
      {dots.map((d, i) => {
        const li = laneIdx(d);
        if (li < 0) return null;
        const lane = lanes[li];
        const r = R + (d.weight / 100) * 3;
        const cy = TOP + li * ROW + ROW / 2;
        const isPicked = picked === d;
        // A declared threat is drawn HOLLOW and dashed; a reported act is solid.
        const hollow = d.modality === "threat";
        return (
          <g key={i} className="cursor-pointer" onMouseEnter={() => onDot(d, false)} onMouseLeave={() => onDot(null, false)} onClick={() => onDot(d, true)}>
            <circle cx={x(d.day)} cy={cy} r={r + 4} fill="transparent" />
            <circle cx={x(d.day)} cy={cy} r={r} fill={hollow ? "#0f172a" : lane.fill} fillOpacity={hollow ? 1 : 0.85} stroke={isPicked ? "#f8fafc" : lane.fill} strokeWidth={hollow ? 1.2 : isPicked ? 1.5 : 0.75} strokeDasharray={hollow ? "1.5 1.2" : undefined}>
              <title>{`${d.day} · ${d.label}${d.title ? ` — “${d.title}”` : ""}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

function LeverageBars({ items }: { items: LeverageEntry["threatens"] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="text-[10.5px]">
          <div className="flex items-baseline gap-2">
            <span className="text-slate-300 flex-1 min-w-0 truncate" title={it.label}>{it.label}</span>
            <span className="text-[9px] text-slate-600 font-mono flex-shrink-0">{it.source}</span>
          </div>
          <div className="h-1 rounded bg-slate-800 mt-0.5"><div className="h-1 rounded bg-slate-500" style={{ width: `${it.scale}%` }} /></div>
          <div className="text-[9.5px] text-slate-500 leading-snug">{it.note}</div>
        </li>
      ))}
    </ul>
  );
}
const fmtAnom = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
const shortLabel = (i: Instrument) => INSTRUMENT_META[i].label.split(" /")[0];

/** The driver line (§10 E7): "Shipping active — act: “IRGC seized a tanker…”". */
function driverLine(b: ActorBoard): { text: string; title?: string; link?: string } | null {
  const d = b.assessment.drivers[0];
  if (!d) return null;
  const inst = b.instruments.find((i) => i.instrument === (d.id as Instrument));
  if (!inst) return { text: `U.S. pressure ${d.state} — ${b.counterPressure.why}` };
  const lead = inst.lead;
  return lead
    ? { text: `${shortLabel(inst.instrument)} ${inst.state} — ${MODALITY_WORD[lead.modality]}: “${lead.title}”`, title: lead.title, link: lead.link }
    : { text: `${shortLabel(inst.instrument)} ${inst.state} — ${inst.why}` };
}

function ActorTile({ b, selected, onSelect, canEdit, onExclude }: { b: ActorBoard; selected: boolean; onSelect: () => void; canEdit: boolean; onExclude: () => void }) {
  const a = b.assessment;
  const authored = b.instruments.reduce((n, i) => n + i.moves, 0);
  const drv = driverLine(b);
  return (
    <div className={`relative rounded-xl border bg-slate-900/60 transition-colors hover:bg-slate-800/30 ${CARD_ACCENT[a.level]} ${selected ? "ring-1 ring-sky-500/50" : ""}`}>
      {canEdit && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onExclude(); }} title={`Remove ${b.actor.label} from the actor board (it stays tracked elsewhere; restore in ⚙ Actors)`}
          className="absolute top-1.5 right-1.5 z-[1] w-5 h-5 rounded text-[11px] leading-none text-slate-600 hover:text-red-300 hover:bg-slate-800">✕</button>
      )}
      <button onClick={onSelect} className="w-full text-left p-3">
        <div className="flex items-start gap-2 pr-4">
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
            <span key={i.instrument} title={`${INSTRUMENT_META[i.instrument].label}: ${i.why}${i.lead ? ` — ${MODALITY_WORD[i.lead.modality]}: “${i.lead.title}”` : ""}`}
              className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${STATE_CHIP[i.state]}`}>
              {INSTRUMENT_META[i.instrument].glyph} {shortLabel(i.instrument)}
            </span>
          ))}
          <span title={`Counter-pressure: ${b.counterPressure.why}`} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${STATE_CHIP[b.counterPressure.state]}`}>⇐ U.S.</span>
        </div>
        {/* Why it is on the board (§10 E6) */}
        <p className="mt-1.5 text-[9px] text-slate-600 truncate" title={b.actor.reason}>on the board: {b.actor.reason}</p>
        {a.learning && (
          <p className="text-[9px] text-amber-200/70">baseline forming — day {Math.min(b.baselineSamples + 1, BASELINE_DAYS)} of {BASELINE_DAYS}, held at Watch</p>
        )}
        {drv ? (
          <p className="mt-1.5 text-[10px] text-slate-300 leading-snug line-clamp-2" title={drv.text}>{drv.text}</p>
        ) : authored === 0 ? (
          <p className="mt-1.5 text-[10px] text-slate-500 leading-snug">
            {b.mentions > 0 ? `named in ${b.mentions} headline${b.mentions === 1 ? "" : "s"}, authored none` : `no headline names ${b.actor.label} in the window`} — absence of signal, not evidence of calm
          </p>
        ) : null}
        {b.corroboration.length > 0 && <p className="mt-1 text-[9.5px] text-sky-300/80 truncate">{b.corroboration.join(" · ")}</p>}
      </button>
    </div>
  );
}

const FIX_LABEL: Record<string, string> = { excluded: "excluded", chokepoint: "chokepoint", spelling: "spelling?", unknown: "not a country" };

/** The actor editor (§10 E6): who is on the board and why, who was skipped
 *  and the fix, who was excluded, and an add box. Owner edits write the
 *  Mission Profile `economy` overlay; crew sees the same list read-only. */
function ActorEditor({ body, canEdit, busy, onPatch, onClose }: { body: EconomicWarfareBody; canEdit: boolean; busy: boolean; onPatch: (next: EconomyEdits) => void; onClose: () => void }) {
  const [add, setAdd] = useState("");
  const edits = body.edits;
  const excluded = body.skipped.filter((s) => s.fix === "excluded");
  const problems = body.skipped.filter((s) => s.fix !== "excluded");
  const exclude = (name: string) => onPatch({ ...edits, exclude: [...edits.exclude.filter((e) => e.toLowerCase() !== name.toLowerCase()), name] });
  const restore = (name: string) => onPatch({ ...edits, exclude: edits.exclude.filter((e) => e.toLowerCase() !== name.toLowerCase()) });
  const addName = (name: string) => {
    const t = name.trim();
    if (!t) return;
    onPatch({ ...edits, add: [...edits.add.filter((a) => a.toLowerCase() !== t.toLowerCase()), t], exclude: edits.exclude.filter((e) => e.toLowerCase() !== t.toLowerCase()) });
    setAdd("");
  };
  const removeAdd = (name: string) => onPatch({ ...edits, add: edits.add.filter((a) => a.toLowerCase() !== name.toLowerCase()) });
  const row = "flex items-start gap-2 px-3 py-1.5 text-[10.5px]";
  const btn = "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500 disabled:opacity-40 flex-shrink-0";
  return (
    <div className="border-t border-slate-800 bg-slate-950/40">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800/60">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Actors — who is on the board and why</span>
        <span className="text-[9px] text-slate-600">{canEdit ? "✕ removes · ↩ restores · add by country name" : "read-only — the owner edits the register"}</span>
        <a href="?prefs=mission" className="ml-auto text-[9px] text-sky-400 hover:text-sky-300">edit tracking →</a>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm leading-none">×</button>
      </div>
      <div className="divide-y divide-slate-800/40">
        {body.actors.map((b) => (
          <div key={b.actor.id} className={row}>
            <span className="text-slate-100 font-semibold w-32 flex-shrink-0 truncate">{b.actor.label}</span>
            <span className="text-slate-500 flex-1 min-w-0 truncate" title={b.actor.reason}>{b.actor.reason}</span>
            {canEdit && b.actor.kind === "state" && !edits.add.some((a) => a.toLowerCase() === b.actor.label.toLowerCase()) && <button disabled={busy} onClick={() => exclude(b.actor.label)} className={btn}>✕ remove</button>}
            {canEdit && edits.add.some((a) => a.toLowerCase() === b.actor.label.toLowerCase()) && <button disabled={busy} onClick={() => removeAdd(b.actor.label)} className={btn}>✕ remove</button>}
          </div>
        ))}
        {problems.map((s) => (
          <div key={`skip:${s.name}`} className={`${row} bg-amber-500/[0.04]`}>
            <span className="text-amber-200 font-semibold w-32 flex-shrink-0 truncate">“{s.name}”</span>
            <span className="flex-1 min-w-0 text-slate-400 leading-snug">
              <span className="text-[8.5px] font-bold uppercase tracking-wider px-1 rounded border border-amber-500/40 text-amber-300 mr-1.5">{FIX_LABEL[s.fix] ?? s.fix}</span>
              <span className="text-slate-600">from {s.reason} · </span>{s.note}
            </span>
            {canEdit && s.fix === "spelling" && s.suggestion && (
              <button disabled={busy} onClick={() => { onPatch({ ...edits, add: [...edits.add.filter((a) => a.toLowerCase() !== s.suggestion!.toLowerCase()), s.suggestion!], exclude: edits.exclude }); }} className={btn}>＋ track as {s.suggestion}</button>
            )}
          </div>
        ))}
        {excluded.map((s) => (
          <div key={`ex:${s.name}`} className={`${row} opacity-70`}>
            <span className="text-slate-400 line-through w-32 flex-shrink-0 truncate">{s.name}</span>
            <span className="text-slate-600 flex-1 min-w-0 truncate">excluded · still tracked as {s.reason}</span>
            {canEdit && <button disabled={busy} onClick={() => restore(s.name)} className={btn}>↩ restore</button>}
          </div>
        ))}
        {canEdit && (
          <div className={row}>
            <input value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addName(add); } }} placeholder="add an actor by country name — e.g. Venezuela"
              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-200 placeholder:text-slate-600" />
            <button disabled={busy || !add.trim()} onClick={() => addName(add)} className={btn}>＋ add</button>
          </div>
        )}
      </div>
      <p className="px-3 py-1.5 text-[9px] text-slate-600 leading-snug border-t border-slate-800/60">
        The register is derived from what you track (AOI countries, watched countries, base hosts) and capped at 8; a ✕ here removes the tile only — the country stays tracked everywhere else. A name the app cannot place as a country never becomes an actor: fix it where it is tracked, or add the actor by its country name.
      </p>
    </div>
  );
}

export default function EconomicWarfareBoard({ active, refreshKey = 0 }: { active: boolean; refreshKey?: number }) {
  const [body, setBody] = useState<EconomicWarfareBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [actor, setActor] = useState<string | null>(null);
  const [inst, setInst] = useState<Instrument | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [showLeverage, setShowLeverage] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hoverDot, setHoverDot] = useState<TimelineDot | null>(null);
  const [pinDot, setPinDot] = useState<TimelineDot | null>(null);

  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  // A cold server answers `pending` within its bounded wait rather than
  // idling into the gateway timeout; we keep asking (up to ~2 min) and tell
  // the read panel once a real body has landed.
  const load = useCallback(() => {
    setError(null);
    let tries = 0;
    const attempt = () => {
      fetch("/api/markets/economic-warfare")
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => {
          if (!d || !Array.isArray(d.actors)) return;
          setBody({ skipped: [], edits: { exclude: [], add: [] }, ...d });
          if (d.pending && tries++ < 12) setTimeout(attempt, 8000);
          else if (!d.pending) window.dispatchEvent(new CustomEvent("econ:board-ready"));
        })
        .catch((e) => setError(e instanceof Error ? e.message : "failed"));
    };
    attempt();
  }, []);

  useEffect(() => { if (armed) load(); }, [armed, load, refreshKey]);
  // Who may edit the register — one small fetch, once.
  useEffect(() => {
    if (!armed) return;
    fetch("/api/mission-profile").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && typeof d.canEdit === "boolean") setCanEdit(d.canEdit); }).catch(() => {});
  }, [armed]);

  const patchEdits = useCallback(async (next: EconomyEdits) => {
    setBusy(true);
    try {
      const r = await fetch("/api/mission-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ economy: next }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setBody((b) => (b ? { ...b, edits: next, pending: true } : b));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save");
    } finally {
      setBusy(false);
    }
  }, [load]);

  const lanes = useMemo<Lane[]>(() => {
    if (!body) return [];
    const actorLanes: Lane[] = body.actors
      .filter((b) => !actor || b.actor.id === actor)
      .map((b) => ({ key: `actor:${b.actor.id}`, kind: "actor" as const, actorId: b.actor.id, label: `${b.actor.label.split(" (")[0]} — moves`, fill: ACTOR_FILL }));
    // An actor with dots but no tile (register changed since the strip was built) still gets a lane.
    const known = new Set(actorLanes.map((l) => l.key));
    for (const d of body.timeline.dots) {
      if (d.kind !== "actor" || !d.actorId || known.has(`actor:${d.actorId}`) || (actor && d.actorId !== actor)) continue;
      known.add(`actor:${d.actorId}`);
      actorLanes.push({ key: `actor:${d.actorId}`, kind: "actor", actorId: d.actorId, label: `${d.actorLabel ?? d.actorId} — moves`, fill: ACTOR_FILL });
    }
    return [...FIXED_TOP, ...actorLanes, ...FIXED_BOTTOM];
  }, [body, actor]);

  if (error && !body) {
    return (
      <div className="bg-slate-900/60 border border-red-500/30 rounded-xl p-3 text-[11px] text-red-300">
        Economic warfare board unavailable ({error}). UNKNOWN, not calm.
      </div>
    );
  }
  if (!body) return <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-600 font-mono">Reading the actor register…</div>;
  if (body.pending && body.actors.length === 0) {
    return <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-500 font-mono animate-pulse">{body.note}</div>;
  }
  if (!body.pending && body.actors.length === 0) {
    // A finished pass with no actors: nothing is tracked, every tracked name
    // was skipped (the note names them), or the assembly failed.
    return (
      <div className="bg-slate-900/60 border border-amber-500/30 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <p className="text-[11px] text-amber-200/90 flex-1 min-w-0">{body.note}</p>
          <button onClick={() => setShowEditor((v) => !v)} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500 flex-shrink-0">⚙ Actors</button>
        </div>
        {showEditor && <ActorEditor body={body} canEdit={canEdit} busy={busy} onPatch={patchEdits} onClose={() => setShowEditor(false)} />}
      </div>
    );
  }

  const rows = body.moves.filter((m) => (!actor || m.actorId === actor) && (inst === "all" || m.instrument === inst));
  const byMods = { act: rows.filter((m) => m.modality === "act").length, threat: rows.filter((m) => m.modality === "threat").length };
  const worst = body.actors[0]?.assessment.level ?? "calm";
  const detailDot = pinDot ?? hoverDot;
  const openDot = (d: TimelineDot) => {
    if (d.moveId) {
      if (d.actorId && actor && d.actorId !== actor) setActor(null);
      setInst("all");
      setOpen(d.moveId);
      requestAnimationFrame(() => document.getElementById(`econ-move-${d.moveId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    }
  };

  return (
    <div className="space-y-3">
      {/* Actor tiles */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
          <span className="text-[11px] font-bold uppercase tracking-widest text-orange-300">Actors</span>
          <span className="text-[10px] text-slate-600">{body.actors.length} tracked · worst {LEVEL_LABEL[worst]}{body.pending ? " · refreshing…" : ""}</span>
          {body.skipped.some((s) => s.fix !== "excluded") && (
            <button onClick={() => setShowEditor(true)} className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300 bg-amber-500/10" title="Tracked names that could not become actors">
              {body.skipped.filter((s) => s.fix !== "excluded").length} skipped
            </button>
          )}
          <span className="ml-auto text-[9.5px] text-slate-600 font-mono hidden sm:inline">
            {[body.sources.gdelt ? "GDELT" : null, body.sources.federalRegister ? "Fed. Register" : null, body.sources.foreign ? `EU/UK lists${body.foreign.failed.length ? ` (${body.foreign.failed.join("/")} down)` : ""}` : "EU/UK lists down", body.sources.chokepoints ? "chokepoints" : null, ...body.sources.ownSources].filter(Boolean).join(" · ") || "no live sensor"}
          </span>
          <button onClick={() => setShowEditor((v) => !v)} className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${showEditor ? "border-slate-500 text-slate-100 bg-slate-700/40" : "border-slate-700 text-slate-300 hover:border-slate-500"}`}>⚙ Actors</button>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {body.actors.map((b) => (
            <ActorTile key={b.actor.id} b={b} selected={actor === b.actor.id} onSelect={() => setActor(actor === b.actor.id ? null : b.actor.id)}
              canEdit={canEdit} onExclude={() => patchEdits({ ...body.edits, exclude: [...body.edits.exclude.filter((e) => e.toLowerCase() !== b.actor.label.toLowerCase()), b.actor.label], add: body.edits.add.filter((a) => a.toLowerCase() !== b.actor.label.toLowerCase()) })} />
          ))}
        </div>
        {showEditor && <ActorEditor body={body} canEdit={canEdit} busy={busy} onPatch={patchEdits} onClose={() => setShowEditor(false)} />}
        {error && <p className="px-3.5 pb-2 text-[10px] text-red-300">{error}</p>}
      </div>

      {/* Moves & counter-moves timeline — the sequence is the predictive signal */}
      {body.timeline.days.length > 0 && (() => {
        const dots = body.timeline.dots.filter((d) => !actor || d.actorId === actor || !d.actorId);
        const seqs = body.timeline.sequences.filter((s) => !actor || s.actorId === actor).slice(0, 5);
        return (
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
              <span className="text-[11px] font-bold uppercase tracking-widest text-orange-300">Moves &amp; counter-moves · 30d</span>
              <span className="text-[10px] text-slate-600">{dots.length === 0 ? "nothing dated in the window" : `${dots.length} dated moves · ${seqs.length} sequence${seqs.length === 1 ? "" : "s"}`}</span>
              <span className="ml-auto hidden sm:flex items-center gap-2 text-[9px] text-slate-600 font-mono">
                {[...FIXED_TOP, { key: "actor", kind: "actor" as const, label: "actor move (one lane each)", fill: ACTOR_FILL }, ...FIXED_BOTTOM].map((l) => <span key={l.key} className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ background: l.fill }} />{l.label}</span>)}
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full border border-dashed border-slate-400" />threat (hollow)</span>
              </span>
            </div>
            <div className="px-2 pt-2">
              <TimelineStrip days={body.timeline.days} dots={dots} lanes={lanes} picked={pinDot} onDot={(d, pin) => { if (pin) { setPinDot(d && pinDot === d ? null : d); if (d) openDot(d); } else setHoverDot(d); }} />
            </div>
            {/* The dot under the pointer / the pinned dot (§10 E5): what it is, which headline, which source. */}
            <div className="px-3.5 py-1.5 min-h-[26px] text-[10.5px] leading-snug border-t border-slate-800/60">
              {detailDot ? (
                <span className="text-slate-300">
                  <span className="text-slate-500 font-mono mr-1.5">{detailDot.day}</span>
                  {detailDot.modality && <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border mr-1.5 ${MODALITY_CHIP[detailDot.modality].cls}`}>{MODALITY_CHIP[detailDot.modality].text}</span>}
                  {detailDot.label}
                  {detailDot.title && <span className="text-slate-400"> — “{detailDot.title}”</span>}
                  {detailDot.source && <span className="text-slate-600"> · {detailDot.source}</span>}
                  {detailDot.link && <a href={detailDot.link} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-sky-300 hover:text-sky-200">open ↗</a>}
                  {pinDot && <button onClick={() => setPinDot(null)} className="ml-1.5 text-slate-600 hover:text-slate-300">×</button>}
                </span>
              ) : (
                <span className="text-slate-600">hover a dot for its headline · click to pin it and open its row on the coercion board</span>
              )}
            </div>
            {seqs.length > 0 && (
              <ul className="px-3.5 pb-2.5 pt-1 space-y-1">
                {seqs.map((q, i) => (
                  <li key={i} className="text-[10.5px] text-slate-300 leading-snug">
                    <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border mr-1.5 ${q.kind === "retaliation" ? "text-orange-200 border-orange-500/50 bg-orange-500/10" : "text-sky-200 border-sky-500/50 bg-sky-500/10"}`}>{q.kind}</span>
                    <span className="text-slate-100">{q.actorLabel}</span>: {q.firstLabel} <span className="text-slate-600">({q.firstDay.slice(5)})</span> → {q.secondLabel} <span className="text-slate-600">({q.secondDay.slice(5)}, {q.gapDays}d later)</span>
                  </li>
                ))}
              </ul>
            )}
            {body.timeline.lag && (
              <p className="px-3.5 pb-1 text-[10px] text-slate-400" title="Reported acts at Hormuz / Bab-el-Mandeb (the app's own cpact: record) against the Brent day-moves plotted above, within three days.">
                <span className="text-[8px] font-bold uppercase tracking-wider text-slate-600 mr-1.5">Strait → price</span>
                a reported strait act {body.timeline.lag.label} Brent moves ≥3%
              </p>
            )}
            <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
              One lane per actor: a solid dot is a reported act, a hollow dot a declared threat. A counter-move within ten days of a pressure move is the pattern to learn; analysis pieces, reversals and undated rows are never plotted. EU/UK lanes read from the consolidated sanctions lists{body.foreign.failed.length ? ` (${body.foreign.failed.join(" and ")} unavailable this pass — UNKNOWN, not quiet)` : ""}.
            </p>
          </div>
        );
      })()}

      {/* Leverage — structural, not warning */}
      {Object.keys(body.leverage).length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
          <button onClick={() => setShowLeverage((v) => !v)} className="w-full flex items-center gap-2 px-3.5 py-2 text-left hover:bg-slate-800/20">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Leverage map</span>
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-slate-700 text-slate-500">structural · not warning</span>
            <span className="ml-auto text-[10px] text-slate-600">{showLeverage ? "▾" : "▸"} {Object.keys(body.leverage).length} curated actor{Object.keys(body.leverage).length === 1 ? "" : "s"}</span>
          </button>
          {showLeverage && (
            <div className="border-t border-slate-800 divide-y divide-slate-800/60">
              {body.actors.filter((b) => body.leverage[b.actor.id] && (!actor || b.actor.id === actor)).map((b) => {
                const lev = body.leverage[b.actor.id];
                return (
                  <div key={b.actor.id} className="px-3.5 py-2.5">
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <span className="text-[12px] font-semibold text-slate-100">{b.actor.label}</span>
                      <span className="text-[9px] text-slate-600 font-mono">as of {lev.asOf} · curated, refreshed quarterly</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                      <div><p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-1">What they can threaten</p><LeverageBars items={lev.threatens} /></div>
                      <div><p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-1">What we hold over them</p><LeverageBars items={lev.weHold} /></div>
                    </div>
                  </div>
                );
              })}
              <p className="px-3.5 py-2 text-[9.5px] text-slate-600 leading-snug">Capacity, not activity: these bars never change colour and never feed a level. The board above scores what actors DO.</p>
            </div>
          )}
        </div>
      )}

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
                  {INSTRUMENT_META[i].glyph} {shortLabel(i)}{n ? ` ${n}` : ""}
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
                <div key={m.id} id={`econ-move-${m.id}`} className={m.modality === "reversal" ? "opacity-70" : ""}>
                  <button onClick={() => setOpen(isOpen ? null : m.id)} className={`w-full text-left px-3.5 py-2 hover:bg-slate-800/20 grid grid-cols-1 md:grid-cols-[110px_110px_92px_1fr_120px] gap-x-2 gap-y-1 items-start ${isOpen ? "bg-slate-800/20" : ""}`}>
                    <span className="text-[11px] text-slate-200 truncate">
                      {m.direction === "by" ? <>{m.actorLabel} <span className="text-slate-600">→</span> {m.target}</> : <>U.S. <span className="text-slate-600">→</span> {m.target}</>}
                    </span>
                    <span className="text-[10.5px] text-slate-300 truncate" title={m.cls}>{meta.glyph} {m.cls}</span>
                    <span className={`justify-self-start text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${MODALITY_CHIP[m.modality].cls}`}>{MODALITY_CHIP[m.modality].text}</span>
                    <span className="text-[11px] text-slate-200 leading-snug line-clamp-2">
                      {m.own && <span className="text-sky-300/80 mr-1">own·</span>}{m.title}
                      {m.mentions && m.mentions.length > 0 && <span className="text-[9.5px] text-slate-500"> · also names {m.mentions.join(", ")}</span>}
                    </span>
                    <span className="text-[9.5px] font-mono text-slate-600 truncate">{age(m.ageDays)}{m.source ? ` · ${m.source}` : ""}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3.5 pb-2.5 space-y-1 text-[10.5px]">
                      <p className="text-slate-500">
                        matched &ldquo;{m.phrase}&rdquo; · {m.direction === "by" ? "attributed to the actor (by)" : "done to the actor (against)"}
                        {m.mentions && m.mentions.length > 0 ? ` · ${m.mentions.join(", ")} ${m.mentions.length === 1 ? "is" : "are"} named but not credited — one author per headline` : ""}
                        {m.modality === "reversal" ? " · a reversal: the measure is being LIFTED — shown, never scored" : ""}
                        {m.own ? " · from your own sources — corroborates, never alone confirms" : ""}
                      </p>
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
          {body.note} Levels are earned by the anomaly against each actor&rsquo;s own 30-day baseline in the same engine as the OSINT I&amp;W boards; U.S. actions come from the Federal Register; EU and UK designation waves from the consolidated sanctions lists (PRC MOFCOM notices arrive through the capture extension). Unofficial posture aid, not intelligence.
        </p>
      </div>
    </div>
  );
}
