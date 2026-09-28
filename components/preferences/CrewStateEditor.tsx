"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/feedback";
import type { CrewSummary, CrewAvailability } from "@/lib/crewState";

// Team state editor — crew COUNTS per qualification level. No names by
// design. Availability is derived on the server (total − outs) and shown
// back, with an invalid row called out rather than clamped. Any allowlisted
// crew member can update (the DO keeps this current); each row shows who
// touched it last and when, and the whole block warns when it is stale.

type Draft = { qual: string; label: string; total: string; crewRest: string; onMission: string; dnif: string; other: string; note: string };
const toDraft = (r: CrewAvailability): Draft => ({ qual: r.qual, label: r.label, total: String(r.total), crewRest: String(r.crewRest), onMission: String(r.onMission), dnif: String(r.dnif), other: String(r.other), note: r.note ?? "" });

const ago = (iso: string | null): string => {
  if (!iso) return "never";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h)) return "—";
  return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
};

export default function CrewStateEditor() {
  const [summary, setSummary] = useState<CrewSummary | null>(null);
  const [headline, setHeadline] = useState<string>("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/team/crew", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setSummary(j.summary);
      setHeadline(j.posture?.headline ?? "");
    } catch { /* leave */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const r = await fetch("/api/team/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ row: { ...editing, total: Number(editing.total), crewRest: Number(editing.crewRest), onMission: Number(editing.onMission), dnif: Number(editing.dnif), other: Number(editing.other) } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error || "Could not save."); return; }
      toast.ok(`${editing.qual} updated.`);
      setEditing(null);
      await load();
    } finally { setBusy(false); }
  };

  const remove = async (qual: string) => {
    setBusy(true);
    try {
      await fetch(`/api/team/crew?qual=${encodeURIComponent(qual)}`, { method: "DELETE" });
      toast.info(`${qual} removed.`);
      await load();
    } finally { setBusy(false); }
  };

  const seed = async () => {
    setBusy(true);
    try {
      await fetch("/api/team/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "seed" }) });
      await load();
    } finally { setBusy(false); }
  };

  const num = (k: keyof Draft, label: string) => (
    <label className="block">
      <span className="block text-[9px] uppercase tracking-wider text-slate-500">{label}</span>
      <input type="number" min={0} max={999} value={editing?.[k] ?? ""} onChange={(e) => setEditing((d) => (d ? { ...d, [k]: e.target.value } : d))}
        className="w-full bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 font-mono" />
    </label>
  );

  return (
    <div className="mt-6 border-t border-slate-800 pt-4">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-slate-400">Team state — crews by qualification</label>
          <p className="text-[10px] text-slate-600">Counts only, no names. Availability is derived: total − (crew rest + on mission + DNIF + other). Shared with the crew; each row shows who updated it.</p>
        </div>
      </div>

      {summary && (
        <div className={`rounded-lg border px-3 py-2 mb-3 text-[11px] ${summary.stale ? "border-amber-500/40 bg-amber-500/[0.05] text-amber-200" : "border-slate-800 bg-slate-900/40 text-slate-300"}`}>
          {summary.line ?? "No crew state declared yet."}
          {summary.stale && summary.staleHours !== null && <span className="text-amber-400"> · last updated {summary.staleHours >= 48 ? `${Math.round(summary.staleHours / 24)}d` : `${Math.round(summary.staleHours)}h`} ago — confirm</span>}
          {headline && <span className="block text-[10px] text-slate-500 mt-0.5">{headline}</span>}
        </div>
      )}

      {summary && summary.rows.length === 0 && !editing && (
        <button type="button" onClick={seed} disabled={busy} className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 mb-3">
          Seed IP / AC / FP / LM rows
        </button>
      )}

      {summary && summary.rows.length > 0 && (
        <table className="w-full text-[11px] mb-2">
          <thead>
            <tr className="text-[9px] uppercase tracking-wider text-slate-600 text-left">
              <th className="py-1 pr-2">Qual</th><th className="py-1 pr-2 text-right">Avail</th><th className="py-1 pr-2 text-right">Total</th>
              <th className="py-1 pr-2 text-right">Rest</th><th className="py-1 pr-2 text-right">Msn</th><th className="py-1 pr-2 text-right">DNIF</th><th className="py-1 pr-2 text-right">Other</th><th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.qual} className={`border-t border-slate-800/60 ${r.invalid ? "bg-red-500/[0.06]" : ""}`}>
                <td className="py-1.5 pr-2">
                  <span className="font-mono font-bold text-slate-200">{r.qual}</span>
                  <span className="block text-[9.5px] text-slate-500 truncate max-w-[160px]">{r.label}{r.updatedBy ? ` · ${r.updatedBy.split("@")[0]} ${ago(r.updatedAt)}` : ""}</span>
                </td>
                <td className={`py-1.5 pr-2 text-right font-mono font-bold ${r.invalid ? "text-red-300" : r.fraction !== null && r.fraction < 0.5 ? "text-amber-300" : "text-emerald-300"}`}>{r.invalid ? "✗" : r.available}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-300">{r.total}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-400">{r.crewRest}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-400">{r.onMission}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-400">{r.dnif}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-slate-400">{r.other}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => setEditing(toDraft(r))} className="text-[10px] text-slate-400 hover:text-emerald-300 mr-2">edit</button>
                  <button type="button" onClick={() => remove(r.qual)} disabled={busy} className="text-[10px] text-slate-600 hover:text-red-300" aria-label={`Remove ${r.qual}`}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!editing ? (
        <button type="button" onClick={() => setEditing({ qual: "", label: "", total: "0", crewRest: "0", onMission: "0", dnif: "0", other: "0", note: "" })}
          className="text-[11px] text-slate-400 hover:text-emerald-300">＋ Add qualification level</button>
      ) : (
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[9px] uppercase tracking-wider text-slate-500">Qual (key)</span>
              <input value={editing.qual} onChange={(e) => setEditing({ ...editing, qual: e.target.value })} placeholder="AC" maxLength={32}
                className="w-full bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 font-mono" />
            </label>
            <label className="block">
              <span className="block text-[9px] uppercase tracking-wider text-slate-500">Label</span>
              <input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="Aircraft commander" maxLength={80}
                className="w-full bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100" />
            </label>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {num("total", "Total")}{num("crewRest", "Crew rest")}{num("onMission", "On mission")}{num("dnif", "DNIF")}{num("other", "Other")}
          </div>
          <label className="block">
            <span className="block text-[9px] uppercase tracking-wider text-slate-500">Note (optional)</span>
            <input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} maxLength={200}
              className="w-full bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy || !editing.qual.trim()} className="text-xs px-3 py-1.5 rounded-md bg-emerald-600/80 hover:bg-emerald-600 text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => setEditing(null)} className="text-xs px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
