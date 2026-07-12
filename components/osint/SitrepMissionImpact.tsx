"use client";

import { useState } from "react";
import type { SitrepPayload } from "@/lib/sitrep";
import { MISSION_FUNCTIONS, type Capability, type LimfacStatus } from "@/lib/limfac";

const CAP_PILL: Record<Capability, string> = {
  fmc: "bg-emerald-500/15 text-emerald-300 border-emerald-500/50",
  pmc: "bg-amber-500/15 text-amber-300 border-amber-500/55",
  nmc: "bg-red-500/15 text-red-300 border-red-500/55",
  unknown: "bg-slate-700/30 text-slate-400 border-slate-600",
};
const CAP_TXT: Record<Capability, string> = { fmc: "FMC", pmc: "PMC", nmc: "NMC", unknown: "UNK" };
const CAP_LONG: Record<Capability, string> = { fmc: "Fully", pmc: "Partially", nmc: "Non-", unknown: "Status" };
const CAP_BAR: Record<Capability, string> = { fmc: "border-emerald-500/40", pmc: "border-l-amber-400", nmc: "border-l-red-500", unknown: "border-l-slate-600" };

interface ReadState { bluf: string[]; watch: string[]; asks?: string[]; disabled?: boolean; ai?: boolean; reason?: string; detail?: string }

export default function SitrepMissionImpact({
  payload, read, readLoading, readError, onRetryRead, onChanged,
}: {
  payload: SitrepPayload;
  read: ReadState | null;
  readLoading: boolean;
  readError?: boolean;
  onRetryRead?: () => void;
  onChanged: () => void;
}) {
  const mi = payload.mission;
  const icao = payload.base.icao;
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ fn: "arff", capability: "pmc" as Capability, driver: "", impact: "", mitigation: "", ask: "", from: "", to: "", ccir: false });

  const submit = async () => {
    if (!form.driver.trim() || !form.impact.trim() || busy) return;
    setBusy(true);
    try {
      const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
      await fetch("/api/sitrep/limfac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icao, fn: form.fn, capability: form.capability, driver: form.driver, impact: form.impact, mitigation: form.mitigation, ask: form.ask, ccir: form.ccir, fromISO: toIso(form.from), toISO: toIso(form.to) }),
      });
      setAddOpen(false);
      setForm({ fn: "arff", capability: "pmc", driver: "", impact: "", mitigation: "", ask: "", from: "", to: "", ccir: false });
      onChanged();
    } finally { setBusy(false); }
  };

  const setStatus = async (id: string, status: LimfacStatus) => {
    await fetch("/api/sitrep/limfac", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "status", id, status }) }).catch(() => {});
    onChanged();
  };

  // "Keep active" — drop the passed end window so the stale nudge clears.
  const keepActive = async (id: string) => {
    await fetch("/api/sitrep/limfac", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "extend", id }) }).catch(() => {});
    onChanged();
  };

  return (
    <div className="border border-slate-800 bg-slate-900/50 rounded-2xl p-3.5 space-y-3">
      {/* Mission-capability state */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Mission Impact — {icao}</span>
        <span className={`text-[11px] font-extrabold font-mono tracking-wider px-2.5 py-1 rounded-lg border ${CAP_PILL[mi.state]}`}>
          {CAP_TXT[mi.state]} · {CAP_LONG[mi.state]} Mission Capable
        </span>
        <span className="text-[9px] text-slate-600 font-mono">{mi.limfacs.length} active LIMFAC{mi.limfacs.length === 1 ? "" : "s"}</span>
      </div>

      {/* CCIR flags */}
      {mi.ccir.length > 0 && (
        <div className="space-y-1">
          {mi.ccir.map((c) => (
            <div key={c.key} className="flex items-center gap-2 border border-red-500/40 bg-red-500/[0.07] rounded-lg px-2.5 py-1.5">
              <span className="text-[8px] font-extrabold uppercase tracking-wider text-red-200 border border-red-500/50 rounded px-1.5 py-[1px]">CCIR</span>
              <span className="text-[11.5px] text-red-200">{c.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Commander's Read — moved up under the top-line. Never blank: when the
          AI model is off or erroring, the server returns a deterministic
          mission-derived read (ai:false) and we badge it as auto + offer Retry. */}
      {(readLoading || read || readError) && (() => {
        const isAuto = Boolean(read && read.ai === false);
        const showRetry = Boolean(onRetryRead && !readLoading && (readError || isAuto));
        return (
        <div className="border border-amber-500/30 bg-amber-500/[0.04] rounded-xl px-3.5 py-2.5">
          <div className="flex items-start gap-2 mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300/90">
              ✦ Commander&apos;s Read — for leadership {readLoading ? <span className="font-normal normal-case text-slate-500">— generating…</span> : isAuto ? <span className="font-normal normal-case text-slate-500">— auto summary (AI unavailable)</span> : readError ? <span className="font-normal normal-case text-slate-500">— unavailable</span> : null}
            </p>
            {showRetry && <button onClick={onRetryRead} className="ml-auto flex-shrink-0 text-[9px] font-bold uppercase tracking-wider text-amber-300 border border-amber-500/40 rounded px-2 py-0.5 hover:bg-amber-500/10">↻ Retry AI</button>}
          </div>
          {readError && !readLoading && !read && (
            <p className="text-[11px] text-slate-400">The read couldn&apos;t be generated. The signals below are unaffected.</p>
          )}
          {read && read.bluf.length > 0 && (
            <>
              <ul className="space-y-1.5">
                {read.bluf.map((b, i) => (
                  <li key={i} className="text-xs text-slate-200 leading-relaxed pl-4 relative break-words"><span className="absolute left-0 text-amber-400">▸</span>{b}</li>
                ))}
              </ul>
              {read.asks && read.asks.length > 0 && (
                <p className="text-[10.5px] mt-2 text-amber-300 break-words"><span className="font-bold uppercase tracking-wider text-[9px]">Asks to leadership:</span> {read.asks.join(" · ")}</p>
              )}
              {read.watch.length > 0 && (
                <p className="text-[10.5px] text-slate-400 mt-1 break-words"><span className="font-bold text-slate-500 uppercase tracking-wider text-[9px]">Watch:</span> {read.watch.join(" · ")}</p>
              )}
              {isAuto && (
                <p className="text-[9px] text-slate-600 mt-2 leading-snug">Built from the mission signals below without the AI model — the model call {read.reason === "no-key" || read.reason === "feature-off" ? "is disabled" : "failed"}. Tap “Retry AI” for the synthesized version.</p>
              )}
            </>
          )}
        </div>
        );
      })()}

      {/* Mission capability by function */}
      <div>
        <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">Mission capability by function</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {mi.functions.map((f) => (
            <div key={f.key} className="flex items-center gap-2 bg-slate-950/40 border border-slate-800 rounded-lg px-2.5 py-1.5 overflow-hidden min-w-0">
              <span className={`text-[8px] font-extrabold font-mono px-1.5 py-0.5 rounded border w-10 text-center flex-shrink-0 ${CAP_PILL[f.capability]}`}>{CAP_TXT[f.capability]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-200 leading-tight truncate">{f.label}{f.derived && <span className="ml-1 text-[8px] text-violet-300 font-bold">◆ derived</span>}</p>
                <p className="text-[9.5px] text-slate-500 truncate" title={f.driver}>{f.driver}{f.window ? ` · ${f.window}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* LIMFAC register */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600">LIMFAC register</p>
          <div className="flex-1 h-px bg-slate-800" />
          <button onClick={() => setAddOpen((v) => !v)} className="text-[9px] font-bold uppercase tracking-wider text-sky-300 border border-sky-500/40 rounded px-2 py-0.5 hover:bg-sky-500/10">＋ Add LIMFAC</button>
        </div>

        {mi.limfacs.length === 0 && !addOpen && (
          <p className="text-[10.5px] text-slate-600 font-mono px-1">No limiting factors — airfield FMC. Add commander-known LIMFACs (ARFF, MHE, manning, barriers, fuel, MOG) with ＋.</p>
        )}

        <div className="space-y-1.5">
          {mi.limfacs.map((l) => (
            <div key={l.id} className={`border border-slate-800 rounded-lg px-3 py-2 border-l-[3px] ${CAP_BAR[l.capability]}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] font-mono font-bold text-slate-600">{l.id.length > 6 ? l.id.slice(0, 4) : l.id}</span>
                <span className="text-[11.5px] font-bold text-slate-100">{l.fnLabel} — {CAP_TXT[l.capability]}</span>
                <span className={`text-[8px] font-bold uppercase tracking-wider rounded px-1.5 py-[1px] border ${l.source === "manual" ? "text-sky-300 border-sky-500/50 bg-sky-500/10" : "text-slate-400 border-slate-700"}`}>{l.source === "manual" ? "Commander" : "Auto"}</span>
                {l.ccir && <span className="text-[8px] font-bold uppercase tracking-wider text-red-300 border border-red-500/50 rounded px-1.5 py-[1px]">CCIR</span>}
                {l.window && <span className="ml-auto text-[9.5px] font-mono text-slate-400">{l.window}</span>}
              </div>
              <div className="mt-1.5 text-[11px] text-slate-300 leading-relaxed space-y-0.5 break-words">
                <p><span className="text-slate-500 font-semibold text-[9px] uppercase tracking-wider">Driver:</span> {l.driver}</p>
                <p><span className="text-slate-500 font-semibold text-[9px] uppercase tracking-wider">Impact:</span> <span className="text-slate-200">{l.impact}</span></p>
                {l.mitigation && <p><span className="text-slate-500 font-semibold text-[9px] uppercase tracking-wider">Mitigation:</span> {l.mitigation}</p>}
                {l.ask && <p className="text-amber-300"><span className="font-semibold text-[9px] uppercase tracking-wider">Ask:</span> {l.ask}</p>}
              </div>
              {l.stale && (
                <div className="mt-1.5 flex items-center gap-2 border border-amber-500/40 bg-amber-500/[0.08] rounded px-2 py-1">
                  <span className="text-[10px] text-amber-300">⏳ Window passed{l.window ? ` (${l.window})` : ""} — still active? Resolve or update.</span>
                </div>
              )}
              {l.source === "manual" && (
                <div className="flex items-center gap-2 mt-1.5">
                  {l.enteredBy && <span className="text-[8.5px] text-slate-600 font-mono">— {l.enteredBy}</span>}
                  {l.stale && <button onClick={() => keepActive(l.id)} className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-400 border border-slate-600 rounded px-2 py-0.5 hover:bg-slate-700/30">Keep active</button>}
                  <button onClick={() => setStatus(l.id, "resolved")} className={`${l.stale ? "" : "ml-auto"} text-[9px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded px-2 py-0.5 hover:bg-emerald-500/10`}>✓ Resolve</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add-LIMFAC form */}
        {addOpen && (
          <div className="mt-2 border border-sky-500/30 bg-sky-500/[0.04] rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Function
                <select value={form.fn} onChange={(e) => setForm({ ...form, fn: e.target.value })} className="mt-0.5 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200">
                  {MISSION_FUNCTIONS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Capability
                <select value={form.capability} onChange={(e) => setForm({ ...form, capability: e.target.value as Capability })} className="mt-0.5 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200">
                  <option value="pmc">PMC — partially</option>
                  <option value="nmc">NMC — non-capable</option>
                  <option value="fmc">FMC — advisory</option>
                </select>
              </label>
            </div>
            <input value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })} placeholder="Driver — e.g. ARFF Cat 7 → Cat 5 (truck in maint)" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })} placeholder="Mission impact — e.g. recovery limited to C-130 class until 1200Z" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={form.mitigation} onChange={(e) => setForm({ ...form, mitigation: e.target.value })} placeholder="Mitigation (optional)" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={form.ask} onChange={(e) => setForm({ ...form, ask: e.target.value })} placeholder="Ask to leadership (optional)" className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">From (optional)
                <input type="datetime-local" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className="mt-0.5 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200" />
              </label>
              <label className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Until (optional)
                <input type="datetime-local" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className="mt-0.5 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200" />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[10px] text-slate-400"><input type="checkbox" checked={form.ccir} onChange={(e) => setForm({ ...form, ccir: e.target.checked })} /> Flag as CCIR (leadership-critical)</label>
              <button onClick={submit} disabled={busy || !form.driver.trim() || !form.impact.trim()} className="ml-auto text-[10px] font-bold uppercase tracking-wider bg-sky-500 text-slate-950 px-3 py-1 rounded disabled:opacity-40">{busy ? "…" : "Add LIMFAC"}</button>
              <button onClick={() => setAddOpen(false)} className="text-[10px] text-slate-500 hover:text-slate-300">Cancel</button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[8.5px] text-slate-600 leading-relaxed">
        Auto LIMFACs cite their NOTAM/METAR/feed; commander-entered are badged and shared with the crew. Capability calls are planning aids for the commander&apos;s judgment, not directive — an unreachable source reads UNKNOWN, never FMC.
      </p>
    </div>
  );
}
