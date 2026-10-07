"use client";

import type { CbSitrep } from "@/lib/commandBoard";
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
        title={on ? `${icao} is the ${r} — click to clear its own-force role` : r === "hub" ? `Make ${icao} the hub (the current hub becomes a spoke)` : `Make ${icao} a spoke`}
        onClick={(e) => { e.stopPropagation(); if (!disabled) onSet(on ? null : r); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (!disabled) onSet(on ? null : r); } }}
        className={`inline-flex items-center min-h-[28px] text-[8px] font-bold uppercase tracking-widest rounded px-1 py-1 border cursor-pointer select-none ${on ? "border-sky-500/60 text-sky-200 bg-sky-500/15" : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500"} ${disabled ? "opacity-40 cursor-default" : ""}`}
      >{r}</span>
    );
  };
  return <span className="inline-flex items-center gap-1" title="own-force role">{chip("hub")}{chip("spoke")}</span>;
}

/** The ✕ that stops tracking a thing everywhere — a span so it can sit inside a row button. */
export function Untrack({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <span
      role="button" tabIndex={0} aria-disabled={disabled} title={`Stop tracking ${label} (removes it from every list — Undo offered)`} aria-label={`Stop tracking ${label}`}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (!disabled) onClick(); } }}
      className={`inline-flex items-center min-h-[28px] text-[11px] leading-none px-1 py-1 rounded text-slate-600 hover:text-red-300 cursor-pointer select-none ${disabled ? "opacity-40 cursor-default" : ""}`}
    >✕</span>
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
