"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { StoredSession, LabelSummary, LabelOccurrence, StoredThread } from "@/lib/threadHistory";

// ─── Types mirrored from lib (no server imports in client components) ─────────

type HistoryTab = "sessions" | "labels" | "trends";

const TREND = {
  rising: { icon: "↑", cls: "text-red-400" },
  stable: { icon: "→", cls: "text-slate-500" },
  fading: { icon: "↓", cls: "text-slate-600" },
} as const;

const DAY_OPTIONS = [7, 14, 30, 60] as const;
type Days = (typeof DAY_OPTIONS)[number];

// ─── Sub-components ───────────────────────────────────────────────────────────

function DaySelector({ value, onChange }: { value: Days; onChange: (d: Days) => void }) {
  return (
    <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/60 rounded-lg p-0.5">
      {DAY_OPTIONS.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-all ${
            value === d ? "bg-slate-700 text-slate-100" : "text-slate-500 hover:text-slate-300"
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

// ─── Sessions tab ─────────────────────────────────────────────────────────────

function SessionsTab({ days }: { days: Days }) {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/thread-history?view=sessions&days=${days}`)
      .then((r) => r.json())
      .then((d) => { setSessions(d.sessions ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) return <LoadingSkeleton rows={5} />;

  if (sessions.length === 0) {
    return (
      <div className="text-center py-16 text-slate-600 text-xs font-mono uppercase tracking-wider">
        No sessions recorded yet — run a Thread Analysis to start building history
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const isOpen = expanded === s.id;
        const dateLabel = new Date(s.date + "T12:00:00").toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric",
        });
        return (
          <div
            key={s.id}
            className="rounded-xl border border-slate-800 overflow-hidden"
          >
            {/* Header row */}
            <button
              onClick={() => setExpanded(isOpen ? null : s.id)}
              className="w-full flex items-center gap-4 px-4 py-3 bg-slate-900 hover:bg-slate-800/60 transition-colors text-left"
            >
              <span className="text-[11px] font-mono font-bold text-emerald-500 flex-shrink-0 w-20">
                {dateLabel}
              </span>
              <span className="flex-1 text-xs text-slate-400 truncate leading-snug">
                {s.throughLine}
              </span>
              <span className="text-[10px] font-mono text-slate-600 flex-shrink-0">
                {s.threads.length} threads
              </span>
              <span className={`text-slate-600 flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>

            {/* Expanded content */}
            {isOpen && (
              <div className="border-t border-slate-800 bg-slate-950">
                {/* Through-line */}
                <div className="px-4 py-3 border-b border-slate-800/60">
                  <p className="text-[11px] text-slate-300 leading-relaxed">{s.throughLine}</p>
                </div>
                {/* Thread list */}
                <div className="divide-y divide-slate-800/60">
                  {s.threads.map((t) => {
                    const tr = TREND[t.trend];
                    return (
                      <div key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                        <span className={`text-[10px] font-bold font-mono mt-0.5 w-6 flex-shrink-0 ${tr.cls}`}>
                          {tr.icon}
                        </span>
                        <div className="min-w-0">
                          <span className="text-[10px] font-bold font-mono text-slate-500 mr-2">
                            {t.label}
                          </span>
                          <span className="text-[11px] text-slate-400 leading-snug">
                            {t.headline}
                          </span>
                          {t.sources.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {t.sources.slice(0, 4).map((src) => (
                                <span key={src} className="text-[9px] font-mono text-slate-700 bg-slate-800/80 px-1.5 py-0.5 rounded">
                                  {src}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Labels tab ───────────────────────────────────────────────────────────────

function LabelsTab({ days }: { days: Days }) {
  const [labels, setLabels] = useState<LabelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<LabelOccurrence[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<StoredThread & { date: string }> | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    fetch(`/api/thread-history?view=labels&days=${days}`)
      .then((r) => r.json())
      .then((d) => { setLabels(d.labels ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  const openLabel = useCallback((label: string) => {
    setSelected(label);
    setHistoryLoading(true);
    fetch(`/api/thread-history?view=label&label=${encodeURIComponent(label)}&days=${days}`)
      .then((r) => r.json())
      .then((d) => { setHistory(d.history ?? []); })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [days]);

  // Debounced FTS search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults(null); return; }
    debounceRef.current = setTimeout(() => {
      setSearchLoading(true);
      fetch(`/api/thread-history?view=search&q=${encodeURIComponent(query)}&days=${days}`)
        .then((r) => r.json())
        .then((d) => setSearchResults(d.results ?? []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 350);
  }, [query, days]);

  // ── Label detail view ──
  if (selected) {
    return (
      <div>
        <button
          onClick={() => setSelected(null)}
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 mb-4 font-mono transition-colors"
        >
          ← All labels
        </button>

        <div className="flex items-baseline gap-3 mb-4">
          <span className="text-lg font-bold font-mono text-slate-100 tracking-widest">{selected}</span>
          <span className="text-xs text-slate-600 font-mono">{history.length} occurrence{history.length !== 1 ? "s" : ""} in {days}d</span>
        </div>

        {historyLoading ? (
          <LoadingSkeleton rows={4} />
        ) : history.length === 0 ? (
          <p className="text-slate-600 text-xs font-mono">No history in this window.</p>
        ) : (
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[23px] top-3 bottom-3 w-px bg-slate-800" />
            <div className="space-y-0">
              {history.map((occ, i) => {
                const tr = TREND[occ.trend];
                const dateLabel = new Date(occ.date + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "short", month: "short", day: "numeric",
                });
                const isLast = i === history.length - 1;
                // Gap detection
                let gapDays = 0;
                if (i > 0) {
                  gapDays = Math.round(
                    (new Date(occ.date).getTime() - new Date(history[i - 1].date).getTime()) / 86_400_000
                  );
                }
                return (
                  <div key={`${occ.date}-${i}`}>
                    {gapDays > 1 && (
                      <div className="flex items-center gap-3 py-2 pl-[47px]">
                        <span className="text-[9px] text-slate-700 font-mono italic">
                          {gapDays - 1}d gap
                        </span>
                      </div>
                    )}
                    <div className={`flex gap-4 py-3 ${!isLast ? "border-b border-slate-800/40" : ""}`}>
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 z-10 ${
                          occ.trend === "rising" ? "bg-red-500 border-red-500" :
                          occ.trend === "stable" ? "bg-slate-600 border-slate-600" :
                          "bg-slate-800 border-slate-700"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0 -mt-0.5">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono text-slate-500">{dateLabel}</span>
                          <span className={`text-[10px] font-bold font-mono ${tr.cls}`}>
                            {tr.icon} {occ.trend}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-snug">{occ.headline}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Search results view ──
  if (searchResults && query.trim()) {
    return (
      <div>
        <SearchBox query={query} onChange={setQuery} loading={searchLoading} />
        <div className="mt-4">
          {searchLoading ? (
            <LoadingSkeleton rows={3} />
          ) : searchResults.length === 0 ? (
            <p className="text-slate-600 text-xs font-mono text-center py-8">No results for &ldquo;{query}&rdquo;</p>
          ) : (
            <div className="space-y-2">
              {searchResults.map((r) => {
                const tr = TREND[r.trend];
                const dateLabel = new Date(r.date + "T12:00:00").toLocaleDateString("en-US", {
                  month: "short", day: "numeric",
                });
                return (
                  <div key={r.id} className="bg-slate-900 rounded-lg border border-slate-800 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <button
                        onClick={() => { setQuery(""); openLabel(r.label); }}
                        className="text-[10px] font-bold font-mono text-slate-400 hover:text-slate-200 transition-colors"
                      >
                        {r.label}
                      </button>
                      <span className={`text-[10px] font-mono ${tr.cls}`}>{tr.icon}</span>
                      <span className="text-[10px] font-mono text-slate-600 ml-auto">{dateLabel}</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-snug">{r.headline}</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed mt-1">{r.summary}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Label grid ──
  return (
    <div>
      <SearchBox query={query} onChange={setQuery} loading={searchLoading} />

      {loading ? (
        <LoadingSkeleton rows={6} className="mt-4" />
      ) : labels.length === 0 ? (
        <div className="text-center py-16 text-slate-600 text-xs font-mono uppercase tracking-wider mt-4">
          No labels found in this window
        </div>
      ) : (
        <div className="mt-4 space-y-1.5">
          {labels.map((l) => {
            const tr = TREND[l.lastTrend];
            return (
              <button
                key={l.label}
                onClick={() => openLabel(l.label)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/60 transition-all text-left group"
              >
                {/* Flags */}
                <div className="flex flex-col items-center gap-0.5 w-5 flex-shrink-0">
                  {l.isSustainedEscalation && (
                    <span className="text-[9px] text-red-400" title="Sustained escalation">⚡</span>
                  )}
                  {l.isRemerging && (
                    <span className="text-[9px] text-amber-400" title="Re-emerging">↩</span>
                  )}
                </div>

                {/* Label */}
                <span className="text-xs font-bold font-mono text-slate-200 group-hover:text-white transition-colors w-32 flex-shrink-0 truncate">
                  {l.label}
                </span>

                {/* Sparkline */}
                <span className="flex-1 text-[10px] font-mono text-slate-600 truncate hidden sm:block">
                  {l.trendSparkline}
                </span>

                {/* Stats */}
                <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
                  <span className={`text-[11px] font-bold font-mono ${tr.cls}`}>{tr.icon}</span>
                  <span className="text-[10px] font-mono text-slate-600">
                    {l.occurrences}×
                  </span>
                  <span className="text-[9px] font-mono text-slate-700">
                    {new Date(l.lastSeen + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span className="text-slate-700 group-hover:text-slate-500 transition-colors text-xs">›</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Trends tab ───────────────────────────────────────────────────────────────

function TrendsTab({ days, onSelectLabel }: { days: Days; onSelectLabel: (label: string) => void }) {
  const [labels, setLabels] = useState<LabelSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/thread-history?view=labels&days=${days}`)
      .then((r) => r.json())
      .then((d) => { setLabels(d.labels ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) return <LoadingSkeleton rows={8} />;

  if (labels.length === 0) {
    return (
      <div className="text-center py-16 text-slate-600 text-xs font-mono uppercase tracking-wider">
        No data yet — run Thread Analysis daily to populate trend signals
      </div>
    );
  }

  const watchClosely = labels.filter((l) => l.isSustainedEscalation || (l.isRemerging && l.lastTrend === "rising"));
  const active = labels.filter(
    (l) => !l.isSustainedEscalation && !l.isRemerging && l.trajectoryScore > 0 && l.occurrences >= 2
  );
  const subsiding = labels.filter((l) => l.lastTrend === "fading" && !l.isSustainedEscalation && !l.isRemerging);

  // Labels that don't fit any specific group yet (single occurrence, no trend history)
  const categorised = new Set([...watchClosely, ...active, ...subsiding].map((l) => l.label));
  const emerging = labels.filter((l) => !categorised.has(l.label));

  const anyVisible = watchClosely.length + active.length + subsiding.length + emerging.length > 0;

  if (!anyVisible) {
    return (
      <div className="text-center py-16 text-slate-600 text-xs font-mono uppercase tracking-wider">
        No data yet — run Thread Analysis daily to populate trend signals
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {watchClosely.length > 0 && (
        <TrendGroup
          title="Watch Closely"
          accentClass="text-red-400 border-red-500/30"
          dotClass="bg-red-500"
          labels={watchClosely}
          onSelect={onSelectLabel}
        />
      )}
      {active.length > 0 && (
        <TrendGroup
          title="Active Threads"
          accentClass="text-amber-400 border-amber-500/30"
          dotClass="bg-amber-500"
          labels={active}
          onSelect={onSelectLabel}
        />
      )}
      {subsiding.length > 0 && (
        <TrendGroup
          title="Subsiding"
          accentClass="text-slate-500 border-slate-700"
          dotClass="bg-slate-600"
          labels={subsiding}
          onSelect={onSelectLabel}
        />
      )}
      {emerging.length > 0 && (
        <TrendGroup
          title="New Signals"
          accentClass="text-emerald-400 border-emerald-500/30"
          dotClass="bg-emerald-500"
          labels={emerging}
          onSelect={onSelectLabel}
        />
      )}
    </div>
  );
}

function TrendGroup({
  title,
  accentClass,
  dotClass,
  labels,
  onSelect,
}: {
  title: string;
  accentClass: string;
  dotClass: string;
  labels: LabelSummary[];
  onSelect: (label: string) => void;
}) {
  return (
    <div>
      <div className={`flex items-center gap-2 mb-3 pb-2 border-b ${accentClass}`}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
        <span className={`text-[10px] font-bold uppercase tracking-widest font-mono ${accentClass.split(" ")[0]}`}>
          {title}
        </span>
        <span className="text-[10px] font-mono text-slate-700 ml-auto">{labels.length}</span>
      </div>
      <div className="space-y-2">
        {labels.map((l) => {
          const tr = TREND[l.lastTrend];
          return (
            <div
              key={l.label}
              className="flex items-start gap-3 group cursor-pointer"
              onClick={() => onSelect(l.label)}
            >
              <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5 w-28">
                {l.isSustainedEscalation && <span className="text-[9px] text-red-400">⚡</span>}
                {l.isRemerging && <span className="text-[9px] text-amber-400">↩</span>}
                <span className="text-[10px] font-bold font-mono text-slate-300 group-hover:text-white transition-colors truncate">
                  {l.label}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[10px] font-mono font-bold ${tr.cls}`}>{tr.icon}</span>
                  <span className="text-[10px] font-mono text-slate-600 truncate hidden sm:block">
                    {l.trendSparkline}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-[10px] font-mono text-slate-600">
                <span>{l.occurrences}×</span>
                <span className="text-slate-700">›</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SearchBox({
  query,
  onChange,
  loading,
}: {
  query: string;
  onChange: (q: string) => void;
  loading: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search across all threads…"
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-slate-500 font-mono"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-emerald-600 font-mono animate-pulse">
          …
        </span>
      )}
      {!loading && query && (
        <button
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 text-sm"
        >
          ×
        </button>
      )}
    </div>
  );
}

function LoadingSkeleton({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 animate-pulse ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 bg-slate-900 rounded-lg border border-slate-800" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function ThreadHistoryPanel() {
  const [tab, setTab] = useState<HistoryTab>("trends");
  const [days, setDays] = useState<Days>(30);
  // For cross-tab navigation: clicking a label in Trends jumps to Labels detail
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const handleSelectFromTrends = (label: string) => {
    setPendingLabel(label);
    setTab("labels");
  };

  // Clear pending after tab switch renders
  useEffect(() => {
    if (tab !== "labels") setPendingLabel(null);
  }, [tab]);

  return (
    <div>
      {/* Panel header */}
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-800/60 border border-slate-700/80 rounded-lg p-1">
          {(["trends", "labels", "sessions"] as HistoryTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all ${
                tab === t
                  ? "bg-slate-700 text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t === "trends" ? "⚡ Signals" : t === "labels" ? "◈ Labels" : "▦ Sessions"}
            </button>
          ))}
        </div>
        <DaySelector value={days} onChange={setDays} />
      </div>

      {tab === "sessions" && <SessionsTab days={days} />}
      {tab === "labels" && <LabelsTab days={days} key={pendingLabel ?? "labels"} />}
      {tab === "trends" && <TrendsTab days={days} onSelectLabel={handleSelectFromTrends} />}
    </div>
  );
}
