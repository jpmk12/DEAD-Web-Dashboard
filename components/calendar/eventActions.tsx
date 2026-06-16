"use client";

import { useState } from "react";
import type { CalendarEvent } from "@/lib/types";

// Shared per-event quick actions (delete / AI-edit / nudge / inline edit), used
// by both the Calendar upcoming view and the Glance Today/Tomorrow rows so they
// stay in sync. Recurring events get a "this occurrence vs whole series" choice:
// the choice is just which id we target — the instance id (event.id) or the
// series base (event.recurringEventId) — so the PATCH/DELETE route is unchanged.

const pad2 = (n: number) => String(n).padStart(2, "0");
// Shift a floating YYYY-MM-DD (all-day events) by N days without tz drift.
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
function daysBetweenYmd(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function useEventActions(event: CalendarEvent) {
  const [mode, setMode] = useState<"idle" | "edit" | "confirmDelete">("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [eTitle, setETitle] = useState(event.title);
  const [eDate, setEDate] = useState("");
  const [eTime, setETime] = useState("");
  const [scope, setScope] = useState<"this" | "all">("this");
  const isRecurring = !!event.recurringEventId;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // All mutations hit PATCH/DELETE then fire calendar:changed (the panel listens
  // and refetches). `useAll` targets the series base id instead of this instance.
  const apply = async (method: "PATCH" | "DELETE", body: Record<string, unknown>, useAll = false) => {
    setBusy(true); setErr(null);
    const eventId = useAll && event.recurringEventId ? event.recurringEventId : event.id;
    try {
      const res = await fetch("/api/calendar/events", {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, calendarId: event.calendarId, ...body }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error === "reauth_required" ? "Calendar permission needed — sign out and back in." : (d.error ?? "Update failed"));
      setMode("idle");
      window.dispatchEvent(new Event("calendar:changed"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  // Quick nudge keeps the duration and always applies to THIS occurrence — a
  // one-tap "it slipped"; whole-series time shifts belong in the edit panel.
  const nudge = (e: React.MouseEvent, days: number, hours = 0) => {
    stop(e);
    if (event.isAllDay) {
      apply("PATCH", { start: shiftYmd(event.start, days), end: shiftYmd(event.end || event.start, days) });
    } else {
      const delta = (days * 24 + hours) * 3_600_000;
      apply("PATCH", { start: new Date(Date.parse(event.start) + delta).toISOString(), end: new Date(Date.parse(event.end) + delta).toISOString() });
    }
  };

  const openEdit = (e: React.MouseEvent) => {
    stop(e);
    const d = new Date(event.start);
    setETitle(event.title);
    setEDate(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
    setETime(event.isAllDay ? "" : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
    setScope("this"); setErr(null); setMode("edit");
  };

  const saveEdit = (e: React.MouseEvent) => {
    stop(e);
    const body: Record<string, unknown> = {};
    if (eTitle.trim() && eTitle.trim() !== event.title) body.summary = eTitle.trim();
    if (eDate) {
      if (event.isAllDay) {
        const shift = daysBetweenYmd(event.start, eDate);
        if (shift !== 0) { body.start = eDate; body.end = shiftYmd(event.end || event.start, shift); }
      } else {
        const [y, mo, da] = eDate.split("-").map(Number);
        const [h, mi] = eTime.split(":").map(Number);
        if ([y, mo, da, h, mi].every(Number.isFinite)) {
          const ns = new Date(y, mo - 1, da, h, mi);
          const dur = Date.parse(event.end) - Date.parse(event.start);
          body.start = ns.toISOString();
          body.end = new Date(ns.getTime() + (Number.isFinite(dur) ? dur : 3_600_000)).toISOString();
        }
      }
    }
    if (!body.start && !body.summary) { setMode("idle"); return; }
    apply("PATCH", body, scope === "all");
  };

  const del = (e: React.MouseEvent, useAll = false) => { stop(e); apply("DELETE", {}, useAll); };

  // Edit-with-AI: open the assistant seeded to PROPOSE conflict-free options for
  // this event; the user picks one and confirms the move there.
  const askAI = (e: React.MouseEvent) => {
    stop(e);
    const when = event.isAllDay
      ? new Date(`${event.start.slice(0, 10)}T00:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      : new Date(event.start).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const loc = event.location ? ` @ ${event.location}` : "";
    const series = isRecurring ? " (a recurring event — say whether to move just this one or the whole series)" : "";
    const prompt = `Suggest 2–3 good alternative times to reschedule "${event.title}" (currently ${when}${loc})${series}. Pick conflict-free slots from my calendar, then I'll choose one and you can move it.`;
    window.dispatchEvent(new CustomEvent("assistant:open", { detail: { prompt } }));
  };

  return { mode, setMode, busy, err, eTitle, setETitle, eDate, setEDate, eTime, setETime, scope, setScope, isRecurring, isAllDay: event.isAllDay, stop, nudge, openEdit, saveEdit, del, askAI };
}

type Actions = ReturnType<typeof useEventActions>;

const btn = "text-slate-600 hover:text-slate-200 transition-colors px-1 py-0.5 rounded text-[11px] leading-none disabled:opacity-40";

// The inline icon cluster. Place it where it fits the row (right side).
export function EventActionCluster({ a }: { a: Actions }) {
  return (
    <div className="flex items-center gap-0.5 flex-shrink-0" onClick={a.stop}>
      <button onClick={a.askAI} disabled={a.busy} title="Edit with AI — suggest a better time" className={btn}>✦</button>
      <button onClick={a.openEdit} disabled={a.busy} title="Edit date / time / title" className={btn}>✎</button>
      <button onClick={(e) => a.nudge(e, 1)} disabled={a.busy} title="Move to next day (same time)" className={`${btn} font-mono`}>+1d</button>
      <button onClick={(e) => a.nudge(e, 7)} disabled={a.busy} title="Move one week later" className={`${btn} font-mono`}>+1w</button>
      <button onClick={(e) => { a.stop(e); a.setMode("confirmDelete"); }} disabled={a.busy} title="Delete event" className={`${btn} hover:text-red-400`}>🗑</button>
    </div>
  );
}

// The confirm/edit panels + error — render full-width below the row.
export function EventActionPanels({ a }: { a: Actions }) {
  return (
    <>
      {a.mode === "confirmDelete" && (
        <div className="mt-1.5 flex items-center flex-wrap gap-2 text-[11px]" onClick={a.stop}>
          <span className="text-red-400">{a.isRecurring ? "Delete which?" : "Delete this event?"}</span>
          {a.isRecurring ? (
            <>
              <button onClick={(e) => a.del(e, false)} disabled={a.busy} className="font-bold text-red-400 hover:text-red-300 disabled:opacity-40">{a.busy ? "…" : "This event"}</button>
              <button onClick={(e) => a.del(e, true)} disabled={a.busy} className="font-bold text-red-400 hover:text-red-300 disabled:opacity-40">All events</button>
            </>
          ) : (
            <button onClick={(e) => a.del(e, false)} disabled={a.busy} className="font-bold text-red-400 hover:text-red-300 disabled:opacity-40">{a.busy ? "Deleting…" : "✓ Delete"}</button>
          )}
          <button onClick={() => a.setMode("idle")} className="text-slate-500 hover:text-slate-300">✕ Cancel</button>
        </div>
      )}

      {a.mode === "edit" && (
        <div className="mt-2 space-y-2 bg-slate-900/60 border border-slate-700/60 rounded-md p-2" onClick={a.stop}>
          <input value={a.eTitle} onChange={(e) => a.setETitle(e.target.value)} placeholder="Title" className="w-full bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-slate-500" />
          <div className="flex items-center gap-2 flex-wrap">
            <input type="date" value={a.eDate} onChange={(e) => a.setEDate(e.target.value)} className="bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-500" />
            {!a.isAllDay && (
              <input type="time" value={a.eTime} onChange={(e) => a.setETime(e.target.value)} className="bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-500" />
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button onClick={a.saveEdit} disabled={a.busy} className="px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40">{a.busy ? "Saving…" : "Save"}</button>
              <button onClick={() => a.setMode("idle")} className="text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>
            </div>
          </div>
          {a.isRecurring && (
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="uppercase tracking-wider">Apply to</span>
              <button onClick={() => a.setScope("this")} className={`px-1.5 py-0.5 rounded border ${a.scope === "this" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>This event</button>
              <button onClick={() => a.setScope("all")} className={`px-1.5 py-0.5 rounded border ${a.scope === "all" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>All events</button>
            </div>
          )}
        </div>
      )}

      {a.err && <p className="text-[11px] text-red-400 mt-1" onClick={a.stop}>{a.err}</p>}
    </>
  );
}
