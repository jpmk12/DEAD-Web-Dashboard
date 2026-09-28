"use client";

import { useEffect, useState } from "react";
import type { OeDelta, Transition } from "@/lib/oeDelta";

// What changed since you last looked — the front door's first card.
//
// The north star's verb is "see CHANGES in the operational environment", and
// until now the front door led with day-cached prose while the live, earned
// signals sat below it. This card leads with what moved: worse first, then
// improved, then new. Improvements are shown with the same weight as
// degradations — the first place in the app an OPENING is first-class.
//
// It renders nothing when nothing moved. A card that is always present but
// usually empty trains you to skip it — and "nothing changed" is itself worth
// a single quiet line, so that line is all it shows.

const KIND_LABEL: Record<string, string> = { posture: "Posture", sitrep: "SITREP", iw: "I&W" };

const TONE = {
  worse: "text-red-300 border-red-500/45 bg-red-500/10",
  better: "text-emerald-300 border-emerald-500/45 bg-emerald-500/10",
  new: "text-amber-300 border-amber-500/45 bg-amber-500/10",
} as const;

function Row({ t }: { t: Transition }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-1.5 border-t border-slate-800/50 first:border-t-0">
      <span className={`w-[58px] flex-shrink-0 text-center text-[8.5px] font-bold uppercase tracking-wider rounded py-0.5 border ${TONE[t.direction]}`}>
        {t.direction === "new" ? "new" : t.direction === "worse" ? "▲ worse" : "▼ better"}
      </span>
      <span className="text-[8px] font-bold uppercase tracking-wider text-slate-500 w-[44px] flex-shrink-0">{KIND_LABEL[t.kind]}</span>
      <span className="flex-1 min-w-0 text-[11.5px] text-slate-200 truncate">{t.reason}</span>
      <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">{t.day.slice(5)}</span>
    </div>
  );
}

export default function OeDeltaCard() {
  const [d, setD] = useState<OeDelta | null>(null);

  useEffect(() => {
    fetch("/api/oe-delta")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && typeof j.sinceDay === "string") setD(j); })
      .catch(() => {});
  }, []);

  if (!d) return null;

  const total = d.worse.length + d.better.length + d.fresh.length;
  if (total === 0) {
    return (
      <p className="text-[10.5px] text-slate-600 px-1">
        ◇ No posture, SITREP or I&amp;W level changed since {d.firstLook ? "yesterday" : "your last look"}.
      </p>
    );
  }

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
        <span className="text-[11px] font-bold uppercase tracking-widest text-sky-300">◇ What moved</span>
        <span className="ml-auto text-[10px] text-slate-500">{d.line}</span>
      </div>
      {d.worse.map((t) => <Row key={`w-${t.id}-${t.axis ?? ""}`} t={t} />)}
      {d.better.map((t) => <Row key={`b-${t.id}-${t.axis ?? ""}`} t={t} />)}
      {d.fresh.map((t) => <Row key={`n-${t.id}-${t.axis ?? ""}`} t={t} />)}
      {d.firstLook && (
        <p className="px-3.5 py-1.5 border-t border-slate-800 text-[9.5px] text-slate-600">
          First look — compared with yesterday. From now on this compares with your last visit.
        </p>
      )}
    </section>
  );
}
