"use client";

import { useEffect, useState } from "react";
import { NewsItem, NewsletterSummary, CalendarEvent } from "@/lib/types";
import { clientCache } from "@/lib/clientCache";
import { CACHE_KEY as BRIEFING_CACHE_KEY, getInflight } from "@/lib/briefingPrefetch";
import { BriefIcon, DigestIcon } from "@/lib/icons";
import { CACHE_KEY as DIGEST_CACHE_KEY, getInflight as getDigestInflight } from "@/lib/digestPrefetch";
import { buildBriefingHTML, buildDigestHTML, openPrintWindow, downloadHTML } from "@/lib/exports";

interface Briefing {
  headline: string;
  schedule: string[];
  keyDevelopments: string[];
  topStories: string[];
  connections: string;
  suggestedFocus: string[];
}

interface Digest {
  topTopics: string[];
  readingInsight: string;
  coverageGaps: string;
  nextWeekRecommendations: string[];
}

interface BriefingModalProps {
  open: boolean;
  mode: "briefing" | "digest";
  onClose: () => void;
  articles?: NewsItem[];
  newsletters?: NewsletterSummary[];
  calendarEvents?: CalendarEvent[];
}

export default function BriefingModal({
  open,
  mode,
  onClose,
  articles = [],
  newsletters = [],
  calendarEvents = [],
}: BriefingModalProps) {
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Force-regenerate today's briefing (busts both the server-side date cache
  // via ?refresh=1 and the in-memory client cache).
  const refreshBriefing = async () => {
    if (refreshing || loading) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/briefing?refresh=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles, newsletters, events: calendarEvents }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBriefing(data.briefing);
      clientCache.set(BRIEFING_CACHE_KEY, data.briefing, 15 * 60 * 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!open) { setError(null); return; }

    setError(null);
    let cancelled = false;
    const controller = new AbortController();

    if (mode === "briefing") {
      // 1. Cache hit — show immediately with no loading state
      const cached = clientCache.peek<Briefing>(BRIEFING_CACHE_KEY);
      if (cached) {
        setBriefing(cached);
        setLoading(false);
        return;
      }

      setLoading(true);

      // 2. In-flight background pre-fetch — await it instead of making a duplicate request
      const inflightPromise = getInflight();
      if (inflightPromise) {
        inflightPromise.then(() => {
          if (cancelled) return;
          const result = clientCache.peek<Briefing>(BRIEFING_CACHE_KEY);
          if (result) { setBriefing(result); }
          else { setError("Failed to generate briefing"); }
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
      }

      // 3. Nothing cached or in-flight — fetch now
      fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles, newsletters, events: calendarEvents }),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          if (data.error) throw new Error(data.error);
          setBriefing(data.briefing);
          clientCache.set(BRIEFING_CACHE_KEY, data.briefing, 15 * 60 * 1000);
        })
        .catch((e) => {
          if (cancelled || e.name === "AbortError") return;
          setError(e.message ?? "Failed to generate briefing");
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      setBriefing(null);
      // Reuse the prefetched digest if it's available; otherwise join an
      // in-flight prefetch or fall back to a fresh fetch.
      const cached = clientCache.peek<Digest>(DIGEST_CACHE_KEY);
      if (cached) {
        setDigest(cached);
        setLoading(false);
      } else if (getDigestInflight()) {
        setLoading(true);
        getDigestInflight()!
          .then(() => {
            if (cancelled) return;
            const result = clientCache.peek<Digest>(DIGEST_CACHE_KEY);
            if (result) setDigest(result);
            else setError("Digest prefetch did not produce a result");
          })
          .finally(() => { if (!cancelled) setLoading(false); });
      } else {
        setLoading(true);
        fetch("/api/digest", { signal: controller.signal })
          .then((r) => r.json())
          .then((data) => {
            if (cancelled) return;
            if (data.error) throw new Error(data.error);
            setDigest(data.digest);
            clientCache.set(DIGEST_CACHE_KEY, data.digest, 30 * 60 * 1000);
          })
          .catch((e) => {
            if (cancelled || e.name === "AbortError") return;
            setError(e.message ?? "Failed to generate digest");
          })
          .finally(() => { if (!cancelled) setLoading(false); });
      }
    }

    return () => { cancelled = true; controller.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  if (!open) return null;

  const isBriefing = mode === "briefing";

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
              isBriefing ? "bg-emerald-500/15 border border-emerald-500/30" : "bg-slate-800 border border-slate-700"
            }`}>
              {isBriefing ? (
                <BriefIcon size={16} strokeWidth={2.5} className="text-emerald-400" />
              ) : (
                <DigestIcon size={16} strokeWidth={2.25} className="text-slate-400" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-100">
                {isBriefing ? "Morning Brief" : "Weekly Digest"}
              </h2>
              <p className="text-[10px] text-slate-600 font-mono">
                {isBriefing ? "AI-generated situational overview" : "Reading patterns & recommendations"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isBriefing && briefing && (
              <button
                onClick={refreshBriefing}
                disabled={refreshing || loading}
                title="Regenerate today's brief from current articles"
                className="text-[11px] font-mono text-slate-400 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all disabled:opacity-40 disabled:cursor-wait"
              >
                {refreshing ? "↻ …" : "↻ Refresh"}
              </button>
            )}
            {((isBriefing && briefing) || (!isBriefing && digest)) && (
              <>
                <button
                  onClick={() => openPrintWindow(
                    isBriefing ? buildBriefingHTML(briefing!, true) : buildDigestHTML(digest!, true)
                  )}
                  title="Open print-ready PDF view"
                  className="text-[11px] font-mono text-slate-400 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all"
                >
                  PDF
                </button>
                <button
                  onClick={() => downloadHTML(
                    isBriefing ? buildBriefingHTML(briefing!, false) : buildDigestHTML(digest!, false),
                    isBriefing ? "morning-brief" : "weekly-digest"
                  )}
                  title="Download a standalone HTML copy"
                  className="text-[11px] font-mono text-slate-400 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all"
                >
                  HTML
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all text-lg"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
              <p className="text-xs text-slate-500 font-mono uppercase tracking-wider">
                {isBriefing ? "Generating brief…" : "Analysing reading patterns…"}
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm">{error}</div>
          )}

          {!loading && briefing && (
            <div className="space-y-6">
              {/* Headline */}
              <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-xl p-4">
                <p className="text-sm font-semibold text-slate-100 leading-relaxed">{briefing.headline}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {briefing.schedule?.length > 0 && (
                  <BriefSection title="Schedule" items={briefing.schedule} accent="text-amber-400" dot="bg-amber-400" />
                )}
                {briefing.keyDevelopments?.length > 0 && (
                  <BriefSection title="Key Developments" items={briefing.keyDevelopments} accent="text-emerald-400" dot="bg-emerald-400" />
                )}
              </div>

              {briefing.topStories?.length > 0 && (
                <BriefSection title="Top Stories" items={briefing.topStories} accent="text-blue-400" dot="bg-blue-400" />
              )}

              {briefing.connections && (
                <div>
                  <BriefHeader title="Cross-domain Connections" />
                  <p className="text-sm text-slate-300 leading-relaxed bg-slate-900/60 rounded-xl p-4 border border-slate-800">
                    {briefing.connections}
                  </p>
                </div>
              )}

              {briefing.suggestedFocus?.length > 0 && (
                <BriefSection title="Suggested Focus" items={briefing.suggestedFocus} accent="text-violet-400" dot="bg-violet-400" />
              )}
            </div>
          )}

          {!loading && digest && (
            <div className="space-y-6">
              {digest.topTopics?.length > 0 && (
                <div>
                  <BriefHeader title="Your Top Topics This Week" />
                  <div className="flex flex-wrap gap-2">
                    {digest.topTopics.map((t) => (
                      <span key={t} className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs px-3 py-1 rounded-lg font-mono font-medium">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {digest.readingInsight && (
                <div>
                  <BriefHeader title="Reading Patterns" />
                  <p className="text-sm text-slate-300 leading-relaxed bg-slate-900/60 rounded-xl p-4 border border-slate-800">
                    {digest.readingInsight}
                  </p>
                </div>
              )}

              {digest.coverageGaps && (
                <div>
                  <BriefHeader title="Coverage Gaps" />
                  <p className="text-sm text-slate-400 leading-relaxed bg-amber-500/5 rounded-xl p-4 border border-amber-500/20">
                    {digest.coverageGaps}
                  </p>
                </div>
              )}

              {digest.nextWeekRecommendations?.length > 0 && (
                <BriefSection
                  title="Recommendations for Next Week"
                  items={digest.nextWeekRecommendations}
                  accent="text-violet-400"
                  dot="bg-violet-400"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</span>
      <div className="flex-1 h-px bg-slate-800" />
    </div>
  );
}

function BriefSection({ title, items, accent, dot }: {
  title: string;
  items: string[];
  accent: string;
  dot: string;
}) {
  return (
    <div>
      <BriefHeader title={title} />
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 text-sm text-slate-300">
            <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${dot}`} />
            <span className="leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
