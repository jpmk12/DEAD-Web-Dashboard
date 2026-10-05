"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { format } from "date-fns";
import { CalendarEvent } from "@/lib/types";
import { Calendar } from "@/lib/icons";
import { clientCache, CACHE_TTL } from "@/lib/clientCache";
import SignInButton from "./SignInButton";
import { useEventActions, EventActionCluster, EventActionPanels } from "./eventActions";
import { familyDatesByDay, FAMILY_DATE_GLYPH, type FamilyDate } from "@/lib/familyCalendar";
import type { EffectiveZone } from "@/lib/zoneClient";
import { ymdInZone, addDays, timeInZone, zoneLabel } from "@/lib/effectiveZone";
import { agendaFamilyDates, tripChipFor, todayCounts, type DontMissRow } from "@/lib/calendarDontMiss";
import { senderShort, type MailDate } from "@/lib/mailDates";
import { gmailMessageUrl } from "@/lib/gmailLink";
import type { DontMissHandlers, MailDateHandlers } from "./CalendarTab";

// The Calendar's left column (REVIEW-2026-10 §3): a Today strip in the
// effective zone, the Don't-miss list, the dates found in mail, then the
// agenda — which starts TODAY (late items live in Don't miss, not under
// past day headers), buckets and labels times in the effective zone, shows
// a TDY chip on days inside a trip, and renders family dates as a quieter
// dashed register under the day's events, deduplicated.

const CACHE_KEY = "calendar:events";
/** Family dates shown on the agenda this far ahead; the Family tab has the rest. */
const AGENDA_FAMILY_HORIZON_DAYS = 45;

interface CalendarPanelProps {
  onEventsLoaded: (events: CalendarEvent[]) => void;
  refreshKey: number;
  zone: EffectiveZone;
  today: string;
  famDates: (FamilyDate & { mergedCount: number })[];
  trips: { id: string; label: string; startDate: string; endDate: string }[];
  dontMiss: DontMissRow[];
  dontMissHandlers: DontMissHandlers;
  mailDates: MailDate[];
  mailHandlers: MailDateHandlers;
}

const ms = (iso?: string): number => { if (!iso) return 0; const t = Date.parse(iso); return Number.isNaN(t) ? 0 : t; };

// Day key of an event IN THE EFFECTIVE ZONE. All-day events carry a floating
// date-only value and are taken as-is; timed events are instants.
function eventYmd(e: CalendarEvent, zone: string): string {
  if (e.isAllDay || !e.start.includes("T")) return e.start.slice(0, 10);
  const t = ms(e.start);
  return t ? ymdInZone(t, zone) : e.start.slice(0, 10);
}

function groupByDate(events: CalendarEvent[], zone: string): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = eventYmd(e, zone);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return map;
}

const dayNum = (ymd: string): number => Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

function getDayLabel(dateStr: string, today: string): { primary: string; secondary: string; isToday: boolean } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const diff = dayNum(dateStr) - dayNum(today);
  if (diff === 0) return { primary: "Today", secondary: format(date, "EEEE, MMMM d"), isToday: true };
  if (diff === 1) return { primary: "Tomorrow", secondary: format(date, "EEEE, MMMM d"), isToday: false };
  if (diff > 1 && diff < 7) return { primary: format(date, "EEEE"), secondary: format(date, "MMMM d"), isToday: false };
  return { primary: format(date, "EEE, MMM d"), secondary: format(date, "yyyy"), isToday: false };
}

/** "10:00 AM – 10:45 AM" in the effective zone, with the device time when it differs. */
function eventTime(event: CalendarEvent, zone: EffectiveZone): { main: string; label: string; device: string | null } {
  if (event.isAllDay) return { main: "All Day", label: "", device: null };
  const t0 = ms(event.start), t1 = ms(event.end);
  if (!t0) return { main: "", label: "", device: null };
  const main = t1 ? `${timeInZone(t0, zone.zone)} – ${timeInZone(t1, zone.zone)}` : timeInZone(t0, zone.zone);
  const label = zoneLabel(zone.zone, t0);
  const device = zone.device && zone.device !== zone.zone ? `${timeInZone(t0, zone.device)} ${zoneLabel(zone.device, t0)}` : null;
  return { main, label, device };
}

interface PrepMail { id: string; from: string; subject: string; date: string; snippet: string }
interface PrepBlock { email: string; mails: PrepMail[] }
const formatPrepDate = (raw: string) => { try { return new Date(raw).toLocaleDateString([], { month: "short", day: "numeric" }); } catch { return ""; } };
const parsePrepSender = (from: string) => { const m = from.match(/^(.+?)\s*<.+?>$/); return (m ? m[1] : from).replace(/"/g, "").trim(); };

function AgendaEvent({ event, zone }: { event: CalendarEvent; zone: EffectiveZone }) {
  const [expanded, setExpanded] = useState(false);
  const time = eventTime(event, zone);
  const hasDetails = !!(event.location || event.description);
  const hasAttendees = !!event.attendees && event.attendees.length > 0;
  const [prepState, setPrepState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [prepBlocks, setPrepBlocks] = useState<PrepBlock[]>([]);

  const fetchPrep = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (prepState === "loading" || prepState === "done") return;
    setPrepState("loading");
    try {
      const res = await fetch("/api/meeting-prep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attendees: event.attendees ?? [] }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setPrepBlocks(Array.isArray(data.attendees) ? data.attendees : []);
      setPrepState("done");
    } catch { setPrepState("error"); }
  };

  const isExpandable = hasDetails || hasAttendees;
  const a = useEventActions(event);

  return (
    <div className={`flex gap-3 py-2.5 border-b border-slate-800/60 last:border-0 group ${isExpandable ? "cursor-pointer select-none" : ""}`} onClick={() => isExpandable && setExpanded((v) => !v)}>
      <div className="w-28 flex-shrink-0 text-right pt-0.5" title={time.device ? `${time.device} on this device` : undefined}>
        {event.isAllDay ? (
          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">All Day</span>
        ) : (
          <>
            <span className="text-xs font-mono text-emerald-400/80 block">{time.main}</span>
            <span className="text-[9px] font-mono text-slate-600 block">{time.label}{time.device ? ` · ${time.device}` : ""}</span>
          </>
        )}
      </div>
      <div className="flex-1 min-w-0 pl-3 border-l border-slate-700/60">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-medium text-slate-200 leading-tight group-hover:text-white transition-colors">{event.title}</p>
          <div className="opacity-60 group-hover:opacity-100 transition-opacity flex items-center">
            <EventActionCluster a={a} />
            {isExpandable && <span className="text-slate-600 text-[10px] mt-0.5 ml-1">{expanded ? "▲" : "▼"}</span>}
          </div>
        </div>
        <EventActionPanels a={a} />
        {!expanded && event.location && <p className="text-xs text-slate-500 mt-0.5 truncate">📍 {event.location}</p>}
        {expanded && (
          <div className="mt-2 space-y-2">
            {event.location && <div className="flex items-start gap-1.5"><span className="text-slate-500 text-xs flex-shrink-0 mt-px">📍</span><p className="text-xs text-slate-400 leading-relaxed">{event.location}</p></div>}
            {event.description && <p className="text-xs text-slate-500 leading-relaxed whitespace-pre-line pl-2 border-l-2 border-slate-700">{event.description}</p>}
            {event.account && <p className="text-[10px] font-mono text-slate-600">{event.account}</p>}
            {hasAttendees && (
              <div className="pt-1.5 mt-1.5 border-t border-slate-800/80">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-[10px] font-mono text-slate-500 truncate">👤 {event.attendees!.join(", ")}</p>
                  {prepState !== "done" && (
                    <button onClick={fetchPrep} disabled={prepState === "loading"} title="Pull recent emails from attendees" className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 px-2 py-0.5 rounded-md transition-all disabled:opacity-40">
                      {prepState === "loading" ? "…" : prepState === "error" ? "Retry" : "📋 Prep"}
                    </button>
                  )}
                </div>
                {prepState === "done" && prepBlocks.length > 0 && (
                  <div className="space-y-2 mt-2">
                    {prepBlocks.map((block) => (
                      <div key={block.email} className="bg-slate-900/60 border border-slate-800 rounded-md p-2">
                        <p className="text-[10px] font-mono text-slate-500 mb-1.5">{block.email}</p>
                        {block.mails.length === 0 ? <p className="text-[10px] text-slate-600 italic">No recent mail in last 60 days.</p> : (
                          <ul className="space-y-1.5">
                            {block.mails.map((m) => (
                              <li key={m.id} className="text-[11px] leading-snug">
                                <div className="flex items-baseline justify-between gap-2"><span className="text-slate-300 font-medium truncate">{m.subject || "(no subject)"}</span><span className="text-slate-600 font-mono text-[9px] flex-shrink-0">{formatPrepDate(m.date)}</span></div>
                                <p className="text-slate-500 text-[10px] truncate">{parsePrepSender(m.from)}: {m.snippet}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {prepState === "done" && prepBlocks.every((b) => b.mails.length === 0) && <p className="text-[10px] text-slate-600 italic mt-1">No recent mail found for any attendee.</p>}
              </div>
            )}
          </div>
        )}
        {!expanded && event.account && <p className="text-[10px] font-mono text-slate-700 mt-0.5">{event.account}</p>}
      </div>
    </div>
  );
}

const SRC_CHIP: Record<DontMissRow["source"], string> = {
  family: "text-violet-300 bg-violet-500/15", task: "text-amber-300 bg-amber-500/15", people: "text-rose-300 bg-rose-500/15",
};
const act = "text-[9px] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 transition-colors whitespace-nowrap";
const actMuted = `${act} border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500`;
const actPri = `${act} border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10`;
const actSky = `${act} border-sky-500/50 text-sky-300 hover:bg-sky-500/10`;

function formatUpdated(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function CalendarPanel({ onEventsLoaded, refreshKey: externalRefresh, zone, today, famDates, trips, dontMiss, dontMissHandlers, mailDates, mailHandlers }: CalendarPanelProps) {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [secondaryEmail, setSecondaryEmail] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const onEventsLoadedRef = useRef(onEventsLoaded);
  useEffect(() => { onEventsLoadedRef.current = onEventsLoaded; });
  useEffect(() => { if (externalRefresh > 0) setRefreshKey((k) => k + 1); }, [externalRefresh]);

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
        if (data.secondaryError) { setSecondaryError(data.secondaryError); setSecondaryEmail(data.secondaryEmail); }
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
        {[1, 2, 3].map((i) => <div key={i} className="space-y-2"><div className="h-2.5 bg-slate-800 rounded w-20" /><div className="h-10 bg-slate-800/60 rounded-lg" /></div>)}
      </div>
    );
  }
  if (status === "unauthenticated") return <div className="bg-slate-900 rounded-xl border border-slate-800"><SignInButton /></div>;

  // ── Agenda from today: events ∪ family dates (deduped, ≤ 45 d), in the effective zone ──
  const eventsByDay = groupByDate(events.filter((e) => eventYmd(e, zone.zone) >= today), zone.zone);
  const horizon = addDays(today, AGENDA_FAMILY_HORIZON_DAYS);
  const famByDay = familyDatesByDay(agendaFamilyDates(famDates, today).filter((f) => f.dateISO <= horizon));
  const dayKeys = Array.from(new Set([...eventsByDay.keys(), ...famByDay.keys()])).sort();
  const todayEvents = eventsByDay.get(today) ?? [];
  const counts = todayCounts(dontMiss);
  const [y, m, d] = today.split("-").map(Number);
  const todayLabel = format(new Date(y, m - 1, d), "EEEE, MMMM d");
  const activeTrip = tripChipFor(today, trips);
  const run = async (key: string, fn: () => Promise<void> | void) => { setBusy(key); try { await fn(); } finally { setBusy(null); } };

  return (
    <div className="space-y-4">
      {/* ── Today strip ── */}
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] px-4 py-2.5 flex items-center gap-x-4 gap-y-1.5 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">Today</span>
        <span className="text-[13px] font-bold text-slate-100">{todayLabel}</span>
        <span className="text-[10px] font-mono text-slate-500" title={zone.source === "trip" ? "Active TDY sets the zone" : zone.source === "pinned" ? "Pinned in Preferences → Profile" : "Device zone"}>
          {zone.label}{activeTrip ? ` · ${activeTrip}` : zone.source === "trip" && zone.trip ? ` · TDY ${zone.trip.label}` : ""}
        </span>
        {todayEvents.slice(0, 3).map((e) => (
          <span key={e.id} className="text-xs text-slate-300 flex items-center gap-1.5 min-w-0">
            <b className="text-amber-300 font-mono font-bold">{e.isAllDay ? "all day" : timeInZone(ms(e.start), zone.zone)}</b>
            <span className="truncate max-w-[220px]">{e.title}</span>
          </span>
        ))}
        {todayEvents.length === 0 && <span className="text-xs text-slate-600">nothing on the calendar today</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {counts.overdueTasks > 0 && <span className="text-[9px] font-bold uppercase tracking-wider text-red-300 bg-red-500/15 rounded px-1.5 py-0.5">{counts.overdueTasks} overdue task{counts.overdueTasks === 1 ? "" : "s"}</span>}
          {counts.familyDue > 0 && <span className="text-[9px] font-bold uppercase tracking-wider text-violet-300 bg-violet-500/15 rounded px-1.5 py-0.5">{counts.familyDue} family due</span>}
          {counts.checkinsDue > 0 && <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/15 rounded px-1.5 py-0.5">{counts.checkinsDue} check-in{counts.checkinsDue === 1 ? "" : "s"} due</span>}
        </span>
      </section>

      {/* ── Don't miss ── */}
      {dontMiss.length > 0 && (
        <section className="rounded-xl border border-red-500/35 bg-red-500/[0.04] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-red-500/20">
            <span className="text-[11px] font-bold uppercase tracking-widest text-red-300">⚠ Don&apos;t miss</span>
            <span className="text-[10px] text-slate-500">late and due now, from every source — one list, deduplicated</span>
          </div>
          <ul className="divide-y divide-slate-800/60">
            {dontMiss.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5 px-4 py-2 text-[12.5px]">
                <span className={`text-[8px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 w-[52px] text-center flex-shrink-0 ${SRC_CHIP[r.source]}`}>{r.source}</span>
                <span className="flex-1 min-w-0 truncate text-slate-200">{r.title}<span className="text-slate-500 text-[10.5px] ml-2">{r.sub}</span></span>
                <span className={`text-[9px] font-bold uppercase tracking-wider flex-shrink-0 ${r.severity === "late" ? "text-red-300" : r.severity === "today" ? "text-amber-300" : "text-slate-400"}`}>{r.when}</span>
                {r.source === "task" && r.task && (
                  <>
                    <button disabled={busy === r.id} onClick={() => run(r.id, () => dontMissHandlers.taskTomorrow(r.task!))} className={actMuted} title="Defer to tomorrow">⏭ tmrw</button>
                    <button disabled={busy === r.id} onClick={() => run(r.id, () => dontMissHandlers.taskDone(r.task!))} className={actPri}>✓ Done</button>
                  </>
                )}
                {r.source === "family" && r.family && (
                  <>
                    <button onClick={() => window.dispatchEvent(new CustomEvent("app:navigate", { detail: "family" }))} className={actSky} title="Open on the Family tab (the email link is there)">Family →</button>
                    {r.family.kind === "deadline" && (
                      <>
                        <button disabled={busy === r.id} onClick={() => run(r.id, () => dontMissHandlers.familySnooze(r))} className={actMuted} title="Not now — hide for a week">Snooze</button>
                        <button disabled={busy === r.id} onClick={() => run(r.id, () => dontMissHandlers.familyDone(r))} className={actPri}>Done</button>
                      </>
                    )}
                  </>
                )}
                {r.source === "people" && r.contact && (
                  <>
                    <button disabled={busy === r.id} onClick={() => run(r.id, () => dontMissHandlers.scheduleCheckin(r.contact!))} className={actSky} title="Drop a check-in on tomorrow 09:00">📅 Schedule</button>
                    <button disabled={busy === r.id} onClick={() => run(r.id, () => dontMissHandlers.contacted(r.contact!))} className={actPri}>✓ Contacted</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Dates in your mail ── */}
      {mailDates.length > 0 && (
        <section className="rounded-xl border border-sky-500/30 bg-sky-500/[0.04] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-sky-500/20">
            <span className="text-[11px] font-bold uppercase tracking-widest text-sky-300">📅 Dates in your mail</span>
            <span className="text-[10px] text-slate-500">explicit dates the email triage found — nothing is added until you tap</span>
          </div>
          <ul className="divide-y divide-slate-800/60">
            {mailDates.map((dm) => {
              const href = gmailMessageUrl(dm.messageId, dm.accountEmail || undefined);
              const whenLabel = dm.when
                ? (dm.when.length === 10 ? format(new Date(Number(dm.when.slice(0, 4)), Number(dm.when.slice(5, 7)) - 1, Number(dm.when.slice(8, 10))), "EEE MMM d") : `${format(new Date(Number(dm.when.slice(0, 4)), Number(dm.when.slice(5, 7)) - 1, Number(dm.when.slice(8, 10))), "EEE MMM d")} · ${dm.when.slice(11)}`)
                : `“${dm.whenText}”`;
              return (
                <li key={dm.id} className="grid grid-cols-[88px_1fr_auto] gap-2.5 items-center px-4 py-2 text-[12.5px]">
                  <span className={`font-mono text-[11px] font-bold leading-tight ${dm.when ? "text-sky-200" : "text-amber-300"}`} title={dm.when ? `As written: “${dm.whenText}”` : "Not anchored to a calendar date — the app will not guess it"}>{whenLabel}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-slate-200">{dm.what}</span>
                    <span className="block truncate text-[10.5px] text-slate-500">{senderShort(dm.from)} · {dm.subject}{!dm.when ? " · the app will not guess the date" : ""}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {dm.when ? (
                      <>
                        <button disabled={busy === dm.id} onClick={() => run(dm.id, () => mailHandlers.addEvent(dm))} className={actSky}>＋ Event</button>
                        <button disabled={busy === dm.id} onClick={() => run(dm.id, () => mailHandlers.addTask(dm))} className={actMuted}>＋ Task</button>
                      </>
                    ) : href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className={actSky}>Open email</a>
                    ) : null}
                    <button onClick={() => mailHandlers.dismiss(dm)} className={`${actMuted} px-1.5`} title="Dismiss">✕</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── Agenda ── */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900/80 gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar size={14} strokeWidth={2.25} className="text-emerald-400" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">Upcoming</h2>
            <span className="text-[10px] text-slate-600 font-mono">from today · times in {zone.label}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-600 font-mono hidden sm:inline">{session?.user?.email}</span>
            {lastUpdated && !loading && <span className="text-[10px] text-slate-700 font-mono">{formatUpdated(lastUpdated)}</span>}
            <button onClick={() => setRefreshKey((k) => k + 1)} disabled={loading} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-400 disabled:opacity-40 font-mono transition-colors">
              <span className={`text-base leading-none ${loading ? "animate-spin" : ""}`}>↻</span>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {secondaryError && (
          <div className="mx-4 mt-3 bg-amber-950/60 border border-amber-700/40 text-amber-400 rounded-lg p-3 text-xs flex items-start gap-2">
            <span className="flex-shrink-0 mt-px">⚠</span>
            <div>
              {secondaryError === "scope_error" ? (
                <><span className="font-semibold">{secondaryEmail || "Secondary account"} needs calendar access.</span> Go to the <strong>Email</strong> tab, remove the second account, then reconnect it to grant calendar permissions.</>
              ) : (
                <>Could not load events from <span className="font-semibold">{secondaryEmail || "secondary account"}</span>.</>
              )}
            </div>
          </div>
        )}

        <div className="overflow-y-auto max-h-[calc(100vh-260px)]">
          {loading && (
            <div className="p-5 space-y-4 animate-pulse">
              {[1, 2, 3].map((i) => <div key={i} className="space-y-2"><div className="h-2.5 bg-slate-800 rounded w-20" /><div className="h-10 bg-slate-800/60 rounded-lg" /><div className="h-10 bg-slate-800/60 rounded-lg" /></div>)}
            </div>
          )}
          {error && <div className="m-4 bg-red-950 border border-red-900 text-red-400 rounded-lg p-3 text-sm">{error}</div>}
          {!loading && !error && dayKeys.length === 0 && <p className="text-sm text-slate-600 text-center py-16 font-mono uppercase tracking-wider">No upcoming events</p>}

          {!loading && !error && dayKeys.map((dateKey) => {
            const dayEvents = eventsByDay.get(dateKey) ?? [];
            const fam = famByDay.get(dateKey) ?? [];
            const { primary, secondary, isToday } = getDayLabel(dateKey, today);
            const trip = tripChipFor(dateKey, trips);
            return (
              <div key={dateKey} className="border-b border-slate-800/60 last:border-0">
                <div className={`flex items-baseline gap-2.5 px-5 py-2.5 sticky top-0 z-10 ${isToday ? "bg-emerald-500/10 border-b border-emerald-500/20" : "bg-slate-900/95 border-b border-slate-800/40"}`}>
                  <span className={`text-sm font-bold ${isToday ? "text-emerald-400" : "text-slate-300"}`}>{primary}</span>
                  <span className={`text-[11px] font-mono ${isToday ? "text-emerald-600" : "text-slate-600"}`}>{secondary}</span>
                  {trip && <span className="ml-auto text-[8.5px] font-bold uppercase tracking-widest text-amber-300 bg-amber-500/12 border border-amber-500/25 rounded px-1.5 py-0.5">{trip}</span>}
                  {isToday && !trip && <span className="ml-auto text-[9px] font-bold uppercase tracking-widest text-emerald-500 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded">Today</span>}
                </div>
                <div className="px-5">
                  {dayEvents.map((event) => <AgendaEvent key={event.id} event={event} zone={zone} />)}
                  {fam.map((f) => {
                    const merged = (f as FamilyDate & { mergedCount?: number }).mergedCount ?? 1;
                    const kindLabel = f.kind === "bill" ? "bill" : f.kind === "deadline" ? "family" : f.kind === "expected" ? "expected" : "document";
                    return (
                      <div key={f.id} className={`flex items-center gap-2.5 py-1.5 border-t border-dashed border-violet-500/25 bg-violet-500/[0.03] -mx-5 px-5 ${f.tone === "handled" ? "opacity-50" : ""}`}>
                        <span className="w-28 flex-shrink-0 text-right text-[9px] font-bold uppercase tracking-wider text-violet-300">{FAMILY_DATE_GLYPH[f.kind]} {kindLabel}</span>
                        <span className={`text-[12px] flex-1 min-w-0 truncate pl-3 ${f.tone === "handled" ? "line-through text-slate-500" : "text-slate-300"}`}>
                          {f.title}
                          {merged > 1 && <span className="text-[10px] text-slate-500 ml-2">×{merged} mentions</span>}
                          {f.note && <span className="hidden sm:inline text-[10px] text-slate-500 ml-2">{f.note}</span>}
                        </span>
                        {f.tone === "soon" && <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 flex-shrink-0">soon</span>}
                        <button onClick={() => window.dispatchEvent(new CustomEvent("app:navigate", { detail: "family" }))} className={actMuted} title="Open the Family tab">Family →</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
