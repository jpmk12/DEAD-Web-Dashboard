"use client";

import { useCallback, useEffect, useState } from "react";
import type { Reactivation } from "@/lib/reactivation";
import { toast } from "@/lib/feedback";

// "You cared about this before — it just moved."
//
// The one card in the app that looks BACKWARDS. Every other surface answers
// "what is happening now"; this one answers "what that you already decided was
// worth keeping has just become live again". That connection is invisible
// everywhere else precisely because the interest is old and the signal is new,
// and no single pane holds both.
//
// Inherits the watchlist card's two rules: every row states its evidence, and
// dismissal is permanent. Renders nothing when there is nothing to say — a
// panel that is always present but usually empty trains you to skip it.

const KIND_CHIP: Record<string, string> = {
  iw: "text-red-300 border-red-500/45 bg-red-500/10",
  disaster: "text-orange-300 border-orange-500/45 bg-orange-500/10",
  mover: "text-amber-300 border-amber-500/45 bg-amber-500/10",
};
const KIND_LABEL: Record<string, string> = { iw: "I&W", disaster: "Disaster", mover: "Trending" };

export default function ReactivationCard({ active }: { active: boolean }) {
  const [items, setItems] = useState<Reactivation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  const load = useCallback(() => {
    fetch("/api/osint/reactivations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.items)) setItems(d.items); })
      .catch(() => {});
  }, []);

  useEffect(() => { if (armed) load(); }, [armed, load]);

  const dismiss = async (r: Reactivation) => {
    const key = `${r.interest.kind}:${r.interest.id}:${r.signal.term}`;
    setBusy(key);
    try {
      await fetch("/api/osint/reactivations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: r.interest.kind, id: r.interest.id, term: r.signal.term }),
      });
      // Drop locally rather than refetching — the signals haven't changed,
      // only our answer to them.
      setItems((prev) => prev.filter((x) => !(x.interest.id === r.interest.id && x.signal.term === r.signal.term)));
      toast.info(`Won't pair “${r.signal.term}” with that item again`);
    } catch { toast.error("Could not save that dismissal"); /* leave the row */ }
    finally { setBusy(null); }
  };

  const open = (r: Reactivation) => {
    if (r.interest.kind === "doc") {
      // Navigate to Docs, then hand the sidebar the title as a search — the
      // same `docs:search` channel the properties panel uses. Dispatched on a
      // tick so the Docs tab has mounted its listener before the query lands.
      window.dispatchEvent(new CustomEvent("app:navigate", { detail: "docs" }));
      setTimeout(() => window.dispatchEvent(new CustomEvent("docs:search", { detail: r.interest.title })), 60);
    } else if (r.interest.link) {
      window.open(r.interest.link, "_blank", "noopener,noreferrer");
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
        <span className="text-[11px] font-bold uppercase tracking-widest text-violet-300">↩ Back on the board</span>
        <span className="ml-auto text-[10px] text-slate-600">things you kept that just became active</span>
      </div>

      {items.map((r) => {
        const key = `${r.interest.kind}:${r.interest.id}:${r.signal.term}`;
        return (
          <div key={key} className="flex items-start gap-3 px-3.5 py-2 border-t border-slate-800/50 first:border-t-0">
            <span className={`mt-0.5 w-[62px] flex-shrink-0 text-center text-[9px] font-bold uppercase tracking-wider rounded py-0.5 border ${KIND_CHIP[r.signal.kind] ?? KIND_CHIP.mover}`}>
              {KIND_LABEL[r.signal.kind] ?? "Signal"}
            </span>
            <button onClick={() => open(r)} className="flex-1 min-w-0 text-left group">
              <span className="block text-[12.5px] font-semibold text-slate-100 truncate group-hover:text-violet-200">
                {r.interest.title}
              </span>
              <span className="block text-[10px] text-slate-500">{r.reason}</span>
            </button>
            <button
              onClick={() => dismiss(r)}
              disabled={busy !== null}
              title="Never pair this item with this term again"
              className="text-[9.5px] font-bold uppercase tracking-wider rounded px-2 py-1 border border-slate-700 text-slate-500 hover:text-slate-300 disabled:opacity-40"
            >
              {busy === key ? "…" : "Dismiss"}
            </button>
          </div>
        );
      })}

      <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
        Matched from your saved items and doc titles against today&apos;s trend movers, I&amp;W levels and disaster
        alerts — no model call. Only interests older than two weeks qualify, so this is memory, not an echo of
        what you just read. Dismissing a row is permanent.
      </p>
    </div>
  );
}
