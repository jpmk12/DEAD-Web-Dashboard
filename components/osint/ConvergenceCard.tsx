"use client";

import { useCallback, useEffect, useState } from "react";
import { convergenceLine, KIND_LABEL, type Convergence } from "@/lib/convergence";

// Where several independent surfaces are pointing at one place.
//
// The claim on every row is BREADTH, not intensity: any one of these signals is
// already visible on its own pane, and none of those panes can see the others.
// So the row leads with the number of agreeing surfaces and the colour follows
// breadth, not severity — a red disaster alone is not a finding here, it is a
// disaster, and the Crisis map already says so.
//
// Renders nothing when nothing converges. Deliberately no dismiss control: this
// is derived live from current conditions, not a recommendation, so there is
// nothing to decline — it disappears on its own when the surfaces disagree
// again.

const KIND_TONE: Record<string, string> = {
  iw: "text-red-300 border-red-500/45",
  posture: "text-orange-300 border-orange-500/45",
  sitrep: "text-amber-300 border-amber-500/45",
  disaster: "text-orange-200 border-orange-400/40",
  economic: "text-emerald-300 border-emerald-500/40",
  feed: "text-slate-300 border-slate-600",
  pair: "text-sky-200 border-sky-500/40",
};

export default function ConvergenceCard({ active }: { active: boolean }) {
  const [items, setItems] = useState<Convergence[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  const load = useCallback(() => {
    fetch("/api/osint/convergence")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.items)) setItems(d.items); })
      .catch(() => {});
  }, []);

  // Refresh on the same 10-min cadence as the I&W strip. Every source behind
  // this route is cached, so a poll costs one join, not fifteen fetches.
  useEffect(() => {
    if (!armed) return;
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [armed, load]);

  if (items.length === 0) return null;

  return (
    <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
        <span className="text-[11px] font-bold uppercase tracking-widest text-sky-300">⊕ Converging</span>
        <span className="ml-auto text-[10px] text-slate-600">independent surfaces pointing at one place</span>
      </div>

      {items.map((c) => {
        const isOpen = open === c.subject;
        return (
          <div key={c.subject} className="border-t border-slate-800/50 first:border-t-0">
            <button
              onClick={() => setOpen(isOpen ? null : c.subject)}
              className="w-full flex items-center gap-3 px-3.5 py-2 text-left hover:bg-slate-800/20"
            >
              <span className={`w-[26px] flex-shrink-0 text-center text-[13px] font-bold font-mono ${
                c.breadth >= 4 ? "text-red-300" : c.breadth === 3 ? "text-orange-300" : "text-amber-300"
              }`}>
                {c.breadth}×
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100 truncate">{c.subject}</span>
                <span className="block text-[10px] text-slate-500">{convergenceLine(c)}</span>
              </span>
              <span className="flex-shrink-0 flex items-center gap-1">
                {c.signals.map((s) => (
                  <span key={s.kind} className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${KIND_TONE[s.kind] ?? KIND_TONE.feed}`}>
                    {KIND_LABEL[s.kind]}
                  </span>
                ))}
              </span>
              <span className="flex-shrink-0 text-slate-600 text-[10px]">{isOpen ? "▾" : "▸"}</span>
            </button>

            {isOpen && (
              <div className="px-3.5 pb-2.5 space-y-1">
                {c.signals.map((s) => (
                  <div key={s.kind} className="flex items-start gap-2 text-[11px]">
                    <span className={`mt-[1px] w-[58px] flex-shrink-0 text-center text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border ${KIND_TONE[s.kind] ?? KIND_TONE.feed}`}>
                      {KIND_LABEL[s.kind]}
                    </span>
                    <span className="text-slate-300 flex-1 min-w-0">{s.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
        A join over feeds, I&amp;W, disasters, force posture and base status — all already cached, no model call.
        Ranked by how many <em>independent</em> surfaces agree: several alerts from one source is one story told
        twice, not corroboration.
      </p>
    </div>
  );
}
