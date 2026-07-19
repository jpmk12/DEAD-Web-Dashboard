"use client";

import XImportCard from "@/components/osint/XImportCard";
import CaptureStatusCard from "@/components/osint/CaptureStatusCard";

// The OSINT ingestion control room — one home for everything the dashboard pulls
// in. Browser-captured sources (𝕏 posts, 📄 analysis, 🗺 events) and the live
// RSS/Telegram feed health, so "what am I ingesting and is it flowing" is one
// place instead of buried in the Social feed.

interface FeedSummary {
  id: string;
  label: string;
  kind: string;
  count: number;
  ok?: boolean;
  fetchedAt?: number;
}

// Synthetic feed rows for the capture stores — shown by the cards below, so we
// don't repeat them in the live-feed health list.
const CAPTURE_FEED_IDS = new Set(["x-import", "article-capture", "event-capture"]);

export default function SourcesPane({ feeds, onChanged }: { active: boolean; feeds: FeedSummary[]; onChanged: () => void }) {
  const liveFeeds = feeds.filter((f) => !CAPTURE_FEED_IDS.has(f.id));
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-slate-100">⇪ Sources</h2>
        <span className="text-[11px] text-slate-500">everything you ingest — browser captures feed the whole tab (Social, News, and I&amp;W corroboration).</span>
      </div>

      <XImportCard onImported={onChanged} />
      <CaptureStatusCard onChanged={onChanged} />

      {/* Live RSS / Telegram feed health */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-300 font-bold text-xs">Live feeds</span>
          <span className="text-[10px] text-slate-600 font-mono">RSS · Telegram · server-fetched</span>
          <div className="flex-1" />
          <span className="text-[10px] text-slate-600">Add / edit in Preferences → Sources &amp; feeds</span>
        </div>
        {liveFeeds.length === 0 ? (
          <p className="text-[10px] text-slate-600 leading-snug">No RSS/Telegram feeds configured. Add OSINT feeds (news sites, public Telegram channels, Reddit/Bluesky/Mastodon RSS) in Preferences.</p>
        ) : (
          <div className="space-y-1">
            {liveFeeds.map((f) => (
              <div key={f.id} className="flex items-center gap-2 text-[11px]">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.ok === false ? "bg-red-500" : "bg-emerald-500"}`} title={f.ok === false ? "Last fetch failed" : "OK"} />
                <span className="text-slate-300 truncate flex-1 min-w-0">{f.label}</span>
                <span className="text-[9px] font-mono uppercase tracking-wider text-slate-600 flex-shrink-0">{f.kind}</span>
                <span className="text-[10px] font-mono text-slate-500 w-8 text-right flex-shrink-0">{f.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
