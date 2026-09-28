"use client";

import { useEffect, useMemo, useState } from "react";
import { CLASS_LABEL, type RegulatoryAction, type RegulatoryClass, type RegulatorySummary } from "@/lib/regulatorySignals";

// U.S. regulatory actions — sanctions, export controls, tariffs — from the
// Federal Register. The missing data class on the Economy tab: economic
// warfare reached the board only when a news feed happened to carry it.
//
// Labelled U.S.-only on the panel itself, because a board titled "sanctions"
// that silently omits the other side's counter-measures would mislead.
// A failed query is named in the footer; an empty list never reads as
// "no actions".

interface Body {
  live: boolean;
  failed: string[];
  fetchedAt: string;
  windowDays: number;
  watched: string[];
  summary: RegulatorySummary;
  actions: RegulatoryAction[];
}

const CLS: Record<RegulatoryClass, string> = {
  sanctions: "text-red-200 border-red-500/45 bg-red-500/10",
  "export-control": "text-amber-200 border-amber-500/45 bg-amber-500/10",
  tariff: "text-sky-200 border-sky-500/45 bg-sky-500/10",
  other: "text-slate-400 border-slate-600 bg-slate-700/25",
};

const ORDER: RegulatoryClass[] = ["sanctions", "export-control", "tariff", "other"];

export default function RegulatoryBoard({ active }: { active: boolean }) {
  const [body, setBody] = useState<Body | null>(null);
  const [armed, setArmed] = useState(false);
  const [filter, setFilter] = useState<RegulatoryClass | "all" | "watch">("all");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);
  useEffect(() => {
    if (!armed) return;
    fetch("/api/markets/regulatory")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.actions)) setBody(d); })
      .catch(() => {});
  }, [armed]);

  const rows = useMemo(() => {
    if (!body) return [];
    const f = filter === "all" ? body.actions : filter === "watch" ? body.actions.filter((a) => a.touchesWatch) : body.actions.filter((a) => a.cls === filter);
    return showAll ? f : f.slice(0, 8);
  }, [body, filter, showAll]);

  if (!body) return null;

  const filteredTotal = filter === "all" ? body.actions.length : filter === "watch" ? body.summary.touchingWatch : body.summary.byClass[filter];

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-600">
          Sanctions · export controls · tariffs — <span className="text-slate-500">U.S. Federal Register, last {body.windowDays}d</span>
        </p>
        <span className="text-[9px] font-mono text-slate-600">{body.summary.recent} in 7d{body.summary.touchingWatch ? ` · ${body.summary.touchingWatch} name a watched country` : ""}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {(["all", "watch", ...ORDER] as const).map((k) => {
          const n = k === "all" ? body.actions.length : k === "watch" ? body.summary.touchingWatch : body.summary.byClass[k];
          if (k !== "all" && n === 0) return null;
          const on = filter === k;
          return (
            <button key={k} type="button" onClick={() => { setFilter(k); setShowAll(false); }}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${on ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>
              {k === "all" ? "All" : k === "watch" ? "Touches watch" : CLASS_LABEL[k]} <span className="font-mono">{n}</span>
            </button>
          );
        })}
      </div>

      {!body.live ? (
        <p className="text-[11px] text-red-300">Federal Register did not answer — status UNKNOWN, not &ldquo;no actions&rdquo;.</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-slate-600">No {filter === "all" ? "" : filter === "watch" ? "watch-touching " : `${CLASS_LABEL[filter].toLowerCase()} `}actions in the window.</p>
      ) : (
        <ul className="divide-y divide-slate-800/60">
          {rows.map((a) => (
            <li key={a.documentNumber} className="flex items-start gap-2.5 py-1.5">
              <span className="text-[9px] font-mono text-slate-600 flex-shrink-0 w-[42px] pt-0.5" title={a.publicationDate}>{a.publicationDate.slice(5)}</span>
              <span className={`text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 ${CLS[a.cls]}`}>{CLASS_LABEL[a.cls]}</span>
              <span className="min-w-0 flex-1">
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-sky-200/90 hover:text-sky-100 leading-snug block">{a.title}</a>
                <span className="text-[9.5px] text-slate-600">
                  {a.agencies[0]?.name ?? a.type}{a.instrument ? ` · ${a.instrument}` : ""}{a.countries.length ? ` · ${a.countries.join(", ")}` : ""}
                </span>
              </span>
              {a.touchesWatch && <span className="text-[9px] font-bold text-amber-400 flex-shrink-0" title="Names a watched country">⚑</span>}
            </li>
          ))}
        </ul>
      )}

      {filteredTotal > 8 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1.5 text-[10px] text-slate-500 hover:text-slate-300">
          {showAll ? "Show fewer" : `Show all ${filteredTotal}`}
        </button>
      )}

      <p className="text-[9px] text-slate-700 mt-2">
        U.S. actions only — foreign counter-measures (retaliatory tariffs, host-nation export bans) arrive via news and your feeds, not here.
        {body.failed.length > 0 && <span className="text-amber-500/80"> Queries that failed this pass: {body.failed.join(", ")}.</span>}
      </p>
    </div>
  );
}
