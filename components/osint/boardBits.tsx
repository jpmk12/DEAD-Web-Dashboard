"use client";

import { useEffect, useRef, useState } from "react";
import { StopTrackIcon } from "@/lib/icons";

import type { CbSitrep } from "@/lib/commandBoard";
import type { WindowBand } from "@/lib/opsTimeline";
import { SEVERITY_DOT, type Severity } from "@/lib/severity";
import { LED_CLASS, LEVEL_PILL } from "@/lib/levelTokens";

// The command board's small shared pieces — LEDs, the posture dot, the ★, the
// hub / spoke switch, the ✕ — used by the board, the airfields-by-command
// section and the room drawer. One glyph, one meaning (the lib/icons.tsx rule).
//
// The LED and level tokens live in lib/levelTokens; they are re-exported here
// under the names the board files already import.

export { LED_CLASS };
export const LVL_CHIP: Record<string, string> = LEVEL_PILL;
export const TRAJ: Record<string, string> = { deteriorating: "↗", improving: "↘", stable: "→" };

/** Owner-only add / remove / role controls; null for crew (read-only). */
export interface EditOps {
  busy: boolean;
  setRole: (icao: string, role: "hub" | "spoke" | null) => void;
  untrackField: (icao: string, own: "hub" | "spoke" | null) => void;
  untrackCountry: (country: string) => void;
}

export function Leds({ status, size = "w-1.5 h-1.5" }: { status: CbSitrep["status"]; size?: string }) {
  return (
    <span className="flex gap-0.5" title={`wx ${status.wx} · ops ${status.ops} · threat ${status.threat} · infra ${status.infra} · spectrum ${status.spectrum} (g green · a amber · r red · u unknown)`}>
      {(["wx", "ops", "threat", "infra", "spectrum"] as const).map((k) => <span key={k} className={`${size} rounded-full ${LED_CLASS[status[k]]}`} />)}
    </span>
  );
}

/** The 72-h read of a field as a thin band (lib/opsTimeline windowBand). Newer
 *  summaries carry two tracks — GENERATION over LAUNCH & RECOVERY — older ones
 *  the merged limiting windows. Every band is drawn on the SAME clock (this
 *  hour → +72 h, ticks at Zulu midnights), so the rows of the airfield
 *  register line up and can be compared down the column; hours a summary did
 *  not cover read hatched, never clear. */
export function Band72({ band, className = "" }: { band: WindowBand | null | undefined; className?: string }) {
  if (!band) return null;
  const H = 3_600_000;
  const start = Math.floor(Date.now() / H) * H;
  const span = 72 * H;
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - start) / span) * 100));
  const dataEnd = band.startMs + band.hours * H;
  const midnights: number[] = [];
  for (let ms = Math.ceil(start / (24 * H)) * 24 * H; ms < start + span; ms += 24 * H) midnights.push(ms);
  const two = Boolean(band.gen && band.launch);
  const standing = band.standing?.length ? `\nStanding: ${band.standing.join(", ")}` : "";
  const title = !band.live ? "72-h ops timeline UNKNOWN — no TAF and no model profile"
    : two ? `Next 72 h (top: generation · bottom: launch & recovery)${standing}\n${[...(band.gen ?? []).map((r) => `GEN ${r.label}`), ...(band.launch ?? []).map((r) => `L&R ${r.label}`)].join("\n") || "both clear"}`
    : band.windows.length ? `Next 72 h:\n${band.windows.map((w) => w.label).join("\n")}`
    : "Next 72 h: no limiting window";
  const RUN: Record<string, string> = { a: "bg-amber-400/80", r: "bg-red-500/85", u: "bg-slate-500/50" };
  const track = (runs: { fromMs: number; toMs: number; tone: string }[], h: string) => (
    <span className={`relative block w-full ${h} ${band.live ? "bg-emerald-500/20" : "border border-dashed border-slate-600"}`}>
      {band.live && runs.filter((r) => r.toMs > start).map((r, i) => (
        <span key={i} className={`absolute top-0 bottom-0 ${RUN[r.tone] ?? RUN.a}`} style={{ left: `${pct(r.fromMs)}%`, width: `${Math.max(1.2, pct(r.toMs) - pct(r.fromMs))}%` }} />
      ))}
      {/* hours the summary did not reach (assembled earlier) — not clear */}
      {band.live && dataEnd < start + span && <span className="absolute top-0 bottom-0 bg-slate-900 [background-image:repeating-linear-gradient(45deg,rgba(100,116,139,.5)_0_2px,transparent_2px_4px)]" style={{ left: `${pct(dataEnd)}%`, right: 0 }} />}
    </span>
  );
  return (
    <span className={`flex items-center gap-1.5 ${className}`} title={title}>
      <span className="text-[8px] font-mono text-slate-600 flex-shrink-0 leading-none">{two ? <>G<br />L</> : "72h"}</span>
      <span className="relative flex-1 flex flex-col gap-px rounded-sm overflow-hidden">
        {two ? <>{track(band.gen!, "h-[3px]")}{track(band.launch!, "h-[3px]")}</> : track(band.windows, "h-[5px]")}
        {midnights.map((ms) => <span key={ms} className="absolute top-0 bottom-0 w-px bg-slate-950/80" style={{ left: `${pct(ms)}%` }} />)}
        {standing && <span className="absolute right-0 top-0 bottom-0 w-[3px] bg-amber-300" title={standing.trim()} />}
      </span>
    </span>
  );
}

export function Dot({ sev, title }: { sev: Severity | null; title?: string }) {
  return <span style={{ color: sev ? SEVERITY_DOT[sev] : "#334155" }} className="text-[11px]" title={title ?? (sev ?? "not watched")}>●</span>;
}

/** The hub / spoke switch: the active role is lit; tapping it again clears the role. */
export function RoleSwitch({ icao, role, onSet, disabled }: { icao: string; role: "hub" | "spoke" | null; onSet: (r: "hub" | "spoke" | null) => void; disabled?: boolean }) {
  const chip = (r: "hub" | "spoke") => {
    const on = role === r;
    return (
      <span
        key={r} role="button" tabIndex={0} aria-pressed={on} aria-disabled={disabled}
        title={on ? `${icao} is a ${r} — click to clear its own-force role` : r === "hub" ? `Make ${icao} a hub (other hubs stay hubs)` : `Make ${icao} a spoke`}
        onClick={(e) => { e.stopPropagation(); if (!disabled) onSet(on ? null : r); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (!disabled) onSet(on ? null : r); } }}
        className={`inline-flex items-center min-h-[28px] text-[8px] font-bold uppercase tracking-widest rounded px-1 py-1 border cursor-pointer select-none ${on ? "border-sky-500/60 text-sky-200 bg-sky-500/15" : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500"} ${disabled ? "opacity-40 cursor-default" : ""}`}
      >{r}</span>
    );
  };
  return <span className="inline-flex items-center gap-1" title="own-force role">{chip("hub")}{chip("spoke")}</span>;
}

/**
 * Stop tracking a thing everywhere — a span so it can sit inside a row button.
 * Two taps, never one: the first ARMS it ("remove?" in red), the second
 * removes; it disarms itself after 4 s or when the pointer leaves. The glyph
 * is a trash can, never an ✕, so it cannot be mistaken for a close control
 * (2026-11-24). `labelled` is the drawer's header form — words, not a glyph.
 */
export function Untrack({ label, onClick, disabled, labelled = false }: { label: string; onClick: () => void; disabled?: boolean; labelled?: boolean }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const disarm = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setArmed(false); };
  const press = () => {
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 4_000);
      return;
    }
    disarm();
    onClick();
  };
  const title = armed ? `Tap again to stop tracking ${label} (Undo offered)` : `Stop tracking ${label} — removes it from every list (asks to confirm; Undo offered)`;
  const base = "inline-flex items-center gap-1 min-h-[28px] leading-none rounded cursor-pointer select-none";
  const cls = labelled
    ? `${base} text-[10px] font-bold uppercase tracking-wider px-2 py-1 border ${armed ? "border-red-500 bg-red-500/20 text-red-200" : "border-red-500/40 text-red-300/90 hover:bg-red-500/10 hover:text-red-200"}`
    : `${base} text-[10px] px-1 py-1 ${armed ? "text-red-200 bg-red-500/20 border border-red-500/70 font-bold" : "text-slate-600 hover:text-red-300"}`;
  return (
    <span
      role="button" tabIndex={0} aria-disabled={disabled} title={title} aria-label={armed ? `Confirm: stop tracking ${label}` : `Stop tracking ${label}`}
      onClick={(e) => { e.stopPropagation(); press(); }}
      onMouseLeave={() => { if (armed && !labelled) disarm(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); press(); } if (e.key === "Escape" && armed) { e.stopPropagation(); disarm(); } }}
      className={`${cls} ${disabled ? "opacity-40 cursor-default" : ""}`}
    >
      <StopTrackIcon size={labelled ? 12 : 12} aria-hidden />
      {labelled ? (armed ? `Confirm — stop tracking ${label}` : "Stop tracking") : armed ? "remove?" : null}
    </span>
  );
}

/** ★ as a span (it sits inside row buttons); the handler owns the owner gate. */
export function Star({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <span
      role="button" tabIndex={0} aria-disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (!disabled) onClick(); } }}
      title={on ? `★ must-track — click to clear (${label})` : `Make ${label} a must-track`}
      aria-label={on ? `Clear must-track ${label}` : `Make ${label} a must-track`}
      className={`inline-flex items-center min-h-[28px] text-[14px] leading-none px-1 py-1 rounded transition-colors cursor-pointer select-none ${disabled ? "opacity-40" : ""} ${on ? "text-amber-400 hover:text-amber-300" : "text-slate-500 hover:text-amber-400"}`}
    >{on ? "★" : "☆"}</span>
  );
}
