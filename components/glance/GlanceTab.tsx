"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Tab } from "@/components/layout/TabBar";
import {
  NewsItem,
  NewsletterSummary,
  CalendarEvent,
  EmailMessage,
  GoogleTask,
  TickerEntry,
  WeatherThreats,
} from "@/lib/types";
import { clientCache } from "@/lib/clientCache";

// ── Cache keys owned by the source tabs. Glance is read-only here: it peeks
//    the same in-memory entries the other tabs populate, so it never triggers
//    a duplicate fetch for data the dashboard already has.
const EMAIL_CACHE_KEY = "gmail:emails";        // set by EmailTab → EmailMessage[]
const BRIEFING_CACHE_KEY = "briefing:result";  // set by briefingPrefetch → Briefing
const CURATED_CACHE_KEY = "news:curated";      // set by NewsFeed overview → {critical,discover}

// Mirror of the Briefing shape rendered by BriefingModal (not exported there).
interface Briefing {
  headline: string;
  schedule: string[];
  keyDevelopments: string[];
  topStories: string[];
  connections: string;
  suggestedFocus: string[];
}

interface Curated {
  critical: NewsItem[];
  discover: NewsItem[];
}

type SeenMap = Record<"email" | "news" | "newsletters" | "osint", number>;
type OsintSignal = { title: string; priority: string; reason: string; sources: number };

interface GlanceTabProps {
  active: boolean;
  articles: NewsItem[];
  newsletters: NewsletterSummary[];
  calendarEvents: CalendarEvent[];
  osintTop: OsintSignal[];
  osintSignals: number;
  previousSeen: SeenMap;
  watchlist: string[];
  marketsWatchlist: TickerEntry[];
  onNavigate: (tab: Tab) => void;
  onOpenBrief: () => void;
  onOpenDigest: () => void;
}

// ───────────────────────── time helpers ─────────────────────────

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
function isToday(ms: number): boolean {
  return ms >= startOfToday() && ms <= endOfToday();
}
function ms(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
function relTime(iso?: string): string {
  const t = ms(iso);
  if (!t) return "";
  const diff = Date.now() - t;
  const past = diff >= 0;
  const a = Math.abs(diff);
  const mins = Math.round(a / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${past ? "" : "in "}${mins}m${past ? " ago" : ""}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${past ? "" : "in "}${hrs}h${past ? " ago" : ""}`;
  const days = Math.round(hrs / 24);
  return `${past ? "" : "in "}${days}d${past ? " ago" : ""}`;
}
function clockTime(iso: string): string {
  const t = ms(iso);
  if (!t) return "";
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
function senderName(from: string): string {
  // "Jane Doe <jane@x.com>" → "Jane Doe"; bare address → local part.
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  const at = from.indexOf("@");
  return at > 0 ? from.slice(0, at) : from;
}

// Google Tasks `due` is a date-only value encoded at UTC midnight. It must be
// compared by calendar date against the LOCAL today — matching TasksPanel's
// dateGroup() — not as an absolute instant. Comparing instants pulls a task
// due *tomorrow* (whose UTC-midnight timestamp falls on tonight in behind-UTC
// zones) into "today", disagreeing with the Tasks/Calendar tab.
function localTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function taskDueState(due?: string): "overdue" | "today" | "future" | "none" {
  if (!due) return "none";
  const taskDate = due.substring(0, 10);
  const today = localTodayStr();
  if (taskDate < today) return "overdue";
  if (taskDate === today) return "today";
  return "future";
}

// Re-read the module-level caches on an interval so Glance fills in as the
// other tabs finish loading in the background. Peeks happen during render;
// the tick just forces re-evaluation. Only runs while Glance is visible.
function useCacheTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const bump = () => setTick((t) => t + 1);
    const id = setInterval(bump, 4000);
    window.addEventListener("focus", bump);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", bump);
    };
  }, [active]);
}

// ───────────────────────── component ─────────────────────────

export default function GlanceTab({
  active,
  articles,
  newsletters,
  calendarEvents,
  osintTop,
  osintSignals,
  previousSeen,
  watchlist,
  marketsWatchlist,
  onNavigate,
  onOpenBrief,
  onOpenDigest,
}: GlanceTabProps) {
  const { status } = useSession();
  useCacheTick(active);

  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [threats, setThreats] = useState<WeatherThreats | null>(null);

  // Severe-weather threats for the user's locations (+ active tropical systems),
  // from the shared /api/weather/threats endpoint. Surfaced in "Needs you now".
  useEffect(() => {
    if (!active || status !== "authenticated") return;
    let cancelled = false;
    const load = () => {
      fetch("/api/weather/threats")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: WeatherThreats | null) => { if (!cancelled && d) setThreats(d); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 3 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, status]);

  // Tasks are the one "needs you now" source with no shared client cache, so
  // Glance fetches them itself (lightweight) and stashes the result so a later
  // visit to the Calendar rail can reuse it.
  useEffect(() => {
    if (!active || status !== "authenticated") return;
    let cancelled = false;
    const load = () => {
      const cached = clientCache.peek<GoogleTask[]>("tasks:items");
      if (cached) setTasks(cached);
      fetch("/api/tasks")
        .then((r) => (r.ok ? r.json() : { tasks: [] }))
        .then((d: { tasks?: GoogleTask[] }) => {
          if (cancelled) return;
          const list = d.tasks ?? [];
          setTasks(list);
          clientCache.set("tasks:items", list, 5 * 60 * 1000);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, status]);

  // ── Peek shared caches (recomputed each tick / render) ──
  const briefing = clientCache.peek<Briefing>(BRIEFING_CACHE_KEY);
  const emails = clientCache.peek<EmailMessage[]>(EMAIL_CACHE_KEY) ?? [];
  const curated = clientCache.peek<Curated>(CURATED_CACHE_KEY);

  // ── Derived: "since you last looked" ──
  const newStories = articles.filter((a) => ms(a.pubDate) > previousSeen.news).length;
  const newEmails = emails.filter((e) => ms(e.date) > previousSeen.email && e.priority !== "Low").length;

  // ── Derived: needs-you-now (urgency-ranked merge) ──
  // Date-only comparison (see taskDueState) so "due today" agrees with the
  // Tasks/Calendar tab. Only overdue or due-today tasks demand attention here.
  const dueTasks = tasks
    .filter((t) => t.status === "needsAction")
    .map((t) => ({ t, state: taskDueState(t.due) }))
    .filter((x) => x.state === "overdue" || x.state === "today")
    .sort((a, b) => (a.t.due ?? "").localeCompare(b.t.due ?? ""));

  type Urgent = {
    id: string;
    rank: number; // lower = more urgent (drives sort)
    tone: "red" | "amber" | "emerald";
    icon: string;
    label: string;
    sub: string;
    meta: string;
    onClick: () => void;
  };

  const urgent: Urgent[] = [];

  // Severe weather outranks everything — only warnings/severe alerts surface
  // here (minor advisories stay on the Weather tab).
  for (const w of (threats?.threats ?? []).filter((t) => t.lifeThreatening || t.severity === "Extreme" || t.severity === "Severe").slice(0, 3)) {
    urgent.push({
      id: `wx-${w.id}`,
      rank: w.lifeThreatening ? -1 : 0,
      tone: "red",
      icon: "⚠",
      label: w.event,
      sub: w.locations.join(", "),
      meta: "Weather",
      onClick: () => onNavigate("weather"),
    });
  }

  // Red disasters and anything near a base — humanitarian/natural events.
  for (const d of (threats?.disasters ?? []).filter((d) => d.severity === "red" || d.nearLocations.length > 0).slice(0, 3)) {
    const near = d.nearLocations.length > 0;
    urgent.push({
      id: `disaster-${d.id}`,
      rank: near ? -1 : 0,
      tone: "red",
      icon: "⊕",
      label: d.title,
      sub: near ? `Near ${d.nearLocations.join(", ")}` : [d.country || d.type, d.aor !== "UNKNOWN" ? d.aor : null].filter(Boolean).join(" · "),
      meta: d.aor !== "UNKNOWN" ? d.aor : "Disaster",
      onClick: () => onNavigate("weather"),
    });
  }

  for (const { t, state } of dueTasks) {
    const overdue = state === "overdue";
    urgent.push({
      id: `task-${t.id}`,
      rank: overdue ? 0 : 1,
      tone: overdue ? "red" : "amber",
      icon: "✓",
      label: t.title,
      sub: overdue ? "Task overdue" : "Task due today",
      meta: overdue ? "Overdue" : "Today",
      onClick: () => onNavigate("calendar"),
    });
  }

  for (const e of emails.filter((e) => e.priority === "High").slice(0, 5)) {
    const unseen = ms(e.date) > previousSeen.email;
    urgent.push({
      id: `email-${e.id}`,
      rank: unseen ? 2 : 3,
      tone: "amber",
      icon: "◎",
      label: e.subject || "(no subject)",
      sub: `${senderName(e.from)}${e.summary ? ` — ${e.summary}` : ""}`,
      meta: relTime(e.date),
      onClick: () => onNavigate("email"),
    });
  }

  for (const s of osintTop.filter((s) => s.priority === "High").slice(0, 4)) {
    urgent.push({
      id: `osint-${s.title}`,
      rank: 2,
      tone: "red",
      icon: "⊕",
      label: s.title,
      sub: s.reason || `${s.sources} source${s.sources === 1 ? "" : "s"}`,
      meta: "OSINT",
      onClick: () => onNavigate("osint"),
    });
  }

  urgent.sort((a, b) => a.rank - b.rank);
  const urgentTop = urgent.slice(0, 6);

  // ── Derived: today's schedule ──
  const todayEvents = calendarEvents
    .filter((e) => isToday(ms(e.start)) || (ms(e.start) < startOfToday() && ms(e.end) > startOfToday()))
    .sort((a, b) => ms(a.start) - ms(b.start))
    .slice(0, 6);

  // ── Derived: breaking & critical ──
  const criticalSource =
    curated && curated.critical.length > 0
      ? curated.critical
      : [...articles].sort((a, b) => ms(b.pubDate) - ms(a.pubDate));
  const breaking = criticalSource.slice(0, 5);

  // ── Derived: context strip ──
  const recentNewsletters = [...newsletters]
    .sort((a, b) => ms(b.date) - ms(a.date))
    .slice(0, 2);

  const toneText: Record<Urgent["tone"], string> = {
    red: "text-red-400",
    amber: "text-amber-400",
    emerald: "text-emerald-400",
  };
  const toneBorder: Record<Urgent["tone"], string> = {
    red: "border-l-red-500/70",
    amber: "border-l-amber-500/70",
    emerald: "border-l-emerald-500/70",
  };

  const warming = articles.length === 0 && emails.length === 0 && calendarEvents.length === 0;

  return (
    <div className="space-y-6">
      {/* ── Header: greeting + since-you-looked ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-wide text-slate-100">
            {greeting()}, DEAD
          </h2>
          <p className="text-xs uppercase tracking-widest text-slate-500 mt-0.5">
            {new Date().toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider">
          <SinceChip count={newStories} label="new stories" onClick={() => onNavigate("news")} />
          <SinceChip count={newEmails} label="priority email" onClick={() => onNavigate("email")} />
          <SinceChip count={osintSignals} label="signals" tone="red" onClick={() => onNavigate("osint")} />
          {newStories + newEmails + osintSignals === 0 && (
            <span className="text-slate-500">You&apos;re all caught up</span>
          )}
        </div>
      </div>

      {/* ── Hero: morning brief ── */}
      <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5 glow-green card-hover">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-emerald-400 text-[11px] font-bold uppercase tracking-widest mb-2">
              <span className="text-base leading-none">◆</span> Morning Brief
            </div>
            {briefing ? (
              <>
                <p className="text-base sm:text-lg font-semibold text-slate-100 leading-snug">
                  {briefing.headline}
                </p>
                {briefing.suggestedFocus?.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {briefing.suggestedFocus.slice(0, 3).map((f, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-300">
                        <span className="text-emerald-500 mt-0.5 flex-shrink-0">▸</span>
                        <span className="min-w-0">{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-400 leading-relaxed">
                {warming
                  ? "Pulling your news, mail and calendar together… your brief will appear here shortly."
                  : "Your brief is being generated from today's news and newsletters."}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button
              onClick={onOpenBrief}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-all whitespace-nowrap"
            >
              Full brief
            </button>
            <button
              onClick={onOpenDigest}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 text-slate-300 text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-all whitespace-nowrap"
            >
              Digest
            </button>
          </div>
        </div>
      </section>

      {/* ── Two-column body ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Needs you now */}
          <Panel title="Needs you now" accent onJump={urgentTop.length ? () => onNavigate("email") : undefined}>
            {urgentTop.length === 0 ? (
              <Empty>Nothing demanding action right now.</Empty>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {urgentTop.map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={u.onClick}
                      className={`group w-full text-left flex items-start gap-3 px-3 py-2.5 border-l-2 ${toneBorder[u.tone]} hover:bg-slate-800/40 transition-colors`}
                    >
                      <span className={`mt-0.5 text-sm flex-shrink-0 ${toneText[u.tone]}`}>{u.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-200 truncate group-hover:text-slate-100">
                          {u.label}
                        </span>
                        <span className="block text-xs text-slate-500 truncate">{u.sub}</span>
                      </span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 ${toneText[u.tone]}`}>
                        {u.meta}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Breaking & critical */}
          <Panel title="Breaking & critical" onJump={() => onNavigate("news")}>
            {breaking.length === 0 ? (
              <Empty>{warming ? "Loading the latest reporting…" : "No critical stories surfaced."}</Empty>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {breaking.map((n) => {
                  const fresh = Date.now() - ms(n.pubDate) < 45 * 60 * 1000;
                  const unseen = ms(n.pubDate) > previousSeen.news;
                  return (
                    <li key={n.id}>
                      <a
                        href={n.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block px-3 py-2.5 hover:bg-slate-800/40 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          {unseen && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-200 leading-snug group-hover:text-emerald-400 line-clamp-2">
                              {n.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                              <span className="truncate">{n.source}</span>
                              <span className="text-slate-700">·</span>
                              <span className="flex-shrink-0">{relTime(n.pubDate)}</span>
                              {fresh && (
                                <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider text-red-400 border border-red-500/40 rounded px-1 py-px">
                                  Live
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        {/* Rail */}
        <div className="space-y-6">
          {/* Today */}
          <Panel title="Today" onJump={() => onNavigate("calendar")}>
            {todayEvents.length === 0 ? (
              <Empty>Nothing on the calendar today.</Empty>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {todayEvents.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => onNavigate("calendar")}
                      className="group w-full text-left flex items-baseline gap-3 px-3 py-2.5 hover:bg-slate-800/40 transition-colors"
                    >
                      <span className="text-[11px] font-mono font-semibold text-emerald-400 w-16 flex-shrink-0">
                        {e.isAllDay ? "All day" : clockTime(e.start)}
                      </span>
                      <span className="text-sm text-slate-200 truncate group-hover:text-slate-100">
                        {e.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Context */}
          <Panel title="On your radar">
            <div className="px-3 py-3 space-y-3">
              {recentNewsletters.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                    Latest newsletters
                  </p>
                  <ul className="space-y-1.5">
                    {recentNewsletters.map((nl) => (
                      <li key={nl.id}>
                        <button
                          onClick={() => onNavigate("news")}
                          className="text-left text-xs text-slate-300 hover:text-emerald-400 transition-colors line-clamp-1 w-full"
                        >
                          {nl.subject}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <RadarLine
                label="OSINT signals"
                value={`${osintSignals} new`}
                tone={osintSignals > 0 ? "red" : "muted"}
                onClick={() => onNavigate("osint")}
              />

              {threats && (threats.summary.total > 0 || threats.tropical.length > 0) && (
                <RadarLine
                  label="Severe weather"
                  value={
                    threats.summary.lifeThreatening > 0
                      ? `${threats.summary.lifeThreatening} life-threatening`
                      : threats.tropical.length > 0
                      ? `${threats.tropical.length} tropical system${threats.tropical.length === 1 ? "" : "s"}`
                      : `${threats.summary.total} alert${threats.summary.total === 1 ? "" : "s"}`
                  }
                  tone={threats.summary.lifeThreatening > 0 ? "red" : "muted"}
                  onClick={() => onNavigate("weather")}
                />
              )}

              {threats && threats.summary.disasters > 0 && (
                <RadarLine
                  label="Disasters"
                  value={`${threats.summary.disasters} active${threats.summary.disastersRed > 0 ? ` · ${threats.summary.disastersRed} red` : ""}`}
                  tone={threats.summary.disastersRed > 0 ? "red" : "muted"}
                  onClick={() => onNavigate("weather")}
                />
              )}

              {watchlist.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                    Watch terms
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {watchlist.slice(0, 8).map((w) => (
                      <button
                        key={w}
                        onClick={() => onNavigate("news")}
                        title={`Flagged when "${w}" appears in news`}
                        className="text-[11px] font-medium text-slate-300 bg-slate-800/60 hover:bg-slate-700 hover:text-emerald-400 border border-slate-700 rounded px-1.5 py-0.5 transition-colors"
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {marketsWatchlist.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                    Markets
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {marketsWatchlist.slice(0, 8).map((t) => (
                      <button
                        key={t.symbol}
                        onClick={() => onNavigate("markets")}
                        title={t.label}
                        className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-300 bg-slate-800/60 hover:bg-slate-700 hover:text-emerald-400 border border-slate-700 rounded px-1.5 py-0.5 transition-colors"
                      >
                        {t.symbol.includes(":") ? t.symbol.split(":")[1] : t.symbol}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── small presentational pieces ─────────────────────────

function SinceChip({
  count,
  label,
  tone = "emerald",
  onClick,
}: {
  count: number;
  label: string;
  tone?: "emerald" | "red";
  onClick: () => void;
}) {
  if (count <= 0) return null;
  const color = tone === "red" ? "text-red-400 border-red-500/40" : "text-emerald-400 border-emerald-500/40";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border ${color} bg-slate-800/40 hover:bg-slate-800/70 px-2 py-0.5 transition-colors`}
    >
      <span className="font-bold">{count > 99 ? "99+" : count}</span>
      <span className="text-slate-400">{label}</span>
    </button>
  );
}

function Panel({
  title,
  children,
  accent,
  onJump,
}: {
  title: string;
  children: React.ReactNode;
  accent?: boolean;
  onJump?: () => void;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-800/30">
        <h3 className={`text-[11px] font-bold uppercase tracking-widest ${accent ? "text-emerald-400" : "text-slate-400"}`}>
          {title}
        </h3>
        {onJump && (
          <button
            onClick={onJump}
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-emerald-400 transition-colors"
          >
            View all →
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-xs text-slate-500">{children}</p>;
}

function RadarLine({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone: "red" | "muted";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between text-left group"
    >
      <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">{label}</span>
      <span className={`text-xs font-semibold ${tone === "red" ? "text-red-400" : "text-slate-500"}`}>{value}</span>
    </button>
  );
}
