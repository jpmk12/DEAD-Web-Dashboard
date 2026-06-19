"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Tab } from "@/components/layout/TabBar";
import { BriefIcon, ReachIcon } from "@/lib/icons";
import { useEventActions, EventActionCluster, EventActionPanels } from "@/components/calendar/eventActions";
import { getForceProtectionData } from "@/lib/forceProtectionClient";
import type { ForceAssessment } from "@/lib/forceProtection";
type ForceWatchItem = ForceAssessment;

// Glyphs for the Global Reach Watch rows, by disaster type (matches the
// ThreatBoard vocabulary so a quake reads the same on both surfaces).
const REACH_DISASTER_GLYPH: Record<string, string> = {
  earthquake: "⊕", cyclone: "🌀", flood: "≈", volcano: "⛰", drought: "☼",
  tsunami: "≋", epidemic: "✚", wildfire: "🔥", other: "•",
};
import {
  NewsItem,
  NewsletterSummary,
  CalendarEvent,
  EmailMessage,
  GoogleTask,
  TickerEntry,
  WeatherThreats,
  TravelAdvisory,
} from "@/lib/types";
import { clientCache } from "@/lib/clientCache";
import ArticleThesis from "@/components/news/ArticleThesis";

// ── Cache keys owned by the source tabs. Glance is read-only here: it peeks
//    the same in-memory entries the other tabs populate, so it never triggers
//    a duplicate fetch for data the dashboard already has.
const EMAIL_CACHE_KEY = "gmail:emails";        // set by EmailTab → EmailMessage[]
const BRIEFING_CACHE_KEY = "briefing:result";  // set by briefingPrefetch → Briefing
const CURATED_CACHE_KEY = "news:curated";      // set by NewsFeed overview → {critical,discover}
const RADAR_BASELINE_KEY = "glance:radar:baseline"; // last-seen "On your radar" values

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
function startOfTomorrow(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function endOfTomorrow(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
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
// A Today/Tomorrow agenda row: time + title jumps to the Calendar; the quick
// actions (AI-edit / edit / nudge / delete) come from the same shared cluster as
// the Calendar upcoming view, so the two surfaces behave identically.
function ScheduleRow({ e, onNavigate }: { e: CalendarEvent; onNavigate: (tab: Tab) => void }) {
  const a = useEventActions(e);
  return (
    <li className="group hover:bg-slate-800/40 transition-colors">
      <div className="flex items-center">
        <button onClick={() => onNavigate("calendar")} className="flex-1 min-w-0 text-left flex items-baseline gap-3 px-3 py-2.5">
          <span className="text-[11px] font-mono font-semibold text-emerald-400 w-16 flex-shrink-0">
            {e.isAllDay ? "All day" : clockTime(e.start)}
          </span>
          <span className="text-sm text-slate-200 truncate group-hover:text-slate-100">{e.title}</span>
        </button>
        <div className="flex-shrink-0 mr-2 opacity-60 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <EventActionCluster a={a} />
        </div>
      </div>
      {a.mode !== "idle" || a.err ? <div className="px-3 pb-2"><EventActionPanels a={a} /></div> : null}
    </li>
  );
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
// Local calendar date string for today + an offset in days (0 = today, 1 =
// tomorrow), in the browser's tz — same local basis as startOfToday().
function localDateStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localDateAddStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
// Does an event cover the given LOCAL calendar date? All-day events carry
// floating date-only start/end (end EXCLUSIVE) and must be compared as calendar
// dates — converting them to an instant parses them as UTC midnight, which in
// behind-UTC zones lands on the previous evening and leaks an all-day holiday
// (e.g. "Flag Day") into BOTH today and tomorrow. Timed events keep instant math.
function eventCoversLocalDate(
  e: { start: string; end: string; isAllDay?: boolean },
  dayStr: string,
  dayStart: number,
  dayEnd: number,
): boolean {
  if (e.isAllDay) {
    const s = (e.start || "").slice(0, 10);
    if (!s) return false;
    const rawEnd = (e.end || "").slice(0, 10);
    const endExclusive = rawEnd && rawEnd > s ? rawEnd : localDateAddStr(s, 1);
    return s <= dayStr && dayStr < endExclusive;
  }
  const t0 = ms(e.start), t1 = ms(e.end);
  return (t0 >= dayStart && t0 <= dayEnd) || (t0 < dayStart && t1 > dayStart);
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

// Global Reach Watch category metadata + small formatting helpers.
type ReachCat = "neo" | "disaster" | "weather" | "conflict" | "gps" | "airspace";
const REACH_CAT_META: Record<ReachCat, { label: string; icon: string }> = {
  neo: { label: "NEO", icon: "🛫" },
  disaster: { label: "Disasters", icon: "🌪" },
  weather: { label: "Weather", icon: "〜" },
  conflict: { label: "Conflict", icon: "✸" },
  gps: { label: "GPS", icon: "🛰" },
  airspace: { label: "Airspace", icon: "✈" },
};
// Chip / group order — the original three first, then the access degraders.
const REACH_CAT_ORDER: ReachCat[] = ["neo", "disaster", "weather", "conflict", "gps", "airspace"];
// Force-Protection axes surfaced as reach categories (the "can I get in / through"
// degraders), with their glyph + group noun + per-severity score. Read from the
// already-cached /api/force-protection feed — no new fetch.
const FP_AXES: { axis: "conflict" | "gps" | "airspace"; cat: ReachCat; noun: string; red: number; amber: number }[] = [
  { axis: "conflict", cat: "conflict", noun: "conflict alert", red: 110, amber: 65 },
  { axis: "airspace", cat: "airspace", noun: "airspace NOTAM", red: 95, amber: 55 },
  { axis: "gps", cat: "gps", noun: "GPS/EW alert", red: 85, amber: 50 },
];
function pluralize(noun: string, n: number): string {
  if (n === 1) return noun;
  if (/y$/.test(noun)) return noun.replace(/y$/, "ies");
  return `${noun}s`;
}
// "CENTCOM ×3 · EUCOM · AFRICOM" from a group's rows.
function aorBreakdown(items: { tag: string }[]): string {
  const m = new Map<string, number>();
  for (const it of items) m.set(it.tag, (m.get(it.tag) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(" · ");
}

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
  const [advisories, setAdvisories] = useState<TravelAdvisory[]>([]);
  const [reachFilter, setReachFilter] = useState<"all" | ReachCat>("all");
  const [reachGroupsOpen, setReachGroupsOpen] = useState<Set<ReachCat>>(new Set());
  // Force Protection Watch — RED/AMBER locations surface in needs-you-now.
  const [forceWatch, setForceWatch] = useState<ForceWatchItem[]>([]);

  // Last-seen "On your radar" values, persisted so rises since your last look
  // can be highlighted. Frozen for this session (read once on mount).
  const [radarBaseline] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem(RADAR_BASELINE_KEY) || "{}") || {}; } catch { return {}; }
  });

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

  // NEO / evacuation watch — State Dept Level-4 + embassy-departure advisories,
  // fused into "Global Reach Watch". Cached 30 min server-side, so poll slowly.
  useEffect(() => {
    if (!active || status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/state-advisories")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { advisories?: TravelAdvisory[] } | null) => { if (!cancelled && d?.advisories) setAdvisories(d.advisories); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [active, status]);

  // Force Protection Watch — fused per-base posture. Cached 10 min server-side,
  // so poll slowly; only elevated (red/amber) locations reach needs-you-now.
  useEffect(() => {
    if (!active || status !== "authenticated") return;
    let cancelled = false;
    const load = () => {
      getForceProtectionData()
        .then((d) => {
          if (cancelled) return;
          setForceWatch((d.assessments ?? []).filter((a) => a.composite !== "green"));
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
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

  // Force Protection Watch — RED outranks (forces at risk), AMBER below. A
  // location that JUST escalated (worse than yesterday) is bumped to the top and
  // flagged, so a newly-deteriorating spot grabs attention.
  const COCOM_SHORT: Record<string, string> = { NORTHCOM: "NORTHCOM", SOUTHCOM: "SOUTHCOM", EUCOM: "EUCOM", CENTCOM: "CENTCOM", AFRICOM: "AFRICOM", INDOPACOM: "INDOPACOM", UNKNOWN: "" };
  const SEV_IDX: Record<string, number> = { red: 3, amber: 2, unknown: 1, green: 0 };
  const escalated = (f: ForceWatchItem) => !!f.previousComposite && SEV_IDX[f.composite] > SEV_IDX[f.previousComposite];
  const forceTo = () => { onNavigate("osint"); window.dispatchEvent(new CustomEvent("osint:set-pane", { detail: "crisis" })); };
  for (const f of forceWatch.filter((x) => x.composite === "red").slice(0, 3)) {
    const e = escalated(f);
    urgent.push({
      id: `force-${f.id}`, rank: e ? -3 : -2, tone: "red", icon: "🛡",
      label: f.label, sub: (e ? `↑ escalated from ${f.previousComposite!.toUpperCase()} — ` : "") + f.topDriver, meta: COCOM_SHORT[f.cocom] || "Force",
      onClick: forceTo,
    });
  }
  for (const f of forceWatch.filter((x) => x.composite === "amber").slice(0, 2)) {
    const e = escalated(f);
    urgent.push({
      id: `force-${f.id}`, rank: e ? -1 : 1, tone: "amber", icon: "🛡",
      label: f.label, sub: (e ? `↑ from ${f.previousComposite!.toUpperCase()} — ` : "") + f.topDriver, meta: COCOM_SHORT[f.cocom] || "Force",
      onClick: forceTo,
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
      icon: "⌖",
      label: s.title,
      sub: s.reason || `${s.sources} source${s.sources === 1 ? "" : "s"}`,
      meta: "OSINT",
      onClick: () => onNavigate("osint"),
    });
  }

  urgent.sort((a, b) => a.rank - b.rank);
  const urgentTop = urgent.slice(0, 6);

  // ── Global Reach Watch: AMC-relevance fusion of base weather hazards (could
  //    impede airlift) + the AOR disaster watch (could pull HADR/NEO airlift),
  //    ranked into one "look here first" list. Proximity to a base outranks
  //    raw severity, then severity. ──
  const reach: { id: string; tone: "red" | "amber"; icon: string; title: string; sub: string; tag: string; score: number; href?: string; cat: ReachCat; glabel: string }[] = [];
  for (const d of threats?.disasters ?? []) {
    const near = d.nearLocations.length > 0;
    const hadr = d.hadrScore ?? (d.severity === "red" ? 60 : d.severity === "orange" ? 35 : 12);
    // Surface red, near-base, OR high HADR-relevance events (a big cyclone can
    // be "orange" yet very airlift-relevant). Distant low-relevance noise stays
    // on the Weather tab.
    if (!(d.severity === "red" || near || hadr >= 50)) continue;
    reach.push({
      id: `reach-d-${d.id}`,
      tone: d.severity === "red" || hadr >= 60 ? "red" : "amber",
      icon: REACH_DISASTER_GLYPH[d.type] ?? "⊕",
      title: d.title,
      sub: near ? `Near ${d.nearLocations.join(", ")}` : [d.country || d.type, hadr >= 55 ? "HADR-relevant" : null].filter(Boolean).join(" · "),
      tag: d.aor !== "UNKNOWN" ? d.aor : "DISASTER",
      score: hadr + (near ? 55 : 0),
      cat: "disaster", glabel: "disaster",
    });
  }
  for (const h of threats?.hazards ?? []) {
    // Hazards are at your tracked points / AMC hubs by construction.
    reach.push({
      id: `reach-h-${h.label}`,
      tone: h.severity === "severe" ? "red" : "amber",
      icon: "〜",
      title: h.label,
      sub: h.flags.join(" · "),
      tag: "WX",
      score: h.severity === "severe" ? 75 : 45,
      cat: "weather", glabel: "weather hazard",
    });
  }
  // NEO / evacuation watch: embassy ordered/authorized departures are active
  // evacuation triggers (top relevance); recent Level-4 "Do Not Travel" updates
  // (≤14 d, capped) signal escalation. Standing Level-4 status is intentionally
  // not surfaced here — it's context, not an alert.
  let l4shown = 0;
  for (const a of advisories) {
    const evac = a.orderedDeparture || a.authorizedDeparture;
    const recentL4 = a.level === 4 && !!a.pubDate && Date.now() - Date.parse(a.pubDate) < 14 * 86_400_000;
    if (!evac && !recentL4) continue;
    if (!evac && recentL4) { if (l4shown >= 2) continue; l4shown++; }
    reach.push({
      id: `reach-a-${a.country}`,
      tone: a.orderedDeparture ? "red" : "amber",
      icon: evac ? "🛫" : "⛔",
      title: a.country,
      sub: a.orderedDeparture
        ? `Ordered departure — evacuation${a.level ? ` · Level ${a.level}` : ""}`
        : a.authorizedDeparture
        ? `Authorized departure${a.level ? ` · Level ${a.level}` : ""}`
        : "Level 4 — Do Not Travel (recent update)",
      tag: a.aor !== "UNKNOWN" ? a.aor : "NEO",
      score: a.orderedDeparture ? 120 : a.authorizedDeparture ? 85 : 50,
      href: a.link,
      cat: "neo", glabel: a.orderedDeparture ? "ordered departure" : a.authorizedDeparture ? "authorized departure" : "Level-4 update",
    });
  }
  // Access degraders from the Force-Protection feed (cached): per watched base/
  // country, surface each elevated conflict / airspace / GPS axis as its own row.
  for (const a of forceWatch) {
    for (const { axis, cat, noun, red, amber } of FP_AXES) {
      const c = a.categories.find((x) => x.category === axis);
      if (!c || (c.severity !== "red" && c.severity !== "amber")) continue;
      reach.push({
        id: `reach-fp-${axis}-${a.id}`,
        tone: c.severity === "red" ? "red" : "amber",
        icon: REACH_CAT_META[cat].icon,
        title: a.label,
        sub: c.signals[0] ?? noun,
        tag: a.cocom && a.cocom !== "UNKNOWN" ? a.cocom : REACH_CAT_META[cat].label.toUpperCase(),
        score: c.severity === "red" ? red : amber,
        cat, glabel: noun,
        ...(c.links?.[0]?.url ? { href: c.links[0].url } : {}),
      });
    }
  }

  reach.sort((a, b) => b.score - a.score);

  // De-crowd: when a category floods (≥ GROUP_AT) collapse it to one summary
  // row so disasters & weather aren't evicted by a wave of evacuations. Filter
  // chips slice to a single category (flat). Counts stay visible regardless.
  type ReachItem = (typeof reach)[number];
  type ReachEntry =
    | { kind: "item"; item: ReachItem; score: number }
    | { kind: "group"; cat: ReachCat; items: ReachItem[]; score: number; tone: "red" | "amber" };
  const GROUP_AT = 3;
  const reachCounts: Record<ReachCat, number> = { neo: 0, disaster: 0, weather: 0, conflict: 0, gps: 0, airspace: 0 };
  for (const r of reach) reachCounts[r.cat]++;
  const reachEntries: ReachEntry[] = (() => {
    if (reachFilter !== "all") {
      return reach.filter((r) => r.cat === reachFilter).slice(0, 10).map((item) => ({ kind: "item" as const, item, score: item.score }));
    }
    const byCat: Record<ReachCat, ReachItem[]> = { neo: [], disaster: [], weather: [], conflict: [], gps: [], airspace: [] };
    for (const r of reach) byCat[r.cat].push(r);
    const out: ReachEntry[] = [];
    REACH_CAT_ORDER.forEach((cat) => {
      const items = byCat[cat];
      if (items.length === 0) return;
      if (items.length >= GROUP_AT) out.push({ kind: "group", cat, items, score: items[0].score, tone: items.some((i) => i.tone === "red") ? "red" : "amber" });
      else for (const it of items) out.push({ kind: "item", item: it, score: it.score });
    });
    return out.sort((a, b) => b.score - a.score).slice(0, 9);
  })();
  const reachRow = (r: ReachItem) => {
    const cls = `group w-full text-left flex items-start gap-3 px-3 py-2 border-l-2 ${r.tone === "red" ? "border-l-red-500/70" : "border-l-amber-500/70"} hover:bg-slate-800/40 transition-colors rounded-r`;
    const inner = (
      <>
        <span className={`mt-0.5 flex-shrink-0 ${r.tone === "red" ? "text-red-400" : "text-amber-400"}`}>{r.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-200 truncate group-hover:text-emerald-400 transition-colors">{r.title}</span>
          {r.sub && <span className="block text-[11px] text-slate-500 truncate">{r.sub}</span>}
        </span>
        <span className="text-[8px] font-mono uppercase tracking-wider text-sky-400/80 border border-sky-500/30 rounded px-1 py-0.5 flex-shrink-0 mt-0.5">{r.tag}</span>
      </>
    );
    return r.href
      ? <a href={r.href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
      : <button onClick={() => onNavigate("weather")} className={`${cls} w-full`}>{inner}</button>;
  };

  // ── Derived: today's schedule ──
  const todayEvents = calendarEvents
    .filter((e) => eventCoversLocalDate(e, localDateStr(0), startOfToday(), endOfToday()))
    .sort((a, b) => ms(a.start) - ms(b.start))
    .slice(0, 6);
  const tomorrowEvents = calendarEvents
    .filter((e) => eventCoversLocalDate(e, localDateStr(1), startOfTomorrow(), endOfTomorrow()))
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

  // ── On-your-radar metrics + change detection ─────────────────────────────
  // Baseline = the values the last time you viewed Glance, so we can highlight
  // what has risen since. Read once (frozen for this session).
  const radarMetricsRaw: { key: string; label: string; value: number; display: string; tier: RadarTier; onClick: () => void }[] = [
    {
      key: "news", label: "New stories",
      value: newStories, display: `${newStories} new`,
      tier: newStories > 0 ? "attention" : "quiet",
      onClick: () => onNavigate("news"),
    },
    {
      key: "email", label: "Priority email",
      value: newEmails, display: `${newEmails} new`,
      tier: newEmails > 0 ? "attention" : "quiet",
      onClick: () => onNavigate("email"),
    },
    {
      key: "osint", label: "OSINT signals",
      value: osintSignals, display: `${osintSignals} new`,
      tier: osintSignals > 0 ? "attention" : "quiet",
      onClick: () => onNavigate("osint"),
    },
  ];
  if (threats && (threats.summary.total > 0 || threats.tropical.length > 0)) {
    radarMetricsRaw.push({
      key: "severe", label: "Severe weather",
      value: threats.summary.total + threats.tropical.length,
      display:
        threats.summary.lifeThreatening > 0
          ? `${threats.summary.lifeThreatening} life-threatening`
          : threats.tropical.length > 0
          ? `${threats.tropical.length} tropical system${threats.tropical.length === 1 ? "" : "s"}`
          : `${threats.summary.total} alert${threats.summary.total === 1 ? "" : "s"}`,
      tier: threats.summary.lifeThreatening > 0 ? "critical" : "attention",
      onClick: () => onNavigate("weather"),
    });
  }
  if (threats && threats.summary.disasters > 0) {
    radarMetricsRaw.push({
      key: "disasters", label: "Disasters",
      value: threats.summary.disasters,
      display: `${threats.summary.disasters} active${threats.summary.disastersRed > 0 ? ` · ${threats.summary.disastersRed} red` : ""}`,
      tier: threats.summary.disastersRed > 0 ? "critical" : "attention",
      onClick: () => onNavigate("weather"),
    });
  }

  const TIER_RANK: Record<RadarTier, number> = { critical: 0, attention: 1, quiet: 2 };
  const radarMetrics = radarMetricsRaw
    .map((m) => {
      const delta = m.value - (radarBaseline[m.key] ?? 0);
      const changed = delta > 0;
      // A rise on an otherwise-quiet metric still deserves an amber nudge.
      const tier: RadarTier = changed && m.tier === "quiet" ? "attention" : m.tier;
      return { ...m, delta, changed, tier };
    })
    .sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        Number(b.changed) - Number(a.changed) ||
        b.value - a.value,
    );
  const radarNewCount = radarMetrics.filter((m) => m.changed).length;

  // Acknowledge the changes after a short dwell (a quick tab-flip won't reset
  // the highlights; an actual look will). Writes the new baseline for next time.
  const radarValuesKey = radarMetricsRaw.map((m) => `${m.key}:${m.value}`).join(",");
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const snapshot: Record<string, number> = {};
    for (const m of radarMetricsRaw) snapshot[m.key] = m.value;
    const t = setTimeout(() => {
      try { localStorage.setItem(RADAR_BASELINE_KEY, JSON.stringify(snapshot)); } catch { /* ignore */ }
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, radarValuesKey]);

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
              <BriefIcon size={15} strokeWidth={2.5} className="leading-none" /> Morning Brief
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

      {/* ── Global Reach Watch: NEO / disasters / weather, de-crowded ── */}
      {reach.length > 0 && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-4 card-hover">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 text-amber-400 text-[11px] font-bold uppercase tracking-widest">
              <ReachIcon size={15} strokeWidth={2.5} className="leading-none" /> Global Reach Watch
            </div>
            <span
              className="text-[10px] text-slate-600 font-mono hidden sm:block"
              title="Crises that could pull airlift (HADR/NEO) plus weather that could impede it, ranked by proximity to your bases. Tap a row to open the Weather tab."
            >
              crises &amp; weather affecting reach
            </span>
          </div>
          {/* Category filter chips — counts always visible even when collapsed */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {([["all", "All", reach.length], ...REACH_CAT_ORDER.map((c) => [c, `${REACH_CAT_META[c].icon} ${REACH_CAT_META[c].label}`, reachCounts[c]] as [ReachCat, string, number])] as [("all" | ReachCat), string, number][])
              .filter(([key, , n]) => key === "all" || n > 0)
              .map(([key, label, n]) => (
                <button
                  key={key}
                  onClick={() => setReachFilter(key)}
                  className={`text-[10px] font-mono rounded px-2 py-0.5 border transition-colors inline-flex items-center gap-1 ${reachFilter === key ? "border-amber-500/50 bg-amber-500/15 text-amber-200" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}
                >
                  {label} <span className="opacity-60">{n}</span>
                </button>
              ))}
          </div>
          <ul className="space-y-1.5">
            {reachEntries.map((e) => {
              if (e.kind === "item") return <li key={e.item.id}>{reachRow(e.item)}</li>;
              const open = reachGroupsOpen.has(e.cat);
              const nouns = new Set(e.items.map((i) => i.glabel));
              const FALLBACK_NOUN: Record<ReachCat, string> = { neo: "evacuation/NEO advisory", disaster: "disaster", weather: "weather hazard", conflict: "conflict alert", gps: "GPS/EW alert", airspace: "airspace NOTAM" };
              const noun = nouns.size === 1 ? [...nouns][0] : FALLBACK_NOUN[e.cat];
              const cls = `group w-full text-left flex items-start gap-3 px-3 py-2 border-l-2 ${e.tone === "red" ? "border-l-red-500/70" : "border-l-amber-500/70"} hover:bg-slate-800/40 transition-colors rounded-r`;
              return (
                <li key={`grp-${e.cat}`}>
                  <button
                    onClick={() => setReachGroupsOpen((prev) => { const n = new Set(prev); n.has(e.cat) ? n.delete(e.cat) : n.add(e.cat); return n; })}
                    className={`${cls} w-full`}
                  >
                    <span className={`mt-0.5 flex-shrink-0 ${e.tone === "red" ? "text-red-400" : "text-amber-400"}`}>{REACH_CAT_META[e.cat].icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-200 group-hover:text-emerald-400 transition-colors"><span className="text-slate-500 text-[10px] mr-1">{open ? "▾" : "▸"}</span>{e.items.length} {pluralize(noun, e.items.length)}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{aorBreakdown(e.items)}</span>
                    </span>
                  </button>
                  {open && (
                    <ul className="space-y-1 mt-1 pl-6">
                      {e.items.map((it) => <li key={it.id}>{reachRow(it)}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
                          {unseen && <span title="New since your last visit" className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-200 leading-snug group-hover:text-emerald-400 line-clamp-2">
                              {n.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                              <span className="truncate">{n.source}</span>
                              <span className="text-slate-700">·</span>
                              <span className="flex-shrink-0">{relTime(n.pubDate)}</span>
                              {fresh && (
                                <span title="Published in the last 45 minutes" className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider text-red-400 border border-red-500/40 rounded px-1 py-px">
                                  Live
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </a>
                      <div className="px-3 pb-2.5 -mt-1">
                        <ArticleThesis article={n} />
                      </div>
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
                  <ScheduleRow key={e.id} e={e} onNavigate={onNavigate} />
                ))}
              </ul>
            )}
          </Panel>

          {/* Tomorrow */}
          <Panel title="Tomorrow" onJump={() => onNavigate("calendar")}>
            {tomorrowEvents.length === 0 ? (
              <Empty>Nothing on the calendar tomorrow.</Empty>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {tomorrowEvents.map((e) => (
                  <ScheduleRow key={e.id} e={e} onNavigate={onNavigate} />
                ))}
              </ul>
            )}
          </Panel>

          {/* Context */}
          <Panel
            title="On your radar"
            badge={
              radarNewCount > 0 ? (
                <span
                  title={`${radarNewCount} signal${radarNewCount === 1 ? "" : "s"} changed since you last looked`}
                  className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5 animate-pulse"
                >
                  {radarNewCount} new
                </span>
              ) : undefined
            }
          >
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

              {/* Live signals, sorted most-urgent first with change highlights. */}
              <div className="space-y-1.5">
                {radarMetrics.map((m) => (
                  <RadarLine
                    key={m.key}
                    label={m.label}
                    value={m.display}
                    tier={m.tier}
                    changed={m.changed}
                    delta={m.delta}
                    onClick={m.onClick}
                  />
                ))}
              </div>

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
  badge,
}: {
  title: string;
  children: React.ReactNode;
  accent?: boolean;
  onJump?: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-800/30">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className={`text-[11px] font-bold uppercase tracking-widest ${accent ? "text-emerald-400" : "text-slate-400"}`}>
            {title}
          </h3>
          {badge}
        </div>
        {onJump && (
          <button
            onClick={onJump}
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-emerald-400 transition-colors flex-shrink-0"
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

type RadarTier = "quiet" | "attention" | "critical";

function RadarLine({
  label,
  value,
  tier,
  changed,
  delta,
  onClick,
}: {
  label: string;
  value: string;
  tier: RadarTier;
  changed: boolean;
  delta: number;
  onClick: () => void;
}) {
  const valueTone =
    tier === "critical" ? "text-red-400" : tier === "attention" ? "text-amber-400" : "text-slate-500";
  const showDot = tier === "critical" || changed;
  const dotColor = tier === "critical" ? "bg-red-500" : "bg-amber-400";
  return (
    <button
      onClick={onClick}
      title={changed ? `Up ${delta} since you last looked` : undefined}
      className="w-full flex items-center justify-between text-left group gap-2"
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {showDot && (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor} ${changed ? "animate-pulse" : ""}`} />
        )}
        <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors truncate">{label}</span>
      </span>
      <span className="flex items-center gap-1.5 flex-shrink-0">
        {changed && delta > 0 && <span className="text-[10px] font-bold text-emerald-400">▲ +{delta}</span>}
        <span className={`text-xs font-semibold ${valueTone}`}>{value}</span>
      </span>
    </button>
  );
}
