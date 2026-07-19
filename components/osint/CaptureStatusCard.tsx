"use client";

import { useEffect, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";

// At-a-glance confirmation that the browser-capture sources landed — analysis
// articles (📄, toolbar-click capture) and LiveUAMap events (🗺, scheduled sweep).
// Both ride the OSINT feed; this card just makes their arrival OBSERVABLE (like
// the X card does for posts) so "did it work?" is a glance, not a hunt.

interface Status {
  count: number;
  newest: string | null;
  sources: { label: string; count: number }[];
}

function useCaptureStatus(url: string) {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(() => {
    fetch(url).then((r) => r.json()).then((d) => { if (typeof d?.count === "number") setStatus(d); }).catch(() => {});
  }, [url]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);
  return { status, refresh };
}

export default function CaptureStatusCard({ onChanged }: { onChanged: () => void }) {
  const arts = useCaptureStatus("/api/capture/article");
  const evts = useCaptureStatus("/api/capture/events");

  const clear = async (url: string, refresh: () => void, label: string) => {
    if (!window.confirm(`Remove all captured ${label}?`)) return;
    await fetch(url, { method: "DELETE" }).catch(() => {});
    refresh();
    onChanged();
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-slate-300 font-bold text-xs">Captured sources</span>
        <span className="text-[10px] text-slate-600 font-mono">browser-capture → feed</span>
      </div>

      <CaptureRow
        icon="📄" label="Analysis articles"
        status={arts.status}
        empty="Click the extension's toolbar icon while reading an article (WSJ / FP / Economist) to capture it."
        onClear={() => clear("/api/capture/article", arts.refresh, "analysis articles")}
      />
      <CaptureRow
        icon="🗺" label="Map events"
        status={evts.status}
        empty="Add LiveUAMap region URLs (iran.liveuamap.com …) to the extension's capture targets."
        onClear={() => clear("/api/capture/events", evts.refresh, "map events")}
      />
    </div>
  );
}

function CaptureRow({ icon, label, status, empty, onClear }: {
  icon: string; label: string; status: Status | null; empty: string; onClear: () => void;
}) {
  const has = (status?.count ?? 0) > 0;
  return (
    <div className="border-t border-slate-800/60 pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold text-slate-300">{icon} {label}</span>
        <span className="text-[10px] text-slate-500 font-mono">
          {status === null ? "…" : has
            ? `${status.count} loaded${status.newest ? ` · newest ${formatDistanceToNow(new Date(status.newest), { addSuffix: true })}` : ""}`
            : "none yet"}
        </span>
        <div className="flex-1" />
        {has && (
          <button type="button" onClick={onClear} className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:border-red-500/40 hover:text-red-400 transition-all">✕ Clear</button>
        )}
      </div>
      {has && status && status.sources.length > 0 ? (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono mt-1.5">
          {status.sources.map((s) => (
            <span key={s.label} className="px-1.5 py-0.5 rounded border border-slate-700/80 text-slate-400">
              {s.label} <span className="text-slate-600">×{s.count}</span>
            </span>
          ))}
        </div>
      ) : (
        !has && <p className="text-[10px] text-slate-600 leading-snug mt-1">{empty}</p>
      )}
    </div>
  );
}
