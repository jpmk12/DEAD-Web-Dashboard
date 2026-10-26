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
//
// Compressed to a STRIP (REVIEW-ECONOMY mockup item 3): one row of eight
// tiles (score · short name · lead-class chip · AIS chip), and the detail
// (why, AIS line, lead headline, georeferenced incidents) opens beneath for
// ONE selected tile. The actor board above is the headline; this is the
// evidence layer, so it must not take a screen of its own.

interface Transit {
  state: "unconfigured" | "unknown" | "learning" | "normal" | "suppressed" | "elevated";
  line: string;
  lastHour: number;
  distinctToday: number;
  observedMinutesToday: number;
  history?: { day: string; value: number }[];
  direction?: "rising" | "falling" | "flat" | null;
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
  transitLead?: { hits: number; events: number; medianLeadDays: number | null; label: string } | null;
}

// Transit sparkline: vessels-per-hour over the last qualifying days, scaled
// to the strait's own normal (the dashed reference). Four points before it
// draws — fewer is decoration.
function TransitSpark({ t }: { t: Transit }) {
  const h = t.history ?? [];
  if (h.length < 4) return null;
  const max = Math.max(...h.map((p) => p.value), t.baselinePerHour ?? 0, 0.1);
  const arrow = t.direction === "rising" ? "↗" : t.direction === "falling" ? "↘" : t.direction === "flat" ? "→" : "";
  return (
    <span className="flex items-end gap-px h-3 flex-shrink-0" title={`${h.length} observed days, vessels/h · ${t.direction ?? "trend forming"}`}>
      {h.map((p) => (
        <span key={p.day} className={`w-[3px] rounded-[1px] ${t.baselinePerHour != null && p.value / t.baselinePerHour <= 0.6 ? "bg-red-400" : "bg-sky-500/70"}`} style={{ height: `${Math.max(2, Math.round((p.value / max) * 12))}px` }} />
      ))}
      {arrow && <span className="text-[8px] text-slate-500 ml-0.5 leading-none">{arrow}</span>}
    </span>
  );
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
  rerouting: "rerouting", escort: "escort", approach: "approach", airspace: "airspace",
};

const MODALITY_CHIP: Record<Modality, { text: string; cls: string }> = {
  act: { text: "reported act", cls: "text-red-200 border-red-500/55 bg-red-500/15" },
  threat: { text: "declared threat", cls: "text-amber-200 border-amber-500/50 bg-amber-500/10" },
  analysis: { text: "analysis only", cls: "text-slate-400 border-slate-600 bg-slate-700/25" },
  reversal: { text: "reversal", cls: "text-emerald-200 border-emerald-500/40 bg-emerald-500/10" },
};

function scoreTone(n: number): string {
  if (n >= 70) return "text-red-300";
  if (n >= 40) return "text-amber-300";
  if (n > 0) return "text-slate-300";
  return "text-slate-600";
}

export default function ChokepointBoard({ active }: { active: boolean }) {
  const [signals, setSignals] = useState<Signal[] | null>(null);
  // The UKMTO door's state: the board must say whether the official record
  // was read, and through which door — an empty strait with a dead UKMTO
  // fetch and no capture is UNKNOWN, not calm.
  const [ukmto, setUkmto] = useState<{ live: boolean; count: number; reason: string | null; captured: number } | null>(null);
  // The MARAD door: the U.S. government's standing advisories by region — a
  // declared threat on every strait the region names. A dead feed is UNKNOWN.
  const [marad, setMarad] = useState<{ live: boolean; count: number; reason: string | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  const load = useCallback(() => {
    fetch("/api/markets/chokepoints")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.signals)) setSignals(d.signals);
        if (d?.ukmto && typeof d.ukmto === "object") setUkmto(d.ukmto);
        if (d?.marad && typeof d.marad === "object") setMarad(d.marad);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { if (armed) load(); }, [armed, load]);

  if (!signals) return null;
  const live = signals.filter((s) => s.score > 0);

  const sel = signals.find((s) => s.id === open) ?? null;

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-800 bg-slate-800/30">
        <span className="text-[11px] font-bold uppercase tracking-widest text-orange-300">⚓ Chokepoint interdiction</span>
        <span className="ml-auto text-[10px] text-slate-600">
          {live.length > 0 ? `${live.length} of ${signals.length} showing activity` : "nothing interdiction-shaped reported"}
        </span>
        {ukmto && (
          <span
            className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${ukmto.count > 0 ? (ukmto.live ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" : "text-sky-200 border-sky-500/40 bg-sky-500/10") : "text-amber-200 border-amber-500/50 bg-amber-500/10"}`}
            title={ukmto.count > 0
              ? `${ukmto.count} UKMTO incidents on the board (${ukmto.live ? "fetched from ukmto.org" : `from the browser capture — direct fetch: ${ukmto.reason ?? "failed"}`})`
              : `UKMTO unread — ${ukmto.reason ?? "no entries"}. Add https://www.ukmto.org/recent-incidents to the capture extension's targets.`}
          >
            UKMTO {ukmto.count > 0 ? ukmto.count : "UNKNOWN"}{ukmto.count > 0 && !ukmto.live ? " · captured" : ""}
          </span>
        )}
        {marad && (
          <span
            className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${marad.live ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" : "text-amber-200 border-amber-500/50 bg-amber-500/10"}`}
            title={marad.live
              ? `${marad.count} MARAD advisor${marad.count === 1 ? "y" : "ies"} in effect (maritime.dot.gov/msci-advisories) — each is a declared THREAT on the straits its region names, never an act`
              : `MARAD advisories unread — ${marad.reason ?? "feed unreachable"}. UNKNOWN, not "no advisory in effect".`}
          >
            MARAD {marad.live ? marad.count : "UNKNOWN"}
          </span>
        )}
      </div>

      {/* One row of tiles — the strip. Detail is one click away, below. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-slate-800/60">
        {signals.map((s) => {
          const isOpen = open === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setOpen(isOpen ? null : s.id)}
              className={`text-left bg-slate-900/80 px-2.5 py-2 min-w-0 hover:bg-slate-800/40 ${isOpen ? "bg-slate-800/60 ring-1 ring-inset ring-sky-500/40" : ""}`}
              title={s.line ?? s.why}
            >
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[15px] font-bold font-mono leading-none ${scoreTone(s.score)}`}>{s.score}</span>
                <span className="text-[10.5px] font-semibold text-slate-200 truncate">{s.name.replace(/ \/.*$/, "").replace(/ \(.*\)$/, "")}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 min-h-[14px]">
                {s.lead && (
                  <span className={`text-[7.5px] font-bold uppercase tracking-wider px-1 rounded border ${MODALITY_CHIP[s.lead.modality].cls}`}>{CLASS_LABEL[s.lead.cls]}</span>
                )}
                {s.transit && s.transit.state !== "unconfigured" && (
                  <span className={`text-[7.5px] font-bold uppercase tracking-wider px-1 rounded border ${TRANSIT_CHIP[s.transit.state].cls}`}>{s.transit.state === "unknown" ? "AIS" : s.transit.state === "learning" ? "AIS·learn" : s.transit.state}</span>
                )}
                {!s.lead && (!s.transit || s.transit.state === "unconfigured") && <span className="text-[8px] text-slate-500">quiet</span>}
                {s.transit && <span className="ml-auto"><TransitSpark t={s.transit} /></span>}
              </div>
            </button>
          );
        })}
      </div>

      {sel && (() => {
        const s = sel;
        return (
          <div className="px-3.5 py-2.5 space-y-2 border-t border-slate-800">
            <div className="flex items-baseline gap-2">
              <span className="text-[12.5px] font-semibold text-slate-100">{s.name}</span>
              <span className="text-[10px] text-slate-500">{s.line ?? "nothing interdiction-shaped reported"}</span>
            </div>
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
                    {s.transit.direction ? ` · fortnight ${s.transit.direction}` : ""}
                  </span>
                )}
                {/* Lead test: have suppressed transits preceded reported acts here?
                    Null below three acts on record — an anecdote is not a lead. */}
                {s.transitLead ? (
                  <span className="block text-[9.5px] text-slate-500 mt-0.5">Suppressed traffic {s.transitLead.label} reported act{s.transitLead.events === 1 ? "" : "s"} here (≤3 d) — confidence only, never a state.</span>
                ) : (
                  <span className="block text-[9px] text-slate-500 mt-0.5">Lead test needs three reported acts on record.</span>
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
        );
      })()}

      <p className="px-3.5 py-2 border-t border-slate-800 text-[9.5px] text-slate-600 leading-snug">
        Graded, not counted: an act outscores a declared intention, which outscores commentary — and georeferenced
        incidents from UCDP/ACLED and UKMTO&rsquo;s own incident log are joined by distance, so an attack nobody wrote a headline about still registers.
        A UKMTO entry is graded by its own label (ATTACK, SUSPICIOUS APPROACH, WARNING…) as the official record it is; one with no position is placed at the sea area it names and says so.
        A score of 0 means nothing interdiction-shaped was reported, not that the route is safe.
        {" "}AIS transit counts compare today&rsquo;s vessels-per-listened-hour with each strait&rsquo;s own baseline; they read UNKNOWN until the bridge has listened long enough, and the count only runs while the server is up.
      </p>
    </div>
  );
}
