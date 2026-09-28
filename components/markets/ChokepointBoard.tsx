"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityRead, InterdictionClass, Modality } from "@/lib/chokepointSignals";

// Chokepoint interdiction, graded rather than counted.
//
// What this replaces: a mention counter, in which a tanker struck by a missile
// and an op-ed about the strait scored identically. Every row here now states
// which KIND of claim it rests on, because that is the difference between an
// attack, a declaration of intent, and somebody's think piece — and they call
// for different decisions.
//
// A zero row is shown with its score, not hidden: "nothing interdiction-shaped
// reported" is information, and a board that silently drops quiet chokepoints
// cannot be distinguished from one whose feed died.

interface Transit {
  state: "unconfigured" | "unknown" | "learning" | "normal" | "suppressed" | "elevated";
  line: string;
  lastHour: number;
  distinctToday: number;
  observedMinutesToday: number;
  baselinePerHour: number | null;
  baselineDays: number;
}

interface Signal extends ActivityRead {
  id: string;
  name: string;
  why: string;
  radiusKm?: number;
  totalEvents: number;
  transit?: Transit;
}

// What ships DO, beside what people SAY. Colour only for a judged state.
const TRANSIT_CHIP: Record<Transit["state"], { text: string; cls: string }> = {
  unconfigured: { text: "AIS off", cls: "text-slate-600 border-slate-800" },
  unknown: { text: "AIS listening", cls: "text-slate-500 border-slate-700" },
  learning: { text: "AIS baseline forming", cls: "text-slate-400 border-slate-600" },
  normal: { text: "traffic normal", cls: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  suppressed: { text: "traffic suppressed", cls: "text-red-200 border-red-500/55 bg-red-500/15" },
  elevated: { text: "traffic elevated", cls: "text-amber-200 border-amber-500/50 bg-amber-500/10" },
};

const CLASS_LABEL: Record<InterdictionClass, string> = {
  strike: "strike", seizure: "seizure", mining: "mining", closure: "closure",
  rerouting: "rerouting", escort: "escort", airspace: "airspace",
};

const MODALITY_CHIP: Record<Modality, { text: string; cls: string }> = {
  act: { text: "reported act", cls: "text-red-200 border-red-500/55 bg-red-500/15" },
  threat: { text: "declared threat", cls: "text-amber-200 border-amber-500/50 bg-amber-500/10" },
  analysis: { text: "analysis only", cls: "text-slate-400 border-slate-600 bg-slate-700/25" },
};

function scoreTone(n: number): string {
  if (n >= 70) return "text-red-300";
  if (n >= 40) return "text-amber-300";
  if (n > 0) return "text-slate-300";
  return "text-slate-600";
}

export default function ChokepointBoard({ active }: { active: boolean }) {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  const load = useCallback(() => {
    fetch("/api/markets/chokepoints")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.signals)) setSignals(d.signals); })
      .catch(() => {});
  }, []);

  useEffect(() => { if (armed) load(); }, [armed, load]);

  if (!signals) return null;
  const live = signals.filter((s) => s.score > 0);

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
        <span className="text-[11px] font-bold uppercase tracking-widest text-orange-300">⚓ Chokepoint interdiction</span>
        <span className="ml-auto text-[10px] text-slate-600">
          {live.length > 0 ? `${live.length} of ${signals.length} showing activity` : "nothing interdiction-shaped reported"}
        </span>
      </div>

      {signals.map((s) => {
        const isOpen = open === s.id;
        return (
          <div key={s.id} className="border-t border-slate-800/60 first:border-t-0">
            <button
              onClick={() => setOpen(isOpen ? null : s.id)}
              className="w-full flex items-center gap-3 px-3.5 py-2 text-left hover:bg-slate-800/20"
            >
              <span className={`w-[30px] flex-shrink-0 text-right text-[13px] font-bold font-mono ${scoreTone(s.score)}`}>
                {s.score}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-slate-100 truncate">{s.name}</span>
                <span className="block text-[10px] text-slate-500 truncate">{s.line ?? s.why}</span>
              </span>
              {s.lead && (
                <span className={`flex-shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${MODALITY_CHIP[s.lead.modality].cls}`}>
                  {CLASS_LABEL[s.lead.cls]}
                </span>
              )}
              {s.transit && s.transit.state !== "unconfigured" && (
                <span className={`hidden sm:inline flex-shrink-0 text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${TRANSIT_CHIP[s.transit.state].cls}`} title={s.transit.line}>
                  {TRANSIT_CHIP[s.transit.state].text}
                </span>
              )}
              <span className="flex-shrink-0 text-slate-600 text-[10px]">{isOpen ? "▾" : "▸"}</span>
            </button>

            {isOpen && (
              <div className="px-3.5 pb-2.5 space-y-2">
                <p className="text-[10px] text-slate-500 leading-snug">{s.why}</p>

                {s.transit && (
                  <div className="text-[10.5px]">
                    <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border mr-1.5 ${TRANSIT_CHIP[s.transit.state].cls}`}>
                      AIS · {TRANSIT_CHIP[s.transit.state].text}
                    </span>
                    <span className="text-slate-300">{s.transit.line}</span>
                    {s.transit.state !== "unconfigured" && (
                      <span className="block text-[9.5px] text-slate-600 mt-0.5">
                        {s.transit.distinctToday} distinct vessels today over {s.transit.observedMinutesToday} min listened · {s.transit.lastHour} in the last hour
                        {s.transit.baselinePerHour !== null ? ` · normal ${s.transit.baselinePerHour.toFixed(1)}/h from ${s.transit.baselineDays} observed days` : ""}
                      </span>
                    )}
                  </div>
                )}

                {s.lead ? (
                  <div className="text-[11px]">
                    <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border mr-1.5 ${MODALITY_CHIP[s.lead.modality].cls}`}>
                      {MODALITY_CHIP[s.lead.modality].text}
                    </span>
                    {s.lead.link
                      ? <a href={s.lead.link} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-orange-300 underline decoration-slate-700">{s.lead.title}</a>
                      : <span className="text-slate-200">{s.lead.title}</span>}
                    <span className="block text-[9.5px] text-slate-600 mt-0.5">
                      matched &ldquo;{s.lead.phrase}&rdquo;{s.lead.source ? ` · ${s.lead.source}` : ""}
                    </span>
                  </div>
                ) : (
                  <p className="text-[10.5px] text-slate-600">
                    No interdiction-shaped reporting. A mention of the name alone scores nothing here.
                  </p>
                )}

                {s.events.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-1">
                      Georeferenced incidents within {s.radiusKm ?? 300} km
                      {s.totalEvents > s.events.length ? ` · showing ${s.events.length} of ${s.totalEvents}` : ""}
                    </p>
                    {s.events.map((e) => (
                      <div key={e.id} className="flex items-start gap-2 text-[10.5px] py-0.5">
                        <span className="font-mono text-slate-600 flex-shrink-0 w-[58px]">
                          {e.ageDays === null ? "undated" : e.ageDays === 0 ? "today" : `${e.ageDays}d ago`}
                        </span>
                        <span className="text-slate-300 flex-1 min-w-0">{e.title}</span>
                        <span className="font-mono text-slate-600 flex-shrink-0">{e.distanceKm} km</span>
                        {e.source && <span className="text-[9px] text-slate-600 flex-shrink-0">{e.source}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
        Graded, not counted: an act outscores a declared intention, which outscores commentary — and georeferenced
        incidents from UCDP/ACLED are joined by distance, so an attack nobody wrote a headline about still registers.
        A score of 0 means nothing interdiction-shaped was reported, not that the route is safe.
        {" "}AIS transit counts compare today&rsquo;s vessels-per-listened-hour with each strait&rsquo;s own baseline; they read UNKNOWN until the bridge has listened long enough, and the count only runs while the server is up.
      </p>
    </div>
  );
}
