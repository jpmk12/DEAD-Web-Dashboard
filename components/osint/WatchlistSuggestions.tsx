"use client";

import { useCallback, useEffect, useState } from "react";
import type { WatchlistSuggestions } from "@/lib/watchlistSuggest";

// Watchlist recommendations, derived from the app's own signal history.
//
// Two rules the card is built around:
//   1. Every row states its evidence. A recommendation without a reason is a
//      nag, and the user has no way to judge it.
//   2. Dismiss is permanent. A suggestion that comes back after being declined
//      is worse than one that never appeared — it teaches you to ignore the
//      panel, which is the same failure the I&W board's "colour is earned"
//      rule exists to prevent.
//
// Removals are the half nobody asks for: a watchlist only ever grows, and
// every dead term costs attention on every screen that renders it.

export default function WatchlistSuggestionsCard() {
  const [s, setS] = useState<WatchlistSuggestions | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch("/api/osint/watchlist-suggestions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setS(d); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { if (!loaded) load(); }, [loaded, load]);

  const act = async (action: string, term: string, direction?: string) => {
    setBusy(`${action}:${term}`);
    setErr(null);
    try {
      const res = await fetch("/api/osint/watchlist-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, term, direction }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.error) throw new Error(j?.error || "Save failed");
      // Drop the acted-on row locally rather than refetching: the trend data
      // hasn't changed, only our answer to it.
      setS((prev) => prev && {
        add: prev.add.filter((a) => a.term !== term),
        drop: prev.drop.filter((d) => d.term !== term),
      });
      window.dispatchEvent(new CustomEvent("watchlist:changed"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  if (!s || (s.add.length === 0 && s.drop.length === 0)) return null;

  const btn = "text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border transition-colors disabled:opacity-40";

  return (
    <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden mb-4">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
        <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">◈ Watchlist recommendations</span>
        <span className="ml-auto text-[10px] text-slate-600">from your own feeds · last 7 days vs the 7 before</span>
      </div>

      {err && <p className="px-3.5 py-2 text-[11px] text-red-400 border-b border-slate-800">{err}</p>}

      {s.add.length > 0 && (
        <div>
          <p className="px-3.5 pt-2.5 pb-1 text-[9.5px] font-bold uppercase tracking-widest text-slate-600">
            Surging in your feeds — not on your watchlist
          </p>
          {s.add.map((a) => (
            <div key={a.term} className="flex items-center gap-3 px-3.5 py-2 border-t border-slate-800/50">
              <span className={`w-[52px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border ${
                a.state === "new"
                  ? "text-emerald-300 border-emerald-500/45 bg-emerald-500/10"
                  : "text-amber-300 border-amber-500/45 bg-amber-500/10"
              }`}>
                {a.state}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100 truncate">{a.term}</span>
                <span className="block text-[10px] text-slate-500">{a.reason} · {a.kind}</span>
              </span>
              <button
                onClick={() => act("add", a.term)}
                disabled={busy !== null}
                className={`${btn} border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20`}
              >
                {busy === `add:${a.term}` ? "…" : "＋ Watch"}
              </button>
              <button
                onClick={() => act("dismiss", a.term, "add")}
                disabled={busy !== null}
                className={`${btn} border-slate-700 text-slate-500 hover:text-slate-300`}
              >
                Never
              </button>
            </div>
          ))}
        </div>
      )}

      {s.drop.length > 0 && (
        <div>
          <p className="px-3.5 pt-2.5 pb-1 text-[9.5px] font-bold uppercase tracking-widest text-slate-600 border-t border-slate-800">
            Watched but quiet — costing attention, returning nothing
          </p>
          {s.drop.map((d) => (
            <div key={d.term} className="flex items-center gap-3 px-3.5 py-2 border-t border-slate-800/50">
              <span className="w-[52px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border text-slate-400 border-slate-600 bg-slate-700/30">
                fading
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100 truncate">{d.term}</span>
                <span className="block text-[10px] text-slate-500">{d.reason}</span>
              </span>
              <button
                onClick={() => act("remove", d.term)}
                disabled={busy !== null}
                className={`${btn} border-slate-600 bg-slate-700/30 text-slate-300 hover:bg-slate-700/60`}
              >
                {busy === `remove:${d.term}` ? "…" : "Remove"}
              </button>
              <button
                onClick={() => act("dismiss", d.term, "drop")}
                disabled={busy !== null}
                className={`${btn} border-slate-700 text-slate-500 hover:text-slate-300`}
              >
                Keep
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
        Computed from the signal counts your feeds, news, threads and conflict sources already write — no model
        call. Declining a row is permanent.
      </p>
    </div>
  );
}
