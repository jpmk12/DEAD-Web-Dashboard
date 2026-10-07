"use client";

import { useEffect, useMemo, useState } from "react";
import { Leds, Dot, Star, RoleSwitch, Untrack, type EditOps } from "@/components/osint/boardBits";
import { LED_CLASS } from "@/lib/levelTokens";
import { openTrackPicker } from "@/lib/trackClient";
import type { CommandBoard, FieldRow } from "@/lib/commandBoard";
import { airfieldsByCommand, fieldWorst, sameRoom, type RoomRef } from "@/lib/room";
import { COCOM_LABEL, type Aor } from "@/lib/aor";

// Airfields by command (REVIEW-2026-10 §11 A′): every tracked field in ONE
// register grouped under its combatant command — the Weather tab's grouping,
// on the board — hub › ★ › spokes › rest inside a group, worst group first,
// with the LEDs, the worst-field line per group, filter chips, "hide green",
// and the hub / spoke / ★ / ✕ controls on the row. A row is a door into the
// room's airfield page. My airfields stays as the pinned shortlist above.

const LED_DOT: Record<string, string> = LED_CLASS;
const HIDE_KEY = "commands.afHideGreen";

export default function CommandAirfields({ board, room, onOpen, star, mtBusy, edit, canEdit }: {
  board: CommandBoard;
  room: RoomRef | null;
  onOpen: (ref: RoomRef) => void;
  star: (k: "aor" | "country" | "icao", v: string) => void;
  mtBusy: boolean;
  edit: EditOps | null;
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<Aor | "ALL">("ALL");
  const [hideGreen, setHideGreen] = useState(false);
  useEffect(() => { try { setHideGreen(localStorage.getItem(HIDE_KEY) === "1"); } catch { /* ignore */ } }, []);
  const toggleHide = () => { setHideGreen((v) => { try { localStorage.setItem(HIDE_KEY, v ? "0" : "1"); } catch { /* ignore */ } return !v; }); };

  const groups = useMemo(() => airfieldsByCommand(board), [board]);
  const total = groups.reduce((n, g) => n + g.fields.length, 0);
  const shown = groups.filter((g) => filter === "ALL" || g.aor === filter);

  return (
    <section className="border border-slate-800 rounded-xl bg-slate-900/40 overflow-hidden">
      <div className="px-3.5 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-300">✈ Airfields by command</span>
        <span className="text-[10px] text-slate-500">{total} tracked · hub › ★ › spokes › rest · worst first</span>
        <span className="flex-1" />
        <button onClick={() => setFilter("ALL")} className={`text-[10px] rounded-full px-2.5 py-0.5 border ${filter === "ALL" ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>All <span className="font-mono text-slate-500">{total}</span></button>
        {groups.map((g) => (
          <button key={g.aor} onClick={() => setFilter(g.aor)} className={`text-[10px] rounded-full px-2.5 py-0.5 border ${filter === g.aor ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>{g.aor === "UNKNOWN" ? "—" : g.aor} <span className="font-mono text-slate-500">{g.fields.length}</span></button>
        ))}
        <button onClick={toggleHide} className={`text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${hideGreen ? "border-sky-500/60 text-sky-300 bg-sky-500/10" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>hide green</button>
        {canEdit && <button onClick={() => openTrackPicker({ kind: "airfield" })} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">＋ Track…</button>}
      </div>

      <div className="hidden lg:grid grid-cols-[22px_1.4fr_1.3fr_96px_1fr_.9fr_.7fr_20px] gap-2.5 px-3.5 py-1.5 border-b border-slate-800 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        <span /><span>airfield</span><span>driver</span><span>wx·ops·thr·inf·spc</span><span>posture</span><span>role</span><span>Δ yesterday</span><span />
      </div>

      {total === 0 && <p className="px-3.5 py-3 text-[11px] text-slate-500">No airfield tracked yet. <button type="button" onClick={() => openTrackPicker({ kind: "airfield" })} className="text-emerald-400 hover:underline">＋ Track…</button> one by ICAO, name or country.</p>}

      {shown.map((g) => {
        const rows = g.fields.filter((f) => !hideGreen || fieldWorst(f) !== "g");
        const hidden = g.fields.length - rows.length;
        return (
          <div key={g.aor}>
            <div className="flex items-center gap-2 px-3.5 py-1.5 border-t border-slate-800 bg-slate-950/40 text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-sky-300">
              <span className={`w-2 h-2 rounded-full ${LED_DOT[g.worstLed]}`} />
              {COCOM_LABEL[g.aor]}
              <span className="ml-auto font-mono font-normal normal-case tracking-normal text-slate-500 truncate">{g.fields.length} field{g.fields.length === 1 ? "" : "s"}{g.worst && g.worstLed !== "g" ? ` · worst: ${g.worst.icao} — ${g.worst.sitrep?.driver ?? g.worst.posture?.topDriver ?? "UNKNOWN"}` : g.fields.length ? " · all green" : ""}{g.aor === "UNKNOWN" ? " · no command — the field has no coordinates or country on record" : ""}</span>
            </div>
            {rows.map((f) => <Row key={f.icao} f={f} sel={sameRoom(room, { kind: "field", id: f.icao })} onOpen={onOpen} star={star} mtBusy={mtBusy} edit={edit} />)}
            {hidden > 0 && <p className="px-3.5 py-1.5 text-[10px] text-slate-500 border-t border-slate-800/60"><b className="text-slate-400">{hidden} green field{hidden === 1 ? "" : "s"}</b> hidden — {g.fields.filter((f) => fieldWorst(f) === "g").map((f) => f.icao).join(" · ")}</p>}
          </div>
        );
      })}
    </section>
  );
}

function Row({ f, sel, onOpen, star, mtBusy, edit }: { f: FieldRow; sel: boolean; onOpen: (ref: RoomRef) => void; star: (k: "aor" | "country" | "icao", v: string) => void; mtBusy: boolean; edit: EditOps | null }) {
  const worst = fieldWorst(f);
  const driver = f.sitrep ? f.sitrep.driver : f.posture ? f.posture.topDriver : "posture UNKNOWN — not watched";
  return (
    <button onClick={() => onOpen({ kind: "field", id: f.icao })} id={`cb-af-${f.icao}`}
      className={`w-full text-left grid grid-cols-[22px_1fr_auto_20px] lg:grid-cols-[22px_1.4fr_1.3fr_96px_1fr_.9fr_.7fr_20px] gap-2.5 items-center px-3.5 py-2 border-t border-slate-800/60 hover:bg-slate-800/30 ${sel ? "bg-sky-500/[0.07] shadow-[inset_3px_0_0_#38bdf8]" : ""} ${worst === "r" ? "bg-red-500/[0.03]" : ""}`}>
      <Star on={f.star} label={f.icao} onClick={() => star("icao", f.icao)} disabled={mtBusy} />
      <span className="min-w-0 flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-extrabold font-mono text-slate-100">{f.icao}</span>
        {f.role && <span className={`text-[8px] font-bold uppercase tracking-widest border rounded px-1 py-px ${f.role === "hub" ? "border-sky-500/50 text-sky-300" : "border-slate-700 text-slate-400"}`}>{f.role}</span>}
        <span className="text-[10px] font-mono text-slate-500 truncate">{f.country || "—"}</span>
        <span className="lg:hidden text-[10.5px] text-slate-500 truncate w-full">{driver}</span>
      </span>
      <span className={`hidden lg:block text-[11px] truncate ${worst === "r" ? "text-red-300" : worst === "a" ? "text-amber-300" : "text-slate-400"}`}>{driver}{f.sitrep && f.sitrep.worse.length > 0 && <span className="ml-1 text-amber-400 font-bold" title={`worse than yesterday: ${f.sitrep.worse.join(", ")}`}>▲</span>}</span>
      <span className="hidden lg:block">{f.sitrep ? <Leds status={f.sitrep.status} size="w-2 h-2" /> : <span className="text-[9px] text-slate-600">no SITREP</span>}</span>
      <span className="hidden lg:flex items-center gap-1.5 text-[10px] font-mono text-slate-400"><Dot sev={f.posture?.composite ?? null} />{f.posture ? f.posture.composite : <span className="text-slate-600">not watched</span>}</span>
      <span className="hidden lg:flex items-center gap-1.5">
        {edit ? <RoleSwitch icao={f.icao} role={f.role} onSet={(r) => edit.setRole(f.icao, r)} disabled={edit.busy} /> : <span className="text-[9px] text-slate-600">{f.role ?? "—"}</span>}
        {edit && <Untrack label={f.icao} onClick={() => edit.untrackField(f.icao, f.role)} disabled={edit.busy} />}
      </span>
      <span className={`hidden lg:block text-[10px] font-mono ${f.sitrep && f.sitrep.worse.length ? "text-red-300" : "text-slate-500"}`}>{f.sitrep ? (f.sitrep.worse.length ? `${f.sitrep.worse.join("/")} worse` : "same") : "—"}</span>
      <span className={`text-[10px] justify-self-end ${sel ? "text-sky-300" : "text-slate-600"}`}>→</span>
    </button>
  );
}
