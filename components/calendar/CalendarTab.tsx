"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import CalendarPanel from "./CalendarPanel";
import TasksPanel from "./TasksPanel";
import KeepInTouchPanel from "./KeepInTouchPanel";
import type { CalendarEvent, EmailMessage, GoogleTask } from "@/lib/types";
import type { Contact, ContactStatus } from "@/lib/contacts";
import type { FamilyDate } from "@/lib/familyCalendar";
import { clientCache } from "@/lib/clientCache";
import { fetchUiState, patchUiState, UI_KEYS } from "@/lib/clientUiState";
import { useEffectiveZone } from "@/lib/zoneClient";
import { ymdInZone, addDays } from "@/lib/effectiveZone";
import { dedupeFamilyDates, dontMissRows, type DontMissRow } from "@/lib/calendarDontMiss";
import { mailDatesFrom, eventPlanFor, type MailDate } from "@/lib/mailDates";
import { toast } from "@/lib/feedback";

// The Calendar tab (REVIEW-2026-10 §3, approved 2026-10-05). This container
// owns the data the Don't-miss list joins — tasks, keep-in-touch contacts,
// family dates, trips, dates found in mail — and the mutations, so the
// list, the agenda and the rail panels act on the same rows. The rail no
// longer collapses: Your people and Tasks are always on the right.

const EMAIL_CACHE_KEY = "gmail:emails"; // set by EmailTab
type ContactRow = Contact & { status: ContactStatus };
interface TripLite { id: string; label: string; startDate: string; endDate: string }

export interface DontMissHandlers {
  taskDone: (t: GoogleTask) => void;
  taskTomorrow: (t: GoogleTask) => void;
  familyDone: (row: DontMissRow) => void;
  familySnooze: (row: DontMissRow) => void;
  contacted: (c: ContactRow) => void;
  scheduleCheckin: (c: ContactRow) => void;
}
export interface MailDateHandlers {
  addEvent: (d: MailDate) => Promise<void>;
  addTask: (d: MailDate) => Promise<void>;
  dismiss: (d: MailDate) => void;
}

const NO_EMAILS: EmailMessage[] = [];

export default function CalendarTab({ active, onEventsLoaded, tasksRefreshKey, onTasksLoaded }: {
  active: boolean;
  onEventsLoaded: (events: CalendarEvent[]) => void;
  tasksRefreshKey: number;
  onTasksLoaded?: (tasks: GoogleTask[]) => void;
}) {
  const { status } = useSession();
  const zone = useEffectiveZone();
  const today = ymdInZone(Date.now(), zone.zone);

  // ── Tasks ──
  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [reauthNeeded, setReauthNeeded] = useState(false);
  const publishTasks = useCallback((next: GoogleTask[]) => {
    setTasks(next);
    onTasksLoaded?.(next);
    clientCache.set("tasks:items", next, 5 * 60 * 1000);
  }, [onTasksLoaded]);
  const fetchTasks = useCallback(async () => {
    setTasksLoading(true); setTasksError(null);
    try {
      const res = await fetch("/api/tasks");
      if (res.status === 403) { setReauthNeeded(true); return; }
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as { tasks: GoogleTask[] };
      publishTasks(data.tasks);
    } catch { setTasksError("Failed to load tasks"); }
    finally { setTasksLoading(false); }
  }, [publishTasks]);
  useEffect(() => { if (status === "authenticated") void fetchTasks(); }, [status, fetchTasks, tasksRefreshKey]);

  const addTask = async (title: string, due?: string, notes?: string) => {
    const res = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, due: due || undefined, notes }) });
    if (!res.ok) throw new Error("Failed");
    const { task } = await res.json() as { task: GoogleTask };
    publishTasks([...tasks, task]);
  };
  const toggleTask = async (task: GoogleTask) => {
    const prev = tasks;
    publishTasks(prev.filter((t) => t.id !== task.id));
    try {
      const r = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, status: "completed" }) });
      if (!r.ok) throw new Error("failed");
    } catch { publishTasks(prev); toast.error("Could not complete the task"); }
  };
  const deleteTask = async (task: GoogleTask) => {
    const prev = tasks;
    publishTasks(prev.filter((t) => t.id !== task.id));
    try { await fetch(`/api/tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" }); } catch { publishTasks(prev); }
  };
  const rescheduleTask = async (task: GoogleTask, due: string | null) => {
    const apply = (d: string | undefined) => publishTasks(tasks.map((t) => (t.id === task.id ? { ...t, due: d } : t)));
    apply(due ?? undefined);
    try {
      const res = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: task.id, due }) });
      if (!res.ok) throw new Error("failed");
    } catch { apply(task.due); }
  };

  // ── Contacts (keep in touch) ──
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const fetchContacts = useCallback(() => {
    fetch("/api/contacts").then((r) => r.json())
      .then((d: { contacts?: ContactRow[] }) => setContacts(Array.isArray(d.contacts) ? d.contacts : []))
      .catch(() => {}).finally(() => setContactsLoading(false));
  }, []);
  useEffect(() => { if (status === "authenticated") fetchContacts(); }, [status, fetchContacts]);

  // ── Family dates, trips, dismissed mail dates ──
  const [famDates, setFamDates] = useState<FamilyDate[]>([]);
  const [trips, setTrips] = useState<TripLite[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const cleanups: (() => void)[] = [];
    if (status !== "authenticated") return;
    fetch("/api/family/dates").then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.items)) setFamDates(d.items); }).catch(() => {});
    const loadTrips = () => fetch("/api/trips").then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.trips)) setTrips(d.trips); }).catch(() => {});
    loadTrips();
    // ＋ TDY / end / remove on this tab (and the Weather TDY card) announce this.
    window.addEventListener("trips:changed", loadTrips);
    cleanups.push(() => window.removeEventListener("trips:changed", loadTrips));
    fetchUiState().then((st) => {
      const v = st[UI_KEYS.mailDatesDismissed];
      if (Array.isArray(v)) setDismissed(new Set(v.filter((x): x is string => typeof x === "string")));
    }).catch(() => {});
    return () => { for (const c of cleanups) c(); };
  }, [status, refreshKey]);
  useEffect(() => {
    const onChanged = () => setRefreshKey((k) => k + 1);
    window.addEventListener("calendar:changed", onChanged);
    return () => window.removeEventListener("calendar:changed", onChanged);
  }, []);

  // ── Emails (for Dates in your mail) — the Email tab's cache, re-read on a tick ──
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  useEffect(() => {
    if (!active) return;
    // Same reference when nothing changed, so the tick does not re-render
    // and re-run the mail-dates join for an unchanged (or empty) cache.
    const read = () => setEmails((prev) => { const next = clientCache.peek<EmailMessage[]>(EMAIL_CACHE_KEY) ?? NO_EMAILS; return next === prev ? prev : next; });
    read();
    const id = setInterval(read, 5000);
    return () => clearInterval(id);
  }, [active]);

  // ── Joins ──
  const famDeduped = useMemo(() => dedupeFamilyDates(famDates), [famDates]);
  const dontMiss = useMemo(() => dontMissRows({ famDates: famDeduped, tasks, contacts, today }), [famDeduped, tasks, contacts, today]);
  const mailDates = useMemo(() => mailDatesFrom(emails, today, dismissed), [emails, today, dismissed]);

  const dontMissHandlers: DontMissHandlers = {
    taskDone: (t) => void toggleTask(t),
    taskTomorrow: (t) => void rescheduleTask(t, `${addDays(today, 1)}T00:00:00.000Z`),
    familyDone: async (row) => {
      const f = row.family; if (!f) return;
      if (f.kind !== "deadline") { window.dispatchEvent(new CustomEvent("app:navigate", { detail: "family" })); return; }
      const id = f.id.replace(/^dl:/, "");
      const r = await fetch("/api/family", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, state: "done" }) }).catch(() => null);
      if (r?.ok) { setFamDates((prev) => prev.filter((x) => x.id !== f.id && !(f as { mergedIds?: string[] }).mergedIds?.includes(x.id))); toast.ok(`Done — ${f.title}`); }
      else toast.error("Could not mark it done");
    },
    familySnooze: async (row) => {
      const f = row.family; if (!f) return;
      if (f.kind !== "deadline") { window.dispatchEvent(new CustomEvent("app:navigate", { detail: "family" })); return; }
      const id = f.id.replace(/^dl:/, "");
      const until = addDays(today, 7);
      const r = await fetch("/api/family", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, snoozeUntil: until }) }).catch(() => null);
      if (r?.ok) { setFamDates((prev) => prev.filter((x) => x.id !== f.id && !(f as { mergedIds?: string[] }).mergedIds?.includes(x.id))); toast.ok(`Snoozed until ${until}`); }
      else toast.error("Could not snooze it");
    },
    contacted: async (c) => {
      await fetch("/api/contacts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, action: "contacted" }) }).catch(() => {});
      fetchContacts();
    },
    scheduleCheckin: async (c) => {
      const d = new Date(); d.setDate(d.getDate() + 1);
      const p = (n: number) => String(n).padStart(2, "0");
      const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`;
      const r = await fetch("/api/contacts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, action: "schedule", when }) }).catch(() => null);
      if (r?.ok) { toast.ok(`📅 Check-in with ${c.name} added for tomorrow 09:00`); window.dispatchEvent(new Event("calendar:changed")); fetchContacts(); }
      else toast.error("Could not add the check-in");
    },
  };

  const mailHandlers: MailDateHandlers = {
    addEvent: async (d) => {
      const plan = eventPlanFor(d); if (!plan) return;
      const r = await fetch("/api/gmail/convert", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: d.messageId, account: d.account, accountEmail: d.accountEmail, kind: "event", mode: "create", plan: { ...plan, timeZone: zone.zone } }),
      }).catch(() => null);
      // Say WHY (bug report 2026-10-07: "Could not add the event" with no
      // reason). A reply that is not JSON is the platform gateway or a
      // sign-in redirect, and its status is the only clue there is.
      if (!r) { toast.error("Could not add the event — the server could not be reached"); return; }
      const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (j?.ok) { toast.ok(`Added to your calendar — ${plan.summary}`, `${d.when} · from "${d.subject}"`); mailHandlers.dismiss(d); window.dispatchEvent(new Event("calendar:changed")); }
      else if (!j) toast.error(`Could not add the event — HTTP ${r.status}${r.redirected || r.status === 401 ? " (signed out? sign in again)" : " without a JSON reply"}`);
      else toast.error(j.error || `Could not add the event (HTTP ${r.status})`);
    },
    addTask: async (d) => {
      try { await addTask(d.what, d.when ? d.when.slice(0, 10) : undefined, `From: ${d.subject}`); toast.ok(`Task added — ${d.what}`); mailHandlers.dismiss(d); }
      catch { toast.error("Could not add the task"); }
    },
    dismiss: (d) => {
      setDismissed((prev) => { const next = new Set(prev).add(d.id); patchUiState({ [UI_KEYS.mailDatesDismissed]: [...next].slice(-300) }); return next; });
    },
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0">
        <CalendarPanel
          onEventsLoaded={onEventsLoaded}
          refreshKey={refreshKey}
          zone={zone}
          today={today}
          famDates={famDeduped}
          trips={trips}
          dontMiss={dontMiss}
          dontMissHandlers={dontMissHandlers}
          mailDates={mailDates}
          mailHandlers={mailHandlers}
        />
      </div>
      <div className="lg:w-80 xl:w-96 flex-shrink-0 space-y-4">
        <KeepInTouchPanel rows={contacts} loading={contactsLoading} onChanged={fetchContacts} />
        <TasksPanel
          tasks={tasks} loading={tasksLoading} error={tasksError} reauthNeeded={reauthNeeded}
          onAdd={(title, due) => addTask(title, due)} onToggle={toggleTask} onDelete={deleteTask} onReschedule={rescheduleTask} onRetry={() => void fetchTasks()}
        />
      </div>
    </div>
  );
}
