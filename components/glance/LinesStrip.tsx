"use client";

// Lines — the next four days of declared flying, read against what the app
// already knows about each field (docs/PLAN-MISSION-OBJECT.md §5). A line is
// a day, an airframe, the fields and a status — nothing finer, by the
// operator's decision; the editor's validator is the same PURE one the
// route runs. Colour on a row is EARNED by the fields' own readings; a line
// never changes a level, and UNKNOWN (no SITREP slot, a dead feed) is its own
// value, never folded into green.

import { openTrackPicker } from "@/lib/trackClient";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/feedback";
import { LED_CLASS, type LedKey } from "@/lib/levelTokens";
import {
  LINE_AIRFRAMES, LINE_STATUSES, LINE_STATUS_LABEL, LINE_HORIZON_DAYS, lineDayLabel, parseFieldsText, todayZulu,
  validateLineDraft, type LineAirframe, type LineStatus, type MissionLine,
} from "@/lib/missionLines";
import type { LineRead, LineDriver } from "@/lib/lineRead";

interface Body { today: string; lastDay: string; lines: MissionLine[] | null; reads: LineRead[]; unavailable: string[]; atISO: string }

const TONE: Record<LedKey, string> = {
  r: "border-red-500/45 bg-red-500/[0.06]",
  a: "border-amber-500/40 bg-amber-500/[0.05]",
  u: "border-slate-700 bg-slate-800/30",
  g: "border-slate-800 bg-slate-900/40",
};
const WORD: Record<LedKey, string> = { r: "RED", a: "AMBER", u: "UNKNOWN", g: "quiet" };

function openField(icao: string, hasSlot: boolean) {
  // No SITREP slot → the ONE Track door (the picker lives in TabShell, so
  // nothing navigates); a slot → the field's room on the command board.
  if (!hasSlot) { openTrackPicker({ kind: "airfield", icao }); return; }
  window.dispatchEvent(new CustomEvent("app:navigate", { detail: "osint" }));
  setTimeout(() => window.dispatchEvent(new CustomEvent("watch:focus", { detail: { kind: "sitrep", id: icao } })), 150);
}

export default function LinesStrip({ active = true }: { active?: boolean }) {
  const [body, setBody] = useState<Body | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "unavailable" | "error">("loading");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    try {
      const r = await fetch(`/api/mission-lines?read=1${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as Body | null;
      if (!j) { setStatus("error"); return; }
      setBody(j);
      setStatus(j.lines === null ? "unavailable" : "ok");
    } catch { setStatus("error"); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!active) return;
    const onChanged = () => load(true);
    window.addEventListener("lines:changed", onChanged);
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 5 * 60_000);
    return () => { window.removeEventListener("lines:changed", onChanged); clearInterval(t); };
  }, [active, load]);

  const post = async (payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await fetch("/api/mission-lines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => null);
      if (!r.ok) { toast.error("Line not saved", j?.error || `HTTP ${r.status}`); return false; }
      if (Array.isArray(j?.unresolved) && j.unresolved.length) toast.info("Saved — field not placed", `${j.unresolved.join(", ")}: the app cannot place this ICAO; it reads UNKNOWN on the line.`);
      window.dispatchEvent(new CustomEvent("lines:changed"));
      return true;
    } catch (e) { toast.error("Line not saved", e instanceof Error ? e.message : "Request failed"); return false; }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/mission-lines?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json().catch(() => null); toast.error("Line not removed", j?.error || `HTTP ${r.status}`); return; }
      window.dispatchEvent(new CustomEvent("lines:changed"));
    } finally { setBusy(false); }
  };

  const reads = body?.reads ?? [];
  const lineOf = (id: string) => body?.lines?.find((l) => l.id === id);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 bg-slate-800/30">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Lines · next {LINE_HORIZON_DAYS} days</h3>
          {status === "unavailable" && <span className="text-[8px] font-bold uppercase tracking-wider px-1 rounded border text-amber-300 border-amber-500/45 bg-amber-500/10" title="The lines store did not answer — there may be lines you cannot see">unavailable</span>}
          {status === "ok" && body?.unavailable.length ? <span className="text-[9px] text-amber-300/90" title="A dead source reads UNKNOWN on every line, never clear">{body.unavailable.join(" · ")} UNAVAILABLE</span> : null}
        </div>
        <button onClick={() => setAdding((v) => !v)} aria-expanded={adding} className="text-[10px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-300 hover:text-violet-200 hover:border-violet-500/40">＋ Line</button>
      </div>
      <div className="p-3 space-y-2">
        {adding && <LineForm today={body?.today ?? todayZulu()} busy={busy} onCancel={() => setAdding(false)} onSave={async (d) => { const ok = await post(d); if (ok) setAdding(false); }} />}
        {status === "loading" && <p className="text-[11px] text-slate-500">Reading the lines…</p>}
        {status === "error" && <p className="text-[11px] text-red-400">Could not read the lines (the reply was not JSON — sign in again?).</p>}
        {status === "unavailable" && <p className="text-[11px] text-amber-300/90 leading-snug">Lines UNAVAILABLE — the store did not answer. There may be lines you cannot see; this is not “no lines”.</p>}
        {status === "ok" && reads.length === 0 && !adding && (
          <p className="text-[11px] text-slate-500 leading-snug">No lines declared for the next {LINE_HORIZON_DAYS} days. ＋ Line — a day, an airframe, the fields. Nothing else goes in: no tails, callsigns, loads or times.</p>
        )}
        {reads.map((r) => {
          const l = lineOf(r.id);
          const isOpen = open === r.id;
          const lead = r.drivers[0];
          return (
            <div key={r.id} className={`rounded-md border ${TONE[r.worst]} transition-colors`}>
              <div className="flex items-center gap-2 px-2.5 py-1.5 flex-wrap">
                <button onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${LED_CLASS[r.worst]}`} title={`line read: ${WORD[r.worst]}`} />
                  <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">{r.dayLabel}</span>
                  <span className="text-[10px] font-bold font-mono px-1 rounded border border-slate-700 text-slate-200 flex-shrink-0">{r.airframe}</span>
                  <span className="flex items-center gap-1 flex-wrap">
                    {r.perField.map((f, i) => (
                      <span key={`${f.icao}-${i}`} className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-200" title={f.drivers.map((d) => d.text).join(" · ") || "quiet"}>
                        {i > 0 && <span className="text-slate-600">→</span>}
                        <span className={`w-1.5 h-1.5 rounded-full ${LED_CLASS[f.worst]}`} />{f.icao}
                      </span>
                    ))}
                  </span>
                  <span className="text-[10px] text-slate-500 truncate min-w-0 hidden sm:inline">{lead && r.worst !== "g" ? `${lead.icao}: ${lead.text}` : "quiet — absence of signal, not evidence of calm"}</span>
                  <span className="ml-auto text-[10px] text-slate-600">{isOpen ? "▴" : "▾"}</span>
                </button>
                {l && (
                  <>
                    <button disabled={busy} onClick={() => post({ id: l.id, day: l.day, airframe: l.airframe, fields: l.fields, status: l.status === "planned" ? "execution" : "planned" })} title="Toggle planned / execution" className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${l.status === "execution" ? "text-violet-200 border-violet-500/45 bg-violet-500/10" : "text-slate-400 border-slate-700"}`}>{LINE_STATUS_LABEL[l.status]}</button>
                    <button disabled={busy} onClick={() => remove(l.id)} title="Remove this line" aria-label={`Remove line ${r.label}`} className="w-6 h-6 rounded text-slate-500 hover:text-red-300 hover:bg-red-500/10 text-xs">✕</button>
                  </>
                )}
              </div>
              {isOpen && (
                <div className="px-2.5 pb-2 border-t border-slate-800/80 pt-2 space-y-1.5">
                  <p className="text-[10px] text-slate-400 leading-snug">{r.summary}</p>
                  {r.outlook && r.outlook.length > 0 && (
                    <p className="text-[10px] text-slate-500 leading-snug" title="The command's 7-day demand outlook, as context on the line — never a driver of its read">
                      entering {r.outlook.map((o) => `${o.aor} — demand ${o.direction === "rise" ? "likely to RISE" : o.direction === "fall" ? "likely to fall" : "holding"}`).join(" · ")} <span className="text-slate-600">(7-day outlook, context not a driver)</span>
                    </p>
                  )}
                  {r.perField.map((f, i) => (
                    <div key={`${f.icao}-${i}`} className="text-[10px] leading-snug">
                      <button onClick={() => openField(f.icao, f.sitrepSlot)} className="font-mono font-bold text-slate-200 hover:text-sky-300">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${LED_CLASS[f.worst]}`} />{f.icao}
                      </button>
                      {f.leds && <span className="ml-2 text-slate-500">wx {f.leds.wx} · ops {f.leds.ops} · threat {f.leds.threat} · infra {f.leds.infra} · spc {f.leds.spectrum}</span>}
                      {f.drivers.length ? (
                        <ul className="ml-3 mt-0.5 space-y-0.5">{f.drivers.map((d: LineDriver, j) => <li key={j} className={d.level === "r" ? "text-red-300" : d.level === "a" ? "text-amber-300" : "text-slate-400"}>{d.text}</li>)}</ul>
                      ) : <span className="ml-2 text-slate-500">quiet</span>}
                    </div>
                  ))}
                  <p className="text-[9px] text-slate-600">{l ? `declared by ${l.updatedBy.split("@")[0] || "crew"}` : ""} · planning-grade · a line never changes a level</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LineForm({ today, busy, onSave, onCancel }: { today: string; busy: boolean; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [day, setDay] = useState(today);
  const [airframe, setAirframe] = useState<LineAirframe>("C-17");
  const [fields, setFields] = useState("");
  const [lineStatus, setLineStatus] = useState<LineStatus>("planned");
  const [err, setErr] = useState<string | null>(null);
  const draft = { day, airframe, fields: parseFieldsText(fields), status: lineStatus };
  const liveErr = fields.trim() ? validateLineDraft(draft, { nowMs: Date.now() }) : null;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const v = validateLineDraft(draft, { nowMs: Date.now() }); if (v) { setErr(v); return; } setErr(null); await onSave(draft); }} className="rounded-md border border-violet-500/30 bg-violet-500/[0.04] p-2.5 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[9px] uppercase tracking-wider text-slate-500 flex flex-col gap-0.5">Day (Zulu)
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200" />
        </label>
        <label className="text-[9px] uppercase tracking-wider text-slate-500 flex flex-col gap-0.5">Airframe
          <select value={airframe} onChange={(e) => setAirframe(e.target.value as LineAirframe)} className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200">
            {LINE_AIRFRAMES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-[9px] uppercase tracking-wider text-slate-500 flex flex-col gap-0.5 min-w-[200px] flex-1">Fields (ICAO, in order)
          <input value={fields} onChange={(e) => setFields(e.target.value)} placeholder="OJAQ OTBH" autoCapitalize="characters" className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] font-mono text-slate-200" />
        </label>
        <label className="text-[9px] uppercase tracking-wider text-slate-500 flex flex-col gap-0.5">Status
          <select value={lineStatus} onChange={(e) => setLineStatus(e.target.value as LineStatus)} className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200">
            {LINE_STATUSES.map((s) => <option key={s} value={s}>{LINE_STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || !!liveErr || !fields.trim()} className="text-[10px] font-bold uppercase tracking-wider rounded px-2.5 py-1.5 border border-violet-500/45 text-violet-200 bg-violet-500/10 disabled:opacity-40">Save line</button>
        <button type="button" onClick={onCancel} className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 px-1">cancel</button>
      </div>
      {(err || liveErr) && <p className="text-[10px] text-amber-300">{err || liveErr}</p>}
      <p className="text-[9px] text-slate-500">{lineDayLabel(day || today)} · a day, an airframe, the fields and a status — nothing finer. Shared with the crew.</p>
    </form>
  );
}
