"use client";

import { useEffect, useState } from "react";
import type { ForceAssessment } from "@/lib/forceProtection";
import { AOR_LABELS } from "@/lib/aor";
import { isWorse } from "@/lib/severity";
import { postureTarget } from "@/lib/postureTarget";

// The Glance hero: a row of live status tiles, each deep-linking to the
// surface that owns it. The north star's verb is "see changes"; a hero made
// of day-cached prose could not show one. Every tile is EARNED colour —
// red/amber only when a surface is actually red/amber, slate otherwise — and
// UNKNOWN is a state of its own, never folded into green.
//
// Posture and SITREP come from data Glance already holds; I&W, demand,
// alerts and family are fetched here (all deterministic, all server-cached,
// no model call). Family is owner-only: the route answers `empty` for crew
// and the tile simply does not render.
//
// 2026-10-05 walkthrough (docs/REVIEW-2026-10.md G2–G7): the row is labelled;
// each feed is fetched on its own so one slow route cannot hold the others on
// "…"; a `pending` demand answer is re-asked; Alerts sits before Tasks and
// Family (what would page you outranks what is yours to do); the Tasks and
// Family tooltips list the items; and the Posture tile lands on the location
// that earned its colour, not on the first country in the watch.

type Nav = (tab: "glance" | "news" | "calendar" | "email" | "docs" | "osint" | "markets" | "weather" | "family") => void;

interface SitrepLite { icao: string; label: string; status: Record<string, string>; driver: string; worse: string[] }
interface IwLite { problemId: string; label: string; level: string; trajectory: string; learning?: boolean }
interface DemandLite { aor: string; direction: string; score: number; confidence: string }
interface AlertLite { id: string; severity: string; title: string }
interface FamilyItem { id: string; title: string; dueISO?: string | null; daysUntil?: number | null }
interface FamilyWeek { empty?: boolean; lapsed?: FamilyItem[]; dueSoon?: FamilyItem[]; undated?: number; conflicts?: { title: string }[] }
interface SpectrumLite {
  pending?: boolean; led: string; line: string;
  pnt: { state: string; live: boolean; problemId: string } | null;
  cyber: { state: string; live: boolean; problemId: string } | null;
  spaceWx: { live: boolean; led: string; severe: { scale: string; level: number }[] };
  edge: { declared: boolean; live: boolean; led: string; hits: unknown[] };
  trend?: { direction: "rising" | "falling" | "flat" | null; line: string | null };
}

type Tone = "red" | "amber" | "unknown" | "green" | "quiet" | "violet";
const TONE: Record<Tone, { border: string; value: string; dot: string }> = {
  red:     { border: "border-red-500/50 bg-red-500/[0.06]",     value: "text-red-300",     dot: "bg-red-500" },
  amber:   { border: "border-amber-500/45 bg-amber-500/[0.05]", value: "text-amber-300",   dot: "bg-amber-500" },
  unknown: { border: "border-slate-600 bg-slate-800/30",        value: "text-slate-300",   dot: "bg-slate-500" },
  green:   { border: "border-emerald-500/30 bg-emerald-500/[0.04]", value: "text-emerald-300", dot: "bg-emerald-500" },
  quiet:   { border: "border-slate-800 bg-slate-900/40",        value: "text-slate-400",   dot: "bg-slate-700" },
  // Your own actions — the ownership accent the Needs-you-now group uses.
  violet:  { border: "border-violet-500/45 bg-violet-500/[0.06]", value: "text-violet-200", dot: "bg-violet-500" },
};

interface Tile { key: string; label: string; value: string; sub: string; tone: Tone; onClick: () => void; title: string }

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

interface TaskCounts { due: number; overdue: number; asks: number; items?: string[]; askItems?: string[] }

const j = async (url: string) => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };

/** One feed, on its own clock: a failed or slow route leaves only ITS tile on
 *  "…", a `pending` answer is re-asked after `retryMs`, and the whole thing
 *  refreshes every five minutes. */
function useFeed<T>(url: string, accept: (x: unknown) => T | null, opts?: { pendingRetryMs?: number }): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = async (attempt = 0) => {
      const x = await j(url);
      if (cancelled) return;
      const val = x == null ? null : accept(x);
      if (val != null) setV(val);
      const pending = !!(x && typeof x === "object" && (x as { pending?: boolean }).pending);
      // A cold server (`pending`) or a failed fetch: ask again shortly, a few
      // times, then wait for the regular tick.
      if ((pending || x == null) && attempt < 3 && opts?.pendingRetryMs) {
        retry = setTimeout(() => load(attempt + 1), opts.pendingRetryMs);
      }
    };
    load();
    const id = setInterval(() => load(), 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); if (retry) clearTimeout(retry); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return v;
}

export default function StatusRow({ forceWatch, sitreps, tasks, onNavigate }: { forceWatch: ForceAssessment[]; sitreps: SitrepLite[]; tasks?: TaskCounts; onNavigate: Nav }) {
  const iw = useFeed<IwLite[]>("/api/warning", (x) => Array.isArray((x as { problems?: unknown }).problems) ? (x as { problems: IwLite[] }).problems : null);
  const demand = useFeed<DemandLite[]>("/api/demand-horizon", (x) => {
    const b = x as { outlooks?: unknown; pending?: boolean };
    // A pending stub carries no outlooks: keep "…" rather than show "hold".
    return Array.isArray(b.outlooks) && !(b.pending && b.outlooks.length === 0) ? (b.outlooks as DemandLite[]) : null;
  }, { pendingRetryMs: 10_000 });
  const alerts = useFeed<AlertLite[]>("/api/alerts/check", (x) => Array.isArray((x as { alerts?: unknown }).alerts) ? (x as { alerts: AlertLite[] }).alerts : null);
  const family = useFeed<FamilyWeek>("/api/family/week", (x) => (x && typeof x === "object" ? (x as FamilyWeek) : null));
  const spectrum = useFeed<SpectrumLite>("/api/spectrum", (x) => (x && typeof (x as { led?: unknown }).led === "string" ? (x as SpectrumLite) : null), { pendingRetryMs: 10_000 });

  const tiles: Tile[] = [];

  // Posture.
  {
    const red = forceWatch.filter((a) => a.composite === "red");
    const amber = forceWatch.filter((a) => a.composite === "amber").length;
    const unknown = forceWatch.filter((a) => a.composite === "unknown").length;
    const tone: Tone = red.length ? "red" : amber ? "amber" : unknown && !forceWatch.some((a) => a.composite === "green") ? "unknown" : forceWatch.length ? "green" : "quiet";
    const target = postureTarget(forceWatch);
    const escalatedToday = forceWatch.filter((a) => a.previousComposite && isWorse(a.composite, a.previousComposite)).length;
    tiles.push({
      key: "posture", label: "Posture", tone,
      value: forceWatch.length === 0 ? "—" : red.length ? `${red.length} RED` : amber ? `${amber} amber` : "green",
      sub: forceWatch.length === 0 ? "no watch set" : [amber && red.length ? `${amber} amber` : "", unknown ? `${unknown} unknown` : "", escalatedToday ? `${escalatedToday} escalated today` : "", `${forceWatch.length} watched`].filter(Boolean).join(" · "),
      title: (red.length ? red.map((r) => `${r.label}: ${r.topDriver}`).join("\n") : "Force-protection posture across the watch")
        + (target ? `\n\nClick → ${target.label} in Regional` : ""),
      onClick: () => {
        onNavigate("osint"); emit("osint:set-pane", "regional");
        if (target?.country) setTimeout(() => emit("regional:select", target.country), 160);
      },
    });
  }

  // Bases.
  {
    const worst = (s: SitrepLite) => Object.values(s.status).includes("r") ? 3 : Object.values(s.status).includes("a") ? 2 : Object.values(s.status).every((v) => v === "u") ? 1 : 0;
    const ranked = sitreps.slice().sort((a, b) => worst(b) - worst(a));
    const top = ranked[0];
    const w = top ? worst(top) : -1;
    const tone: Tone = w === 3 ? "red" : w === 2 ? "amber" : w === 1 ? "unknown" : sitreps.length ? "green" : "quiet";
    const worseCount = sitreps.filter((s) => s.worse.length > 0).length;
    tiles.push({
      key: "bases", label: "Bases", tone,
      value: !top ? "—" : w === 3 ? `${top.icao} RED` : w === 2 ? `${top.icao} amber` : w === 1 ? `${top.icao} unknown` : "all green",
      sub: !top ? "no SITREP bases" : [top.driver && w >= 2 ? top.driver : "", worseCount ? `${worseCount} worse than yesterday` : "", `${sitreps.length} base${sitreps.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
      title: sitreps.map((s) => `${s.icao}: ${s.driver || "all green"}`).join("\n") || "Base SITREP",
      onClick: () => { onNavigate("osint"); emit("osint:set-pane", "watch"); if (top) setTimeout(() => emit("watch:focus", { kind: "sitrep", id: top.icao }), 160); },
    });
  }

  // I&W.
  {
    const rank: Record<string, number> = { alert: 3, warning: 2, watch: 1, calm: 0 };
    const sorted = (iw ?? []).slice().sort((a, b) => (rank[b.level] ?? 0) - (rank[a.level] ?? 0));
    const top = sorted[0];
    const deteriorating = sorted.filter((p) => p.trajectory === "deteriorating").length;
    const tone: Tone = !iw ? "quiet" : !top ? "quiet" : top.level === "alert" ? "red" : top.level === "warning" ? "amber" : top.level === "watch" ? "amber" : "green";
    tiles.push({
      key: "iw", label: "I&W", tone,
      value: !iw ? "…" : !top ? "—" : top.level === "calm" ? "calm" : `${top.level.toUpperCase()}`,
      sub: !iw ? "loading" : !top ? "no boards" : [top.level !== "calm" ? top.label : "", deteriorating ? `${deteriorating} deteriorating` : "", `${iw.length} board${iw.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
      title: (sorted.map((p) => `${p.label}: ${p.level} · ${p.trajectory}${p.learning ? " (learning)" : ""}`).join("\n") || "Indications & warning")
        + (top ? `\n\nClick → ${top.label} board` : ""),
      onClick: () => { onNavigate("osint"); emit("osint:set-pane", "watch"); setTimeout(() => emit("watch:focus", { kind: "iw", id: top?.problemId ?? "" }), 160); },
    });
  }

  // Spectrum — worst of PNT, cyber, space-weather ops impact and KEV
  // exposure (REVIEW-CYBER-SPACE §4.1). UNKNOWN is its own tone; space
  // weather colours the tile but never an I&W level.
  {
    const s = spectrum;
    const tone: Tone = !s ? "quiet" : s.led === "r" ? "red" : s.led === "a" ? "amber" : s.led === "u" ? "unknown" : "green";
    const rank: Record<string, number> = { confirmed: 3, active: 2, watching: 1, dormant: 0 };
    const lead = s && s.cyber && s.cyber.live && rank[s.cyber.state] >= rank[s.pnt?.state ?? "dormant"] && s.cyber.state !== "dormant" ? { k: "cyber", v: s.cyber }
      : s && s.pnt && s.pnt.live && s.pnt.state !== "dormant" ? { k: "PNT", v: s.pnt } : null;
    // The board the lead signal belongs to, named so the click is not a surprise.
    const leadBoard = lead ? (iw ?? []).find((p) => p.problemId === lead.v.problemId)?.label ?? null : null;
    // Trajectory glyph from the recorded series (lib/spectrumTrend): the
    // G-scale when any storm day is on record, else KEV cadence. Flat and
    // unknown draw nothing.
    const arrow = s?.trend?.direction === "rising" ? " ↗" : s?.trend?.direction === "falling" ? " ↘" : "";
    const value = !s ? "…" : s.pending && s.led === "u" ? "…"
      : s.spaceWx.severe.length ? `${s.spaceWx.severe.map((x) => `${x.scale}${x.level}`).join("/")} storm${arrow}`
      : lead ? `${lead.k} ${lead.v.state}${arrow}`
      : s.edge.hits.length ? `${s.edge.hits.length} KEV${arrow}`
      : s.led === "u" ? "unknown" : `quiet${arrow}`;
    tiles.push({
      key: "spectrum", label: "Spectrum", tone,
      value,
      sub: !s ? "loading" : leadBoard && lead ? `${lead.k} on ${leadBoard}` : s.line,
      title: `PNT denial · cyber pressure · space weather → ops · KEV on declared vendors. Space weather is environment: it colours this tile, never an I&W level.${s?.trend?.line ? ` History: ${s.trend.line}` : ""}${leadBoard ? `\n\nClick → ${leadBoard} board` : ""}`,
      onClick: () => {
        const pid = lead?.v.problemId;
        if (pid) { onNavigate("osint"); emit("osint:set-pane", "watch"); setTimeout(() => emit("watch:focus", { kind: "iw", id: pid }), 160); }
        else if (s && (s.spaceWx.severe.length || s.spaceWx.led === "a")) onNavigate("weather");
        else { onNavigate("osint"); emit("osint:set-pane", "watch"); }
      },
    });
  }

  // Demand.
  {
    const rising = (demand ?? []).filter((d) => d.direction === "rise");
    const falling = (demand ?? []).filter((d) => d.direction === "fall").length;
    const tone: Tone = !demand ? "quiet" : rising.length ? "amber" : falling ? "green" : "quiet";
    tiles.push({
      key: "demand", label: "Demand · 7d", tone,
      value: !demand ? "…" : rising.length ? `${rising.length} rising` : falling ? `${falling} falling` : "hold",
      sub: !demand ? "assembling" : rising.length ? rising.map((r) => (AOR_LABELS as Record<string, string>)[r.aor] ?? r.aor).join(", ") : `${demand.length} command${demand.length === 1 ? "" : "s"} steady`,
      title: (demand ?? []).map((d) => `${d.aor}: ${d.direction} (${d.score >= 0 ? "+" : ""}${d.score}, ${d.confidence})`).join("\n") || "7-day demand horizon — assembling from the sensors on the board",
      onClick: () => { document.getElementById("glance-demand")?.scrollIntoView({ behavior: "smooth", block: "start" }); },
    });
  }

  // Alerts — what would page you. Before Tasks and Family on purpose.
  {
    const reds = (alerts ?? []).filter((a) => a.severity === "red").length;
    const n = (alerts ?? []).length;
    const tone: Tone = !alerts ? "quiet" : reds ? "red" : n ? "amber" : "green";
    tiles.push({
      key: "alerts", label: "Alerts", tone,
      value: !alerts ? "…" : n === 0 ? "none" : reds ? `${reds} red` : `${n} amber`,
      sub: !alerts ? "loading" : n === 0 ? "nothing would page you" : (alerts ?? []).slice(0, 2).map((a) => a.title).join(" · "),
      title: (alerts ?? []).map((a) => `${a.severity === "red" ? "RED" : "amber"} · ${a.title}`).join("\n") || "Conditions that would page you",
      onClick: () => { onNavigate("osint"); emit("osint:set-pane", "watch"); },
    });
  }

  // Tasks — your own actions. Overdue counts first, then what email is
  // asking of you. The tooltip lists the items.
  if (tasks) {
    const tone: Tone = tasks.overdue ? "red" : tasks.due ? "violet" : tasks.asks ? "violet" : "quiet";
    const lines = [
      ...(tasks.items ?? []).map((t) => `• ${t}`),
      ...(tasks.askItems ?? []).map((t) => `◎ ${t}`),
    ];
    tiles.push({
      key: "tasks", label: "Tasks", tone,
      value: tasks.due ? `${tasks.due} due` : tasks.asks ? `${tasks.asks} ask${tasks.asks === 1 ? "" : "s"}` : "clear",
      sub: [tasks.overdue ? `${tasks.overdue} overdue` : "", tasks.due && tasks.asks ? `${tasks.asks} email ask${tasks.asks === 1 ? "" : "s"}` : "", !tasks.due && !tasks.asks ? "nothing with your name on it" : ""].filter(Boolean).join(" · ") || "due today",
      title: lines.length ? lines.join("\n") : "Your actions — tasks due or overdue, and email that needs your answer",
      onClick: () => onNavigate("calendar"),
    });
  }

  // Family (owner only — route answers `empty` for crew with no counts).
  if (family && !(family.empty && !(family.lapsed?.length || family.dueSoon?.length))) {
    const lapsed = family.lapsed ?? [];
    const due = family.dueSoon ?? [];
    const conflicts = family.conflicts ?? [];
    const undated = family.undated ?? 0;
    const tone: Tone = lapsed.length ? "red" : due.length || conflicts.length ? "amber" : "green";
    const when = (i: FamilyItem) => typeof i.daysUntil === "number"
      ? (i.daysUntil < 0 ? `${-i.daysUntil}d overdue` : i.daysUntil === 0 ? "today" : `in ${i.daysUntil}d`)
      : (i.dueISO ?? "");
    const lines = [
      ...lapsed.map((i) => `PAST DUE · ${i.title} (${when(i)})`),
      ...due.map((i) => `${i.title} — ${when(i)}`),
      ...conflicts.map((c) => `⚑ trip conflict · ${c.title}`),
      ...(undated ? [`${undated} undated — open the email to confirm`] : []),
    ];
    tiles.push({
      key: "family", label: "Family", tone,
      value: lapsed.length ? `${lapsed.length} past due` : due.length ? `${due.length} due soon` : "clear",
      sub: [lapsed.length && due.length ? `${due.length} due soon` : "", conflicts.length ? `${conflicts.length} trip conflict${conflicts.length === 1 ? "" : "s"}` : "", undated ? `${undated} undated` : ""].filter(Boolean).join(" · ") || "tracked deadlines, bills, documents",
      title: lines.length ? lines.join("\n") : "Family week ahead — tracked deadlines, bill due dates, documents",
      onClick: () => onNavigate("family"),
    });
  }

  return (
    <section aria-label="Status — right now" className="space-y-1.5">
      <div className="flex items-baseline gap-2 px-0.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Right now</span>
        <span className="text-[10px] text-slate-600">live status · each tile opens the surface that owns it · refreshes every 5 min</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
        {tiles.map((t) => {
          const c = TONE[t.tone];
          return (
            <button
              key={t.key}
              type="button"
              onClick={t.onClick}
              title={t.title}
              className={`text-left rounded-lg border px-3 py-2 min-w-0 transition-colors hover:bg-slate-800/50 ${c.border}`}
            >
              <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">
                <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} aria-hidden />{t.label}
              </span>
              <span className={`block text-[15px] font-bold leading-tight mt-0.5 truncate ${c.value}`}>{t.value}</span>
              <span className="block text-[10px] text-slate-500 truncate">{t.sub}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
