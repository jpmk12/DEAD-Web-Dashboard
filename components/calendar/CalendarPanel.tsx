"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { format, parseISO } from "date-fns";
import { CalendarEvent } from "@/lib/types";
import { Calendar } from "@/lib/icons";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import SignInButton from "./SignInButton";

const CACHE_KEY = "calendar:events";

interface CalendarPanelProps {
  onEventsLoaded: (events: CalendarEvent[]) => void;
}

function groupByDate(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = e.start.substring(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function getDayLabel(dateStr: string): { primary: string; secondary: string; isToday: boolean } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);

  if (diff === 0) return { primary: "Today", secondary: format(date, "EEEE, MMMM d"), isToday: true };
  if (diff === 1) return { primary: "Tomorrow", secondary: format(date, "EEEE, MMMM d"), isToday: false };
  if (diff < 7) return { primary: format(date, "EEEE"), secondary: format(date, "MMMM d"), isToday: false };
  return { primary: format(date, "EEE, MMM d"), secondary: format(date, "yyyy"), isToday: false };
}

function formatEventTime(event: CalendarEvent): string {
  if (event.isAllDay) return "All Day";
  try {
    const start = format(parseISO(event.start), "h:mm a");
    const end = format(parseISO(event.end), "h:mm a");
    return `${start} – ${end}`;
  } catch {
    return "";
  }
}

interface PrepMail {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}
interface PrepBlock {
  email: string;
  mails: PrepMail[];
}

function formatPrepDate(raw: string): string {
  try {
    return new Date(raw).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}

function parsePrepSender(from: string): string {
  const m = from.match(/^(.+?)\s*<.+?>$/);
  return (m ? m[1] : from).replace(/"/g, "").trim();
}

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

function AgendaEvent({ event }: { event: CalendarEvent }) {
  const [expanded, setExpanded] = useState(false);
  const time = formatEventTime(event);
  const hasDetails = !!(event.location || event.description);
  const hasAttendees = !!event.attendees && event.attendees.length > 0;

  // Meeting-prep state: lazy-loaded when the user clicks "Prep".
  const [prepState, setPrepState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [prepBlocks, setPrepBlocks] = useState<PrepBlock[]>([]);

  const fetchPrep = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (prepState === "loading" || prepState === "done") return;
    setPrepState("loading");
    try {
      const res = await fetch("/api/meeting-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendees: event.attendees ?? [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setPrepBlocks(Array.isArray(data.attendees) ? data.attendees : []);
      setPrepState("done");
    } catch {
      setPrepState("error");
    }
  };

  const isExpandable = hasDetails || hasAttendees;

  // Quick-action state: inline edit / delete-confirm, plus an in-row error.
  const [mode, setMode] = useState<"idle" | "edit" | "confirmDelete">("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [eTitle, setETitle] = useState(event.title);
  const [eDate, setEDate] = useState("");
  const [eTime, setETime] = useState("");

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  // All mutations go through PATCH/DELETE then fire calendar:changed, which the
  // panel listens for and refetches.
  const apply = async (method: "PATCH" | "DELETE", body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/calendar/events", {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, calendarId: event.calendarId, ...body }),
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

  // Instant nudge — keeps the duration; works for timed (ms shift) and all-day
  // (whole-day shift) events.
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
    setErr(null); setMode("edit");
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
    apply("PATCH", body);
  };

  // Edit-with-AI: open the assistant seeded to PROPOSE conflict-free options for
  // this event; the user picks one and confirms the move there.
  const askAI = (e: React.MouseEvent) => {
    stop(e);
    const when = event.isAllDay
      ? new Date(`${event.start.slice(0, 10)}T00:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      : new Date(event.start).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const loc = event.location ? ` @ ${event.location}` : "";
    const prompt = `Suggest 2–3 good alternative times to reschedule "${event.title}" (currently ${when}${loc}). Pick conflict-free slots from my calendar, then I'll choose one and you can move it.`;
    window.dispatchEvent(new CustomEvent("assistant:open", { detail: { prompt } }));
  };

  const btn = "text-slate-600 hover:text-slate-200 transition-colors px-1 py-0.5 rounded text-[11px] leading-none disabled:opacity-40";

  return (
    <div
      className={`flex gap-3 py-2.5 border-b border-slate-800/60 last:border-0 group ${
        isExpandable ? "cursor-pointer select-none" : ""
      }`}
      onClick={() => isExpandable && setExpanded((v) => !v)}
    >
      {/* Time column */}
      <div className="w-28 flex-shrink-0 text-right pt-0.5">
        {event.isAllDay ? (
          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">
            All Day
          </span>
        ) : (
          <span className="text-xs font-mono text-emerald-400/80">{time}</span>
        )}
      </div>

      {/* Event details */}
      <div className="flex-1 min-w-0 pl-3 border-l border-slate-700/60">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-medium text-slate-200 leading-tight group-hover:text-white transition-colors">
            {event.title}
          </p>
          {/* Quick actions — muted, brighten on hover; always tappable (mobile). */}
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" onClick={stop}>
            <button onClick={askAI} disabled={busy} title="Edit with AI — suggest a better time" className={btn}>✦</button>
            <button onClick={openEdit} disabled={busy} title="Edit date / time / title" className={btn}>✎</button>
            <button onClick={(e) => nudge(e, 1)} disabled={busy} title="Move to next day (same time)" className={`${btn} font-mono`}>+1d</button>
            <button onClick={(e) => nudge(e, 7)} disabled={busy} title="Move one week later" className={`${btn} font-mono`}>+1w</button>
            <button onClick={(e) => { stop(e); setErr(null); setMode("confirmDelete"); }} disabled={busy} title="Delete event" className={`${btn} hover:text-red-400`}>🗑</button>
            {isExpandable && <span className="text-slate-600 text-[10px] mt-0.5 ml-0.5">{expanded ? "▲" : "▼"}</span>}
          </div>
        </div>

        {/* Inline delete confirm — deliberate two-tap, never an accidental wipe. */}
        {mode === "confirmDelete" && (
          <div className="mt-1.5 flex items-center gap-2 text-[11px]" onClick={stop}>
            <span className="text-red-400">Delete this event?</span>
            <button onClick={() => apply("DELETE", {})} disabled={busy} className="font-bold text-red-400 hover:text-red-300 disabled:opacity-40">{busy ? "Deleting…" : "✓ Delete"}</button>
            <button onClick={() => setMode("idle")} className="text-slate-500 hover:text-slate-300">✕ Cancel</button>
          </div>
        )}

        {/* Inline manual edit — title + date (+ time for timed events). */}
        {mode === "edit" && (
          <div className="mt-2 space-y-2 bg-slate-900/60 border border-slate-700/60 rounded-md p-2" onClick={stop}>
            <input value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="Title" className="w-full bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-slate-500" />
            <div className="flex items-center gap-2 flex-wrap">
              <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} className="bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-500" />
              {!event.isAllDay && (
                <input type="time" value={eTime} onChange={(e) => setETime(e.target.value)} className="bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-500" />
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={saveEdit} disabled={busy} className="px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
                <button onClick={() => setMode("idle")} className="text-[11px] text-slate-500 hover:text-slate-300">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {err && <p className="text-[11px] text-red-400 mt-1" onClick={stop}>{err}</p>}

        {/* Collapsed: show location preview only */}
        {!expanded && event.location && (
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            📍 {event.location}
          </p>
        )}

        {/* Expanded: full location + description + account */}
        {expanded && (
          <div className="mt-2 space-y-2">
            {event.location && (
              <div className="flex items-start gap-1.5">
                <span className="text-slate-500 text-xs flex-shrink-0 mt-px">📍</span>
                <p className="text-xs text-slate-400 leading-relaxed">{event.location}</p>
              </div>
            )}
            {event.description && (
              <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-line pl-2 border-l-2 border-slate-700">
                {event.description}
              </p>
            )}
            {event.account && (
              <p className="text-[10px] font-mono text-slate-600">{event.account}</p>
            )}

            {/* Attendees + meeting-prep loader */}
            {hasAttendees && (
              <div className="pt-1.5 mt-1.5 border-t border-slate-800/80">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-[10px] font-mono text-slate-500 truncate">
                    👤 {event.attendees!.join(", ")}
                  </p>
                  {prepState !== "done" && (
                    <button
                      onClick={fetchPrep}
                      disabled={prepState === "loading"}
                      title="Pull recent emails from attendees"
                      className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 px-2 py-0.5 rounded-md transition-all disabled:opacity-40"
                    >
                      {prepState === "loading" ? "…" : prepState === "error" ? "Retry" : "📋 Prep"}
                    </button>
                  )}
                </div>

                {prepState === "done" && prepBlocks.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {prepBlocks.map((block) => (
                      <div key={block.email} className="bg-slate-900/60 border border-slate-800 rounded-md p-2">
                        <p className="text-[10px] font-mono text-slate-500 mb-1.5">{block.email}</p>
                        {block.mails.length === 0 ? (
                          <p className="text-[10px] text-slate-600 italic">No recent mail in last 60 days.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {block.mails.map((m) => (
                              <li key={m.id} className="text-[11px] leading-snug">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-slate-300 font-medium truncate">{m.subject || "(no subject)"}</span>
                                  <span className="text-slate-600 font-mono text-[9px] flex-shrink-0">{formatPrepDate(m.date)}</span>
                                </div>
                                <p className="text-slate-500 text-[10px] truncate">{parsePrepSender(m.from)}: {m.snippet}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {prepState === "done" && prepBlocks.every((b) => b.mails.length === 0) && (
                  <p className="text-[10px] text-slate-600 italic mt-1">No recent mail found for any attendee.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Account label when collapsed */}
        {!expanded && event.account && (
          <p className="text-[10px] font-mono text-slate-700 mt-0.5">{event.account}</p>
        )}
      </div>
    </div>
  );
}

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function CalendarPanel({ onEventsLoaded }: CalendarPanelProps) {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [secondaryEmail, setSecondaryEmail] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const onEventsLoadedRef = useRef(onEventsLoaded);
  useEffect(() => { onEventsLoadedRef.current = onEventsLoaded; });

  // The assistant fires `calendar:changed` after it moves/edits/deletes an
  // event; refetch so the calendar (and the context the assistant sees next)
  // reflect the change instead of showing the stale time.
  useEffect(() => {
    const onChanged = () => setRefreshKey((k) => k + 1);
    window.addEventListener("calendar:changed", onChanged);
    return () => window.removeEventListener("calendar:changed", onChanged);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;

    const isManualRefresh = refreshKey > 0;
    const stale = clientCache.peek<CalendarEvent[]>(CACHE_KEY);
    const isFresh = clientCache.isFresh(CACHE_KEY);

    if (stale) { setEvents(stale); onEventsLoadedRef.current(stale); }
    if (isFresh && !isManualRefresh) return;

    const showSpinner = !stale || isManualRefresh;
    if (showSpinner) setLoading(true);

    const controller = new AbortController();
    fetch("/api/calendar", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        const evts: CalendarEvent[] = data.events ?? [];
        setEvents(evts);
        onEventsLoadedRef.current(evts);
        clientCache.set(CACHE_KEY, evts, CACHE_TTL.CALENDAR);
        setLastUpdated(new Date());
        if (data.secondaryError) {
          setSecondaryError(data.secondaryError);
          setSecondaryEmail(data.secondaryEmail);
        }
      })
      .catch((e) => { if (e.name !== "AbortError") setError("Failed to load calendar events."); })
      .finally(() => { if (showSpinner) setLoading(false); });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, refreshKey]);

  if (status === "loading") {
    return (
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 animate-pulse space-y-4">
        <div className="h-3 bg-slate-800 rounded w-32" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <div className="h-2.5 bg-slate-800 rounded w-20" />
            <div className="h-10 bg-slate-800/60 rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="bg-slate-900 rounded-xl border border-slate-800">
        <SignInButton />
      </div>
    );
  }

  const groups = groupByDate(events);

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80">
        <div className="flex items-center gap-2">
          <Calendar size={14} strokeWidth={2.25} className="text-emerald-400" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">Upcoming</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600 font-mono">{session?.user?.email}</span>
          {lastUpdated && !loading && (
            <span className="text-[10px] text-slate-700 font-mono">{formatUpdated(lastUpdated)}</span>
          )}
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 disabled:opacity-40 font-mono transition-colors"
          >
            <span className={`text-base leading-none ${loading ? "animate-spin" : ""}`}>↻</span>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Secondary account reconnect banner */}
      {secondaryError && (
        <div className="mx-4 mt-3 bg-amber-950/60 border border-amber-700/40 text-amber-400 rounded-lg p-3 text-xs flex items-start gap-2">
          <span className="flex-shrink-0 mt-px">⚠</span>
          <div>
            {secondaryError === "scope_error" ? (
              <>
                <span className="font-semibold">
                  {secondaryEmail || "Secondary account"} needs calendar access.
                </span>{" "}
                Go to the <strong>Email</strong> tab, remove the second account, then reconnect it to grant calendar permissions.
              </>
            ) : (
              <>
                Could not load events from{" "}
                <span className="font-semibold">{secondaryEmail || "secondary account"}</span>.
              </>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="overflow-y-auto max-h-[calc(100vh-220px)]">
        {loading && (
          <div className="p-5 space-y-4 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-2.5 bg-slate-800 rounded w-20" />
                <div className="h-10 bg-slate-800/60 rounded-lg" />
                <div className="h-10 bg-slate-800/60 rounded-lg" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="m-4 bg-red-950 border border-red-900 text-red-400 rounded-lg p-3 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <p className="text-sm text-slate-600 text-center py-16 font-mono uppercase tracking-wider">
            No upcoming events
          </p>
        )}

        {!loading && !error && groups.map(([dateKey, dayEvents]) => {
          const { primary, secondary, isToday } = getDayLabel(dateKey);
          return (
            <div key={dateKey} className="border-b border-slate-800/60 last:border-0">
              {/* Date header */}
              <div className={`flex items-baseline gap-2.5 px-5 py-2.5 sticky top-0 z-10 ${
                isToday
                  ? "bg-emerald-500/10 border-b border-emerald-500/20"
                  : "bg-slate-900/95 border-b border-slate-800/40"
              }`}>
                <span className={`text-sm font-bold ${isToday ? "text-emerald-400" : "text-slate-300"}`}>
                  {primary}
                </span>
                <span className={`text-[11px] font-mono ${isToday ? "text-emerald-600" : "text-slate-600"}`}>
                  {secondary}
                </span>
                {isToday && (
                  <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-emerald-500 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    Today
                  </span>
                )}
              </div>

              {/* Events for this day */}
              <div className="px-5">
                {dayEvents.map((event) => (
                  <AgendaEvent key={event.id} event={event} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
