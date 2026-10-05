"use client";

import { useMemo, useState } from "react";
import { NewsItem, NewsThread, ThreadsResult } from "@/lib/types";
import type { LabelOccurrence, StoredSession } from "@/lib/threadHistory";
import { threadRun, sparkCells, threadDiff, throughLineDiff, splitAmc, threadDoors, type ThreadDoor, type Trend } from "@/lib/threadTrajectory";
import { laneFor, isDepthSource } from "@/lib/newsLanes";
import { isFollowed } from "@/lib/threadActions";
import { CHOKEPOINTS } from "@/lib/chokepoints";

// The Threads view — the News landing page (REVIEW-2026-10 N1–N6). Each card
// carries its own history (run, sparkline, Δ vs the previous session), the
// AMC sentence on its own line, the linked articles with their lane, and
// the doors out: Ask, Save to Docs, Follow, and the board / chokepoint it
// touches. Everything beyond the model's own text is a pure join over
// stored sessions — no model call.

interface Board { problemId: string; label: string; level: string; trajectory: string }

interface ThreadsViewProps {
  result: ThreadsResult & { capped?: boolean; generations?: number; generatedAt?: string };
  articles: NewsItem[];
  watchlist?: string[];
  previous: StoredSession | null;
  occurrences: Record<string, LabelOccurrence[]>;
  boards: Board[];
  today: string;
  /** Set when a past session is being viewed — the diff reads against the day before it. */
  pastDate?: string | null;
  criticalIds: Set<string>;
  onAsk: (t: NewsThread) => void;
  onSave: (t: NewsThread) => void;
  onFollow: (t: NewsThread, follow: boolean) => void;
  onOpenLabel: (label: string) => void;
  onDoor: (d: ThreadDoor) => void;
  onRegenerate: () => void;
}

const PALETTE = [
  { border: "border-red-500/40",    bg: "bg-red-500/8",    badge: "bg-red-500/15 text-red-400 border-red-500/40" },
  { border: "border-amber-500/40",  bg: "bg-amber-500/8",  badge: "bg-amber-500/15 text-amber-400 border-amber-500/40" },
  { border: "border-blue-500/40",   bg: "bg-blue-500/8",   badge: "bg-blue-500/15 text-blue-400 border-blue-500/40" },
  { border: "border-violet-500/40", bg: "bg-violet-500/8", badge: "bg-violet-500/15 text-violet-400 border-violet-500/40" },
  { border: "border-emerald-500/40",bg: "bg-emerald-500/8",badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" },
  { border: "border-orange-500/40", bg: "bg-orange-500/8", badge: "bg-orange-500/15 text-orange-400 border-orange-500/40" },
  { border: "border-cyan-500/40",   bg: "bg-cyan-500/8",   badge: "bg-cyan-500/15 text-cyan-400 border-cyan-500/40" },
  { border: "border-pink-500/40",   bg: "bg-pink-500/8",   badge: "bg-pink-500/15 text-pink-400 border-pink-500/40" },
];

const TREND = {
  rising: { icon: "↑", label: "Rising", cls: "text-red-400" },
  stable: { icon: "→", label: "Stable", cls: "text-slate-400" },
  fading: { icon: "↓", label: "Fading", cls: "text-slate-600" },
};

function Spark({ cells }: { cells: (Trend | null)[] }) {
  return (
    <span className="inline-flex items-end gap-[2px] h-3.5" aria-hidden>
      {cells.map((c, i) => (
        <i key={i} className={`block w-[4px] rounded-[1px] ${c === "rising" ? "h-3.5 bg-red-400" : c === "stable" ? "h-2 bg-amber-400/80" : c === "fading" ? "h-1 bg-slate-600" : "h-[2px] bg-slate-800"}`} />
      ))}
    </span>
  );
}

/** The through-line's "For AMC:" tail, in the accent colour. */
function ThroughLine({ text }: { text: string }) {
  const i = text.search(/\bFor AMC\b/i);
  if (i === -1) return <p className="text-sm text-slate-200 leading-relaxed">{text}</p>;
  return (
    <p className="text-sm text-slate-200 leading-relaxed">
      {text.slice(0, i)}<span className="text-emerald-200 font-semibold">{text.slice(i)}</span>
    </p>
  );
}

function ThreadCard(p: {
  thread: NewsThread; index: number; articles: NewsItem[]; watchlist: string[]; prev: StoredSession | null;
  history: LabelOccurrence[]; boards: Board[]; today: string; criticalIds: Set<string>;
  onAsk: () => void; onSave: () => void; onFollow: (f: boolean) => void; onOpenLabel: () => void; onDoor: (d: ThreadDoor) => void; saving: boolean;
}) {
  const { thread, index } = p;
  const color = PALETTE[index % PALETTE.length];
  const trend = TREND[thread.trend];
  const threadArticles = p.articles.filter((a) => thread.articleIds.includes(a.id));
  const followed = isFollowed(thread.label, p.watchlist);
  const run = threadRun(p.history, thread.trend);
  const cells = sparkCells(p.history, p.today);
  const prevThread = p.prev?.threads.find((t) => t.label === thread.label) ?? null;
  const diff = threadDiff(thread, prevThread);
  const { body, amc } = splitAmc(thread.summary, thread.amc);
  const doors = threadDoors(thread, p.boards, CHOKEPOINTS.map((c) => ({ id: c.id, name: c.name, keywords: c.keywords })));
  const hasHistory = p.history.length > 0;

  return (
    <div className={`relative rounded-xl border overflow-hidden transition-all ${followed ? "border-orange-500/50 shadow-[0_0_20px_-4px_rgb(249_115_22_/_0.2)]" : color.border}`}>
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b flex-wrap ${followed ? "border-orange-500/20 bg-orange-500/5" : `${color.bg} border-white/5`}`}>
        <span className="text-xs font-mono text-slate-600 select-none">{String(index + 1).padStart(2, "0")}</span>
        <span className={`text-[10px] font-bold tracking-widest px-2 py-0.5 rounded-md border ${followed ? "bg-orange-500/15 text-orange-400 border-orange-500/40" : color.badge}`}>
          {followed && <span className="mr-1">⚑</span>}{thread.label}
        </span>
        <div className="ml-auto flex items-center gap-3 text-[11px] font-mono">
          <button onClick={p.onOpenLabel} title={hasHistory ? `${p.history.length} session${p.history.length === 1 ? "" : "s"} in 14 days — open the timeline` : "No stored history yet"} className="flex items-center gap-2 hover:opacity-80">
            <Spark cells={cells} />
            <span className={`font-bold ${trend.cls}`}>{trend.icon} {trend.label}</span>
            <span className="text-slate-500">{run.label}</span>
          </button>
          <span className="text-slate-600">{thread.articleIds.length} {thread.articleIds.length === 1 ? "source" : "sources"}</span>
        </div>
      </div>

      <div className="px-4 py-4 bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-100 leading-snug mb-2">{thread.headline}</h3>
        <p className="text-xs text-slate-400 leading-relaxed">{body}</p>
        {amc && (
          <div className="mt-2.5 flex gap-2 rounded-lg px-3 py-2 bg-emerald-500/[0.07] border border-emerald-500/20">
            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 flex-shrink-0 mt-0.5">So what · AMC</span>
            <p className="text-[12px] text-emerald-100/90 leading-relaxed">{amc}</p>
          </div>
        )}
        <div className="mt-2.5 flex gap-2 text-[11px] text-slate-500">
          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 flex-shrink-0 mt-0.5">Δ {p.prev ? p.prev.date.slice(5) : "prev"}</span>
          <span className="leading-relaxed">{diff}</span>
        </div>

        {thread.newsletterContext && (
          <div className="flex gap-2 mt-3 bg-slate-800/60 rounded-lg px-3 py-2 border border-slate-700/60">
            <span className="text-emerald-500 flex-shrink-0 text-sm mt-0.5">›</span>
            <p className="text-xs text-slate-400 italic leading-relaxed">{thread.newsletterContext}</p>
          </div>
        )}

        {threadArticles.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 pt-3 mt-3 border-t border-slate-800/60">
            {threadArticles.map((a) => {
              const lane = laneFor(a, p.criticalIds);
              const laneCls = lane === "depth" || isDepthSource(a.source) ? "text-violet-300 bg-violet-500/15" : lane === "now" ? "text-amber-300 bg-amber-500/15" : "text-slate-500 bg-slate-800";
              const laneTxt = lane === "depth" || isDepthSource(a.source) ? "depth" : lane === "now" ? "now" : "more";
              return (
                <a key={a.id} href={a.link} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 group min-w-0">
                  <span className={`text-[8px] font-bold uppercase tracking-wider rounded px-1 py-[1px] flex-shrink-0 mt-[3px] ${laneCls}`}>{laneTxt}</span>
                  <span className="text-xs text-slate-500 group-hover:text-slate-300 transition-colors leading-snug min-w-0">
                    {a.title}<span className="text-slate-700 ml-1.5">{a.source}</span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 px-4 py-2 border-t border-slate-800/80 bg-slate-950/40 flex-wrap">
        <button onClick={p.onAsk} className="text-[10px] font-bold uppercase tracking-wider border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 rounded-md px-2 py-1 transition-colors">✦ Ask about this</button>
        <button onClick={p.onSave} disabled={p.saving} title="Create or append the 🧵 thread doc — its Trace renders as a timeline on the Docs tab" className="text-[10px] font-bold uppercase tracking-wider border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 rounded-md px-2 py-1 transition-colors disabled:opacity-50">⧉ {p.saving ? "Saving…" : "Save to Docs"}</button>
        <button onClick={() => p.onFollow(!followed)} title={followed ? "On your watchlist — click to stop following" : "Add to the watchlist: pins this thread, feeds Glance and alerts"} className={`text-[10px] font-bold uppercase tracking-wider border rounded-md px-2 py-1 transition-colors ${followed ? "border-orange-500/50 text-orange-300 bg-orange-500/10" : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"}`}>⚑ {followed ? "Following" : "Follow"}</button>
        {doors.length > 0 && (
          <span className="ml-auto flex items-center gap-1.5 flex-wrap">
            {doors.map((d) => (
              <button key={`${d.kind}-${d.id}`} onClick={() => p.onDoor(d)} title={d.kind === "board" ? "Open this I&W board" : "Open the chokepoint board on the Economy tab"} className="text-[10px] font-mono text-amber-300 hover:text-amber-200 border border-amber-500/30 hover:border-amber-500/60 rounded px-1.5 py-0.5 transition-colors">
                → {d.kind === "board" ? "I&W" : "⚓"} {d.label} · {d.detail}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ThreadsView(props: ThreadsViewProps) {
  const { result, articles, watchlist = [], previous, occurrences, boards, today, pastDate, criticalIds } = props;
  const { throughLine, threads } = result;
  const [saving, setSaving] = useState<string | null>(null);

  const vs = useMemo(() => throughLineDiff(threads, previous), [threads, previous]);

  const exportPdf = async () => {
    const { buildThreadsHTML, openPrintWindow } = await import("@/lib/exports");
    openPrintWindow(buildThreadsHTML(result, true));
  };
  const exportHtml = async () => {
    const { buildThreadsHTML, downloadHTML } = await import("@/lib/exports");
    downloadHTML(buildThreadsHTML(result, false), "threads");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {pastDate ? (
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-0.5">Past day · {pastDate} — stored read, not live</span>
        ) : (
          <>
            {result.capped && (
              <span title={`${result.generations ?? 3} analyses today — the daily cap; ↻ Regenerate forces one more`} className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-800 border border-slate-700 rounded px-2 py-0.5">
                day&apos;s last read{result.generatedAt ? ` · ${new Date(result.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
              </span>
            )}
            <button onClick={props.onRegenerate} title="Force a fresh analysis — an unchanged feed replays today's saved read for free" className="text-[10px] text-slate-600 hover:text-emerald-400 font-mono uppercase tracking-wider transition-colors">↻ Regenerate</button>
          </>
        )}
        <span className="ml-auto flex gap-2">
          <button onClick={exportPdf} title="Open print-ready PDF view" className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2 py-0.5 rounded-md transition-all">PDF</button>
          <button onClick={exportHtml} title="Download a standalone HTML copy" className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2 py-0.5 rounded-md transition-all">HTML</button>
        </span>
      </div>

      {throughLine && (
        <div className="relative bg-slate-900 rounded-xl border border-slate-700/60 overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-400 via-emerald-500 to-transparent" />
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Through-Line</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
            <ThroughLine text={throughLine} />
            {vs && <p className="mt-3 pt-2.5 border-t border-slate-800 text-[11px] text-slate-500"><span className="text-slate-300 font-semibold">{vs.slice(0, vs.indexOf(":") + 1)}</span>{vs.slice(vs.indexOf(":") + 1)}</p>}
          </div>
        </div>
      )}

      {threads.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] text-slate-600 font-mono uppercase tracking-wider flex-shrink-0">{pastDate ?? "Today"}</span>
          {threads.map((t, i) => {
            const tr = TREND[t.trend];
            const followed = isFollowed(t.label, watchlist);
            const run = threadRun(occurrences[t.label] ?? [], t.trend);
            return (
              <a key={t.label + i} href={`#thread-${i}`} className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all ${followed ? "bg-orange-500/15 text-orange-400 border-orange-500/40" : PALETTE[i % PALETTE.length].badge}`}>
                {followed && <span>⚑</span>}{t.label}
                <span className={`text-[9px] ${followed ? "text-orange-400" : tr.cls}`}>{tr.icon}</span>
                <span className="text-[9px] font-mono opacity-60">{t.articleIds.length}{run.days > 1 ? ` · ${run.label}` : run.isNew ? " · new" : ""}</span>
              </a>
            );
          })}
        </div>
      )}

      <div className="space-y-4">
        {threads.map((thread, i) => (
          <div key={thread.label + i} id={`thread-${i}`} className="scroll-mt-24">
            <ThreadCard
              thread={thread} index={i} articles={articles} watchlist={watchlist} prev={previous}
              history={occurrences[thread.label] ?? []} boards={boards} today={pastDate ?? today} criticalIds={criticalIds}
              saving={saving === thread.label}
              onAsk={() => props.onAsk(thread)}
              onSave={async () => { setSaving(thread.label); try { await props.onSave(thread); } finally { setSaving(null); } }}
              onFollow={(f) => props.onFollow(thread, f)}
              onOpenLabel={() => props.onOpenLabel(thread.label)}
              onDoor={props.onDoor}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
