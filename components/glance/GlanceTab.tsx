"use client";

import { useCallback, useEffect, useState } from "react";
import { openTrackPicker } from "@/lib/trackClient";
import { toast } from "@/lib/feedback";
import { renderOeBriefHtml, oeBriefFilename } from "@/lib/oeBriefExport";
import { renderOeBriefViewerHtml } from "@/lib/oeBriefViewer";
import { detectPostureMoves, mergePostureMoves, newsletterBulletsAsItems, MOVE_LABEL, SIDE_LABEL, type PostureMove } from "@/lib/postureMoves";
import type { MissionProfile } from "@/lib/missionProfile";
import OeDeltaCard from "@/components/glance/OeDeltaCard";
import DemandHorizonCard from "@/components/glance/DemandHorizonCard";
import StatusRow from "@/components/glance/StatusRow";
import WorldClocks from "@/components/glance/WorldClocks";
import WhereYouAre from "@/components/glance/WhereYouAre";
import { useEffectiveZone, type EffectiveZone } from "@/lib/zoneClient";
import { ymdInZone, addDays, zoneDayStartMs, zoneDayEndMs, timeInZone, zoneLabel } from "@/lib/effectiveZone";
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
// Local mirror of lib/sitrep's SitrepSummary (same pattern as Briefing below).
interface GlanceSitrep {
  icao: string;
  label: string;
  status: { wx: string; ops: string; threat: string; infra: string };
  driver: string;
  worse: string[];
}

interface Briefing {
  headline: string;
  generatedAtMs?: number;
  weather?: string[];  // travel-aware day forecast lines (home · TDY · destinations)
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
  onNavigate: (tab: Tab) => void;
  onOpenBrief: () => void;
  onOpenDigest: () => void;
  onOpenCapture?: () => void;
}

// ───────────────────────── time helpers ─────────────────────────

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
// A Today/Tomorrow agenda row: time + title jumps to the Calendar; the quick
// actions (AI-edit / edit / nudge / delete) come from the same shared cluster as
// the Calendar upcoming view, so the two surfaces behave identically.
// The time is rendered in the EFFECTIVE zone (pin › active trip › device) and
// is never shown without its zone label; when that differs from the device
// zone the tooltip gives both, so "10:00 AM GMT+3" on a laptop still set to
// New Jersey is read as what it is (REVIEW-2026-10 G10).
function ScheduleRow({ e, zone, onNavigate }: { e: CalendarEvent; zone: EffectiveZone; onNavigate: (tab: Tab) => void }) {
  const a = useEventActions(e);
  const t = ms(e.start);
  const timed = !e.isAllDay && t > 0;
  const label = timed ? zoneLabel(zone.zone, t) : "";
  const deviceDiffers = timed && zone.device && zone.device !== zone.zone;
  const tip = timed
    ? `${timeInZone(t, zone.zone)} ${label}${zone.source === "trip" ? " (TDY zone)" : zone.source === "pinned" ? " (pinned zone)" : ""}${deviceDiffers ? ` · ${timeInZone(t, zone.device!)} ${zoneLabel(zone.device!, t)} on this device` : ""}`
    : "All day";
  return (
    <li className="group hover:bg-slate-800/40 transition-colors">
      <div className="flex items-center">
        <button onClick={() => onNavigate("calendar")} title={tip} className="flex-1 min-w-0 text-left flex items-baseline gap-3 px-3 py-2.5">
          <span className="text-[11px] font-mono font-semibold text-emerald-400 w-[4.5rem] sm:w-24 flex-shrink-0 whitespace-nowrap">
            {timed ? <>{timeInZone(t, zone.zone)} <span className="text-[9px] text-emerald-600 font-normal">{label}</span></> : "All day"}
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

function greeting(d: Date): string {
  const h = d.getHours();
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
// Does an event cover the given calendar date IN THE EFFECTIVE ZONE? All-day
// events carry floating date-only start/end (end EXCLUSIVE) and must be
// compared as calendar dates — converting them to an instant parses them as
// UTC midnight, which in behind-UTC zones lands on the previous evening and
// leaks an all-day holiday (e.g. "Flag Day") into BOTH today and tomorrow.
// Timed events keep instant math against the zone's day bounds.
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
    const endExclusive = rawEnd && rawEnd > s ? rawEnd : addDays(s, 1);
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
  onNavigate,
  onOpenBrief,
  onOpenDigest,
  onOpenCapture,
}: GlanceTabProps) {
  const { status } = useSession();
  useCacheTick(active);
  // The effective zone (pin › active trip › device): Today/Tomorrow are
  // bucketed in it and every time is labelled with it.
  const zone = useEffectiveZone();

  const [tasks, setTasks] = useState<GoogleTask[]>([]);
  const [completingTasks, setCompletingTasks] = useState<Set<string>>(new Set());
  const [threats, setThreats] = useState<WeatherThreats | null>(null);
  const [advisories, setAdvisories] = useState<TravelAdvisory[]>([]);
  const [reachFilter, setReachFilter] = useState<"all" | ReachCat>("all");
  const [reachGroupsOpen, setReachGroupsOpen] = useState<Set<ReachCat>>(new Set());
  // Force Protection Watch — RED/AMBER locations surface in needs-you-now.
  const [forceWatch, setForceWatch] = useState<ForceWatchItem[]>([]);
  // The declared hub/spokes (Mission Profile) — what "mine" means on the
  // Global Reach list. One cheap GET, cached 10 min; no model call.
  const [profile, setProfile] = useState<MissionProfile | null>(null);
  useEffect(() => {
    if (!active) return;
    const cached = clientCache.peek<MissionProfile | null>("mission:profile");
    if (cached !== undefined && clientCache.isFresh("mission:profile")) { setProfile(cached); return; }
    fetch("/api/mission-profile").then((r) => (r.ok ? r.json() : null)).then((j) => {
      const prof = (j && j.profile) ? (j.profile as MissionProfile) : null;
      clientCache.set("mission:profile", prof, 10 * 60 * 1000);
      setProfile(prof);
    }).catch(() => {});
  }, [active]);
  // Force-posture moves from the server sweep of the defense feeds
  // (/api/posture-moves, deterministic, 15-min cache); merged below with the
  // same detector run over the articles + newsletters this client holds.
  const [serverMoves, setServerMoves] = useState<PostureMove[] | null>(null);
  // Rising threads from the News tab's latest stored session (today or
  // yesterday) — one row at the top of Breaking & critical (REVIEW-2026-10
  // N11). Stored rows, no model call, one cheap GET when Glance is active.
  const [risingThreads, setRisingThreads] = useState<{ date: string; labels: string[] } | null>(null);
  useEffect(() => {
    if (!active) return;
    fetch("/api/thread-history?view=sessions&days=2").then((r) => (r.ok ? r.json() : null)).then((d) => {
      const s = Array.isArray(d?.sessions) ? d.sessions[0] : null;
      if (!s) return;
      const labels = (s.threads as { label: string; trend: string }[]).filter((t) => t.trend === "rising").map((t) => t.label);
      setRisingThreads({ date: s.date, labels });
    }).catch(() => {});
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = async (attempt = 0) => {
      try {
        const r = await fetch("/api/posture-moves", { cache: "no-store" });
        const j = r.ok ? await r.json() : null;
        if (cancelled || !j) return;
        if (Array.isArray(j.moves)) setServerMoves(j.moves);
        if (j.pending && attempt < 3) retry = setTimeout(() => load(attempt + 1), 10_000);
      } catch { /* the client-side detector still runs */ }
    };
    load();
    const id = setInterval(() => load(), 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); if (retry) clearTimeout(retry); };
  }, [active]);

  // Header greeting + date are LOCAL-time derived. Rendering them during SSR
  // computes them in the server's (UTC) zone/locale, then the client recomputes
  // in the browser's local zone — a mismatch across a greeting-hour or midnight
  // boundary throws React hydration error #418. Compute on the client only:
  // null until mounted, so server and first client render agree on the fallback.
  const [nowLocal, setNowLocal] = useState<Date | null>(null);
  useEffect(() => { setNowLocal(new Date()); }, []);

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

  // Base SITREP LED strip — the same deterministic per-base rollup the Brief
  // modal shows, finally on the surface you actually start the day on. The
  // summary endpoint reads the 10-min-cached assembly, so poll slowly.
  const [sitreps, setSitreps] = useState<GlanceSitrep[]>([]);
  useEffect(() => {
    if (!active || status !== "authenticated") return;
    let cancelled = false;
    const load = () => {
      fetch("/api/sitrep/summary")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { bases?: GlanceSitrep[] } | null) => { if (!cancelled && Array.isArray(d?.bases)) setSitreps(d.bases); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
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
  const overdueTaskCount = dueTasks.filter((x) => x.state === "overdue").length;

  // Complete a task inline from the pinned "Your actions" group — optimistic
  // (drops it from the list immediately + updates the shared cache the Calendar
  // rail reads), reverting if the PATCH fails so a task never silently "un-does".
  const completeTask = (id: string) => {
    setCompletingTasks((prev) => new Set(prev).add(id));
    const flip = (status: GoogleTask["status"]) =>
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === id ? { ...t, status } : t));
        clientCache.set("tasks:items", next, 5 * 60 * 1000);
        return next;
      });
    flip("completed");
    fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "completed" }),
    })
      .then((r) => { if (!r.ok) throw new Error("patch failed"); })
      .catch(() => flip("needsAction"))
      .finally(() => setCompletingTasks((prev) => { const n = new Set(prev); n.delete(id); return n; }));
  };

  // Defer a task to tomorrow, one click — the "not today" affordance. Optimistic
  // (the row leaves the due list immediately since it's no longer due today),
  // reverting to the original due date if the PATCH fails.
  const deferTask = (id: string) => {
    const orig = tasks.find((t) => t.id === id)?.due;
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T00:00:00.000Z`;
    setCompletingTasks((prev) => new Set(prev).add(id));
    const setDue = (due: string | undefined) =>
      setTasks((prev) => {
        const next = prev.map((t) => (t.id === id ? { ...t, due } : t));
        clientCache.set("tasks:items", next, 5 * 60 * 1000);
        return next;
      });
    setDue(tomorrow);
    fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, due: tomorrow }),
    })
      .then((r) => { if (!r.ok) throw new Error("patch failed"); })
      .catch(() => setDue(orig))
      .finally(() => setCompletingTasks((prev) => { const n = new Set(prev); n.delete(id); return n; }));
  };

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

  // NOTE: due/overdue tasks are deliberately NOT merged into this world-state
  // list — they render in their own pinned "Your actions" group at the top of
  // the panel (see below) so personal action items never get sorted below, or
  // sliced off behind, a busy news/alert day.

  // High-priority email is YOURS to answer, not world state: it renders in the
  // violet "Your actions" group under the tasks (REVIEW-2026-10 G8), never
  // among the red rows — a sender asking for a reply is a different kind of
  // urgency from a base going RED.
  const emailAsks = emails
    .filter((e) => e.priority === "High")
    .slice(0, 5)
    .map((e) => ({ id: `email-${e.id}`, unseen: ms(e.date) > previousSeen.email, label: e.subject || "(no subject)", sub: `${senderName(e.from)}${e.summary ? ` — ${e.summary}` : ""}`, meta: relTime(e.date) }))
    .sort((a, b) => Number(b.unseen) - Number(a.unseen));

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

  // "View all →" follows the DOMINANT source of the current rows (it used to
  // hard-code Email, misrouting a weather- or force-heavy day). Row id prefixes
  // carry the source; ties break toward the topmost (most urgent) row.
  const urgentJumpTarget = ((): Parameters<typeof onNavigate>[0] | null => {
    if (urgentTop.length === 0) return null;
    const destOf = (id: string): Parameters<typeof onNavigate>[0] =>
      id.startsWith("email-") ? "email"
      : id.startsWith("wx-") || id.startsWith("disaster-") ? "weather"
      : "osint"; // force-* and osint-* both live on the OSINT tab
    const counts = new Map<string, number>();
    for (const u of urgentTop) counts.set(destOf(u.id), (counts.get(destOf(u.id)) ?? 0) + 1);
    let best = destOf(urgentTop[0].id), bestN = 0;
    for (const u of urgentTop) {
      const d = destOf(u.id), n = counts.get(d) ?? 0;
      if (n > bestN) { best = d; bestN = n; }
    }
    return best;
  })();

  // ── Global Reach Watch: AMC-relevance fusion of base weather hazards (could
  //    impede airlift) + the AOR disaster watch (could pull HADR/NEO airlift),
  //    ranked into one "look here first" list. Proximity to a base outranks
  //    raw severity, then severity. ──
  const reach: { id: string; tone: "red" | "amber"; icon: string; title: string; sub: string; tag: string; score: number; href?: string; cat: ReachCat; glabel: string; country?: string }[] = [];
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
      ...(d.country ? { country: d.country } : {}),
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
      country: a.country,
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

  // "Mine" — rows that touch the declared hub / spokes (Mission Profile) or
  // the active TDY location are pinned to the top and marked (REVIEW-2026-10
  // G9): the app knows which airfields matter most; the list should too.
  const mineNames: string[] = [];
  if (profile?.home) mineNames.push(profile.home.label, profile.home.icao, profile.home.country);
  else if (profile?.homeIcao) mineNames.push(profile.homeIcao);
  for (const sp of profile?.spokes ?? []) mineNames.push(sp.label, sp.icao, sp.country);
  if (zone.trip?.label) mineNames.push(zone.trip.label.split(/[,(]/)[0]);
  const mineRe = mineNames.map((n) => n.trim()).filter((n) => n.length >= 3).map((n) => new RegExp(`(?<![A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "i"));
  const isMine = (r: { title: string; sub: string }) => mineRe.some((re) => re.test(`${r.title} ${r.sub}`));
  const reachMine = new Set<string>();
  for (const r of reach) if (isMine(r)) { reachMine.add(r.id); r.score += 200; }

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
    const out: ReachEntry[] = [];
    // Mine rows never fold into a category group — they are the point.
    for (const r of reach) { if (reachMine.has(r.id)) out.push({ kind: "item", item: r, score: r.score }); else byCat[r.cat].push(r); }
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
        {reachMine.has(r.id) && (
          <span title="Touches your declared hub / spokes or your TDY location" className="text-[8px] font-mono uppercase tracking-wider text-violet-300 border border-violet-500/40 bg-violet-500/10 rounded px-1 py-0.5 flex-shrink-0 mt-0.5">mine</span>
        )}
        <span className="text-[8px] font-mono uppercase tracking-wider text-sky-400/80 border border-sky-500/30 rounded px-1 py-0.5 flex-shrink-0 mt-0.5">{r.tag}</span>
      </>
    );
    const row = r.href
      ? <a href={r.href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
      : <button onClick={() => onNavigate("weather")} className={`${cls} w-full`}>{inner}</button>;
    // A row that names a country NOT in the posture watch gets a Track chip
    // beside it (a sibling, never nested — the row is itself a link/button).
    const named = r.country;
    const unwatched = !!named && !forceWatch.some((f) => f.country.toLowerCase() === named.toLowerCase() || f.label.toLowerCase() === named.toLowerCase());
    return unwatched ? (
      <div className="flex items-stretch gap-1">
        <div className="min-w-0 flex-1">{row}</div>
        <button onClick={() => openTrackPicker({ kind: "country", country: named })} title={`${named} is not in the posture watch — track it`}
          className="self-center flex-shrink-0 text-[8px] font-bold uppercase tracking-wider text-emerald-300/80 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-1 py-0.5">track</button>
      </div>
    ) : row;
  };

  // ── Derived: today's schedule ──
  const todayYmd = ymdInZone(Date.now(), zone.zone);
  const tomorrowYmd = addDays(todayYmd, 1);
  const todayEvents = calendarEvents
    .filter((e) => eventCoversLocalDate(e, todayYmd, zoneDayStartMs(todayYmd, zone.zone), zoneDayEndMs(todayYmd, zone.zone)))
    .sort((a, b) => ms(a.start) - ms(b.start))
    .slice(0, 6);
  const tomorrowEvents = calendarEvents
    .filter((e) => eventCoversLocalDate(e, tomorrowYmd, zoneDayStartMs(tomorrowYmd, zone.zone), zoneDayEndMs(tomorrowYmd, zone.zone)))
    .sort((a, b) => ms(a.start) - ms(b.start))
    .slice(0, 6);
  const scheduleZoneNote = zone.source === "trip" && zone.trip
    ? `${zone.label} · TDY ${zone.trip.label}`
    : zone.source === "pinned" ? `${zone.label} · pinned` : zone.label;

  // ── Derived: breaking & critical ──
  const criticalSource =
    curated && curated.critical.length > 0
      ? curated.critical
      : [...articles].sort((a, b) => ms(b.pubDate) - ms(a.pubDate));
  const breaking = criticalSource.slice(0, 5);

  // ── Derived: force-posture moves — the server sweep merged with this
  //    client's own reading of its articles + newsletter bullets (pure
  //    detector, same grammar both sides). ──
  const localMoves = detectPostureMoves([...articles, ...newsletterBulletsAsItems(newsletters)]);
  const postureMoves = mergePostureMoves(serverMoves ?? [], localMoves).slice(0, 6);
  const movesLoading = serverMoves === null && articles.length === 0;

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
  // Brief fold — remembered per browser; default open so the first visit
  // reads the overview. The key was bumped (v2) when the open state became
  // the full overview: a fold remembered against the old one-liner would
  // otherwise keep the new overview hidden on a browser that never chose that.
  const [briefOpen, setBriefOpen] = useState(true);
  useEffect(() => {
    try { setBriefOpen(localStorage.getItem("glance.briefOpen.v2") !== "0"); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("glance.briefOpen.v2", briefOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [briefOpen]);

  // One-page OE brief: fetch the snapshot, render the standalone HTML in the
  // browser (lib/oeBriefExport, pure), download. Also reachable from the
  // command palette via the `oebrief:export` event.
  const [exporting, setExporting] = useState(false);
  const exportOeBrief = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    // Open the viewer tab NOW, inside the click, so a popup blocker does not
    // eat it; fill it when the snapshot lands. If the browser refuses, fall
    // back to the plain download (2026-10-05: "should pop up in browser view").
    let win: Window | null = null;
    try {
      win = window.open("", "_blank");
      if (win) {
        win.document.write('<!doctype html><title>OE brief — building…</title><body style="margin:0;background:#0b1220;color:#94a3b8;font:14px -apple-system,Segoe UI,Roboto,sans-serif;padding:24px">Building the OE brief from the live picture…</body>');
      }
    } catch { win = null; }
    try {
      const r = await fetch("/api/oe-brief", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(j.error || "Could not build the OE brief."); win?.close(); return; }
      const html = renderOeBriefHtml(j);
      const name = oeBriefFilename(j.snapshot.atISO);
      if (win && !win.closed) {
        win.document.open();
        win.document.write(renderOeBriefViewerHtml(html, name));
        win.document.close();
        toast.ok("OE brief opened in a new tab — Download HTML or Print / save as PDF from its toolbar.");
        return;
      }
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.ok("OE brief downloaded — standalone HTML, no scripts. (Allow pop-ups to open it in a tab next time.)");
    } catch (e) {
      win?.close();
      toast.error(`OE brief failed: ${(e as Error).message}`);
    } finally { setExporting(false); }
  }, [exporting]);
  useEffect(() => {
    const on = () => { void exportOeBrief(); };
    window.addEventListener("oebrief:export", on);
    return () => window.removeEventListener("oebrief:export", on);
  }, [exportOeBrief]);

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
            {nowLocal ? greeting(nowLocal) : "Welcome"}, DEAD
          </h2>
          <p className="text-xs uppercase tracking-widest text-slate-500 mt-0.5" suppressHydrationWarning>
            {nowLocal
              ? nowLocal.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
              : " "}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider">
          <button
            onClick={exportOeBrief}
            disabled={exporting}
            title="Open the one-page OE brief in a new tab — Download HTML (no scripts) or Print / save as PDF from there"
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 transition-colors disabled:opacity-50"
          >
            ⇩ {exporting ? "Building…" : "OE brief"}
          </button>
          {onOpenCapture && (
            <button
              onClick={onOpenCapture}
              title="Quick capture — task, event, doc, or note"
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 transition-colors"
            >
              ＋ Capture
            </button>
          )}
        </div>
      </div>

      {/* ── World clocks: home station, the capitals that set the tempo, Zulu ── */}
      <WorldClocks />

      {/* ── Weather where you are — beside the clocks that already know where
          that is (REVIEW-2026-10 W1). Deterministic, one cached route. ── */}
      <WhereYouAre onOpen={() => onNavigate("weather")} />

      {/* ── Morning brief — right under the clocks: the first sentence of
          the day sits with the first look at the day. OPEN by default it is
          a real overview: the full headline, the key developments and the
          suggested focus (the sections a reader wants before the status
          row; schedule/stories/trends/connections stay in the modal).
          FOLDED it is one line (two on a phone) so the status row beneath
          holds still. The 2026-09-29 layout pass had made the one-liner
          the whole card, which read as "the brief is two lines now". ── */}
      <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-bold uppercase tracking-widest flex-shrink-0">
            <BriefIcon size={14} strokeWidth={2.5} className="leading-none" /> Brief
          </span>
          <button
            type="button"
            onClick={() => setBriefOpen((v) => !v)}
            aria-expanded={briefOpen}
            title={briefOpen ? "Fold the brief to one line" : briefing?.headline ?? ""}
            className={`basis-full lg:basis-auto lg:flex-1 min-w-0 text-left font-semibold text-slate-100 leading-snug ${
              briefOpen ? "text-[15px] sm:text-base" : "text-[13.5px] line-clamp-2 lg:line-clamp-1"
            }`}
          >
            {briefing
              ? briefing.headline
              : warming
                ? "Pulling your news, mail and calendar together…"
                : "Your brief is being generated from today's news and newsletters."}
          </button>
          <span className="text-[10px] font-mono text-slate-600 flex-shrink-0 hidden sm:inline">
            {briefing?.generatedAtMs
              ? new Date(briefing.generatedAtMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
              : ""}
          </span>
          {briefing && ((briefing.suggestedFocus?.length ?? 0) > 0 || (briefing.keyDevelopments?.length ?? 0) > 0) && (
            <button
              type="button"
              onClick={() => setBriefOpen((v) => !v)}
              aria-expanded={briefOpen}
              className="text-[10px] font-semibold text-slate-500 hover:text-emerald-300 flex-shrink-0 whitespace-nowrap"
            >
              {briefOpen ? "▾ fold" : `▸ ${(briefing.keyDevelopments?.length ?? 0) + (briefing.suggestedFocus?.length ?? 0)} points`}
            </button>
          )}
          <span className="flex gap-2 flex-shrink-0 ml-auto">
            <button
              onClick={onOpenBrief}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md transition-all whitespace-nowrap"
            >
              Full brief
            </button>
            <button
              onClick={onOpenDigest}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 text-slate-300 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md transition-all whitespace-nowrap"
            >
              Digest
            </button>
          </span>
        </div>
        {briefOpen && briefing && ((briefing.keyDevelopments?.length ?? 0) > 0 || (briefing.suggestedFocus?.length ?? 0) > 0 || (briefing.weather?.length ?? 0) > 0) && (
          <div className="px-4 pb-3.5 pt-2.5 border-t border-emerald-500/15 grid gap-x-6 gap-y-3 md:grid-cols-2">
            {/* The brief's travel-aware weather lines (home · TDY · today's
                destinations) — already in the cached brief, rendered only in
                the modal before (REVIEW-2026-10 W1). Zero cost. */}
            {(briefing.weather?.length ?? 0) > 0 && (
              <div className="min-w-0 md:col-span-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-sky-400/80 mb-1.5">Weather &amp; travel</p>
                <ul className="space-y-1 sm:columns-2 sm:gap-6">
                  {briefing.weather!.slice(0, 4).map((w, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-slate-300 leading-snug break-inside-avoid">
                      <span className="text-sky-500 mt-0.5 flex-shrink-0">☼</span>
                      <span className="min-w-0">{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(briefing.keyDevelopments?.length ?? 0) > 0 && (
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/80 mb-1.5">Key developments</p>
                <ul className="space-y-1.5">
                  {briefing.keyDevelopments.slice(0, 5).map((d, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-300 leading-snug">
                      <span className="text-slate-500 mt-0.5 flex-shrink-0">•</span>
                      <span className="min-w-0">{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(briefing.suggestedFocus?.length ?? 0) > 0 && (
              <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/80 mb-1.5">Suggested focus</p>
                <ul className="space-y-1.5">
                  {briefing.suggestedFocus.slice(0, 4).map((f, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-300 leading-snug">
                      <span className="text-emerald-500 mt-0.5 flex-shrink-0">▸</span>
                      <span className="min-w-0">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Your day: Today and Tomorrow, directly under the brief (they
          sat at the bottom of the rail; "buried too far down", 2026-10-05).
          Bucketed and labelled in the effective zone. ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Panel title="Today" badge={<span className="text-[10px] font-mono text-slate-500" title={zone.source === "trip" ? "Active TDY sets the zone" : zone.source === "pinned" ? "Pinned in Preferences → Profile" : "Device zone"}>{scheduleZoneNote}</span>} onJump={() => onNavigate("calendar")}>
          {todayEvents.length === 0 ? (
            <Empty>Nothing on the calendar today.</Empty>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {todayEvents.map((e) => (
                <ScheduleRow key={e.id} e={e} zone={zone} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Tomorrow" onJump={() => onNavigate("calendar")}>
          {tomorrowEvents.length === 0 ? (
            <Empty>Nothing on the calendar tomorrow.</Empty>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {tomorrowEvents.map((e) => (
                <ScheduleRow key={e.id} e={e} zone={zone} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Hero: live status row ──
          Posture · Bases · I&W · Demand · Alerts · Family — each a live tile
          that deep-links. The north star's verb is "see changes"; a hero of
          day-cached prose could not show one. The per-base LED strip that
          used to sit below the brief is folded into the Bases tile (the
          Watch pane keeps the full strip). */}
      <StatusRow
        forceWatch={forceWatch}
        sitreps={sitreps}
        tasks={{ due: dueTasks.length, overdue: overdueTaskCount, asks: emailAsks.length, items: dueTasks.map((x) => `${x.t.title}${x.state === "overdue" ? " (overdue)" : ""}`), askItems: emailAsks.map((e) => e.label) }}
        onNavigate={onNavigate}
      />

      {/* ── What moved since you last looked ── */}
      <OeDeltaCard />

      {/* ── Needs you now — your own actions and the red rows, ABOVE the
          demand horizon and Global Reach: what moved → what needs your
          hand → where demand is going → the wider picture. ── */}
          <Panel
            title="Needs you now"
            accent
            badge={
              dueTasks.length > 0 ? (
                <span
                  title={`${overdueTaskCount} overdue · ${dueTasks.length - overdueTaskCount} due today`}
                  className={`text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border ${
                    overdueTaskCount > 0
                      ? "text-red-300 bg-red-500/15 border-red-500/30"
                      : "text-violet-300 bg-violet-500/15 border-violet-500/30"
                  }`}
                >
                  {dueTasks.length} task{dueTasks.length === 1 ? "" : "s"}
                </span>
              ) : undefined
            }
            onJump={urgentJumpTarget ? () => onNavigate(urgentJumpTarget) : undefined}
          >
            {dueTasks.length === 0 && emailAsks.length === 0 && urgentTop.length === 0 ? (
              warming ? <SkeletonRows n={3} /> : <Empty>Nothing demanding action right now.</Empty>
            ) : (
              <>
                {/* Your actions — personal to-dos, pinned above world-state so they
                    never sort below or get sliced off behind a busy alert day.
                    Distinct violet "ownership" accent + an inline complete box. */}
                {(dueTasks.length > 0 || emailAsks.length > 0) && (
                  <div className="bg-violet-500/[0.06] border-b border-violet-500/20">
                    <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-violet-300">Your actions</span>
                      <span className="text-[10px] text-slate-600 truncate">tasks and mail with your name on them</span>
                      <button
                        onClick={() => onNavigate("calendar")}
                        className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-violet-300 transition-colors flex-shrink-0"
                      >
                        Tasks →
                      </button>
                    </div>
                    <ul>
                      {dueTasks.map(({ t, state }) => {
                        const overdue = state === "overdue";
                        const busy = completingTasks.has(t.id);
                        return (
                          <li key={`task-${t.id}`}>
                            <div className="group flex items-center gap-3 px-3 py-2.5 border-l-2 border-l-violet-500/70 hover:bg-violet-500/[0.08] transition-colors">
                              <button
                                onClick={() => completeTask(t.id)}
                                disabled={busy}
                                title="Mark complete"
                                aria-label={`Mark "${t.title}" complete`}
                                className="flex-shrink-0 w-4 h-4 rounded border border-violet-400/60 hover:border-violet-300 hover:bg-violet-500/20 flex items-center justify-center text-violet-200 disabled:opacity-40"
                              >
                                {busy ? (
                                  <span className="text-[9px] leading-none animate-pulse">•</span>
                                ) : (
                                  <span className="opacity-0 group-hover:opacity-100 text-[10px] leading-none transition-opacity">✓</span>
                                )}
                              </button>
                              <button onClick={() => onNavigate("calendar")} className="min-w-0 flex-1 text-left">
                                <span className="block text-sm font-medium text-slate-200 truncate group-hover:text-slate-100">
                                  {t.title}
                                </span>
                                <span className="block text-xs text-slate-500 truncate">{overdue ? "Overdue" : "Due today"}</span>
                              </button>
                              <button
                                onClick={() => deferTask(t.id)}
                                disabled={busy}
                                title="Defer to tomorrow"
                                aria-label={`Defer "${t.title}" to tomorrow`}
                                className="opacity-0 group-hover:opacity-100 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-violet-300 border border-slate-700 hover:border-violet-400/50 rounded px-1.5 py-0.5 flex-shrink-0 transition-all disabled:opacity-30"
                              >
                                ⏭ tmrw
                              </button>
                              <span className={`text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 ${overdue ? "text-red-400" : "text-violet-300"}`}>
                                {overdue ? "Overdue" : "Today"}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                      {emailAsks.map((e) => (
                        <li key={e.id}>
                          <button
                            onClick={() => onNavigate("email")}
                            className="group w-full text-left flex items-start gap-3 px-3 py-2.5 border-l-2 border-l-violet-500/70 hover:bg-violet-500/[0.08] transition-colors"
                          >
                            <span className="mt-0.5 text-sm flex-shrink-0 text-violet-300">◎</span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-slate-200 truncate group-hover:text-slate-100">{e.label}</span>
                              <span className="block text-xs text-slate-500 truncate">{e.sub}</span>
                            </span>
                            <span className="text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 text-violet-300">
                              {e.unseen ? "New mail" : "Mail"}{e.meta ? ` · ${e.meta}` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* World-state alerts (weather / disasters / force protection /
                    OSINT) — tasks and email intentionally excluded above. */}
                {urgentTop.length > 0 && (
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
              </>
            )}
          </Panel>

      {/* ── Where demand is going over the next week ──
          The forecast the north star names; deterministic from the sensors
          already on the board. */}
      <div id="glance-demand" className="scroll-mt-24">
        <DemandHorizonCard />
      </div>

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
          {/* Posture moves — forces moving in the reporting. Nearly missed in
              the 2026-10-05 walkthrough as one headline among forty; for a
              mobility squadron a posture move IS the demand signal. Pure
              phrase grammar (lib/postureMoves); corroborated rows first;
              a single source is a lead and says so. */}
          <Panel
            title="Posture moves"
            badge={postureMoves.length > 0 ? (
              <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border text-amber-300 bg-amber-500/15 border-amber-500/30">
                {postureMoves.filter((m) => m.corroborated).length} corroborated · {postureMoves.length} total
              </span>
            ) : undefined}
            onJump={() => { document.getElementById("glance-demand")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          >
            {postureMoves.length === 0 ? (
              movesLoading ? <SkeletonRows n={2} /> : <Empty>No force-posture move read in the last 14 days of your feeds — absence of a report, not evidence of none.</Empty>
            ) : (
              <ul className="divide-y divide-slate-800/60">
                {postureMoves.map((m) => {
                  const sideCls = m.side === "adversary" ? "text-red-300 border-red-500/40 bg-red-500/10" : m.side === "us" ? "text-sky-300 border-sky-500/40 bg-sky-500/10" : "text-slate-300 border-slate-600 bg-slate-800/40";
                  const inner = (
                    <>
                      <span className={`text-[8px] font-mono uppercase tracking-wider border rounded px-1 py-0.5 flex-shrink-0 mt-0.5 ${sideCls}`} title={`${SIDE_LABEL[m.side]} · ${m.actor}`}>{m.actor}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-slate-200 truncate group-hover:text-emerald-400 transition-colors">{m.headline}</span>
                        <span className="block text-[11px] text-slate-500 truncate" title={`Falsifier: ${m.falsifier}`}>
                          {MOVE_LABEL[m.kind]} · {m.aor !== "UNKNOWN" ? m.aor : "AOR unresolved"} · {relTime(m.pubDate)} · {m.corroborated ? `${m.sources} sources` : `single source — ${m.source}`}
                        </span>
                      </span>
                      <span className={`text-[8px] font-mono uppercase tracking-wider rounded px-1 py-0.5 flex-shrink-0 mt-0.5 border ${m.corroborated ? "text-amber-300 border-amber-500/40" : "text-slate-500 border-slate-700"}`}>{m.corroborated ? "corroborated" : "lead"}</span>
                    </>
                  );
                  const cls = `group w-full text-left flex items-start gap-3 px-3 py-2 border-l-2 ${m.corroborated ? "border-l-amber-500/70" : "border-l-slate-600"} hover:bg-slate-800/40 transition-colors`;
                  return (
                    <li key={m.id}>
                      {m.link
                        ? <a href={m.link} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
                        : <button onClick={() => onNavigate("news")} className={cls}>{inner}</button>}
                    </li>
                  );
                })}
                <li className="px-3 py-1.5 text-[10px] text-slate-600">Feeds a <button onClick={() => document.getElementById("glance-demand")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="underline decoration-dotted hover:text-slate-400">demand-horizon driver</button> (decayed by age, capped per command). Hover a row for its falsifier.</li>
              </ul>
            )}
          </Panel>

          {/* Breaking & critical */}
          <Panel title="Breaking & critical" onJump={() => onNavigate("news")}>
            {risingThreads && risingThreads.labels.length > 0 && (
              <button onClick={() => onNavigate("news")} className="w-full text-left flex items-center gap-2 px-3 py-2 border-b border-slate-800/60 bg-amber-500/[0.04] hover:bg-amber-500/[0.08] transition-colors" title={`Threads rising on the News tab's ${risingThreads.date} board`}>
                <span className="text-[9px] font-bold uppercase tracking-widest text-amber-300 flex-shrink-0">🧵 Rising threads</span>
                <span className="text-[11px] text-slate-300 truncate">{risingThreads.labels.join(" · ")}</span>
                <span className="ml-auto text-[10px] text-slate-600 flex-shrink-0">News →</span>
              </button>
            )}
            {breaking.length === 0 ? (
              warming ? <SkeletonRows n={4} /> : <Empty>No critical stories surfaced.</Empty>
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
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── small presentational pieces ─────────────────────────

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

// Cold-load skeletons — a fresh page load renders Glance before the (hidden,
// already-mounted) Email/News tabs finish their first fetch. Shimmer rows read
// as "loading" where empty text used to read as "nothing happening".
function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <div className="px-3 py-2.5 space-y-2.5" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-start gap-3 animate-pulse">
          <div className="mt-1 w-3.5 h-3.5 rounded bg-slate-800" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-3 rounded bg-slate-800" style={{ width: `${78 - i * 14}%` }} />
            <div className="h-2 rounded bg-slate-800/70" style={{ width: `${46 - i * 8}%` }} />
          </div>
        </div>
      ))}
    </div>
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
