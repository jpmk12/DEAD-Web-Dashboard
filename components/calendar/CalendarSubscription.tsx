"use client";

import { useState } from "react";

// The iCal subscription lives with the calendar it describes (REVIEW-2026-10
// §12): rendered under a fold in the Calendar header, and by the
// Preferences → Connections section for the people who look there.
export default function CalendarSubscription({ compact = false }: { compact?: boolean } = {}) {
  const [copied, setCopied] = useState(false);
  // Built from window.location so it always reflects the current host.
  const httpsUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/calendar/ical`
    : "/api/calendar/ical";
  const webcalUrl = typeof window !== "undefined"
    ? `webcal://${window.location.host}/api/calendar/ical`
    : "";

  const copy = async () => {
    try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable */ }
  };

  return (
    <div className={compact ? "" : "mb-5"}>
      {!compact && (
        <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
          Apple Calendar / iCal Feed
        </label>
      )}
      <p className="text-[10px] text-slate-500 mb-2">
        Subscribe to your upcoming events in any iCal-compatible app (Apple Calendar, iOS, Outlook).
        The feed is session-authenticated — copy the URL while signed in.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-3 py-2 text-[11px] text-slate-300 font-mono truncate" title={httpsUrl}>
          {httpsUrl}
        </code>
        <button
          onClick={copy}
          className="flex-shrink-0 text-[11px] text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all font-mono"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {webcalUrl && (
          <a
            href={webcalUrl}
            className="flex-shrink-0 text-[11px] text-emerald-500 hover:text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/60 px-2.5 py-1.5 rounded-md transition-all font-mono"
          >
            Open in Apple Calendar
          </a>
        )}
      </div>
    </div>
  );
}
