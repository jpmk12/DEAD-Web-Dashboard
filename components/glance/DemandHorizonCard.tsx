"use client";

import { useEffect, useState } from "react";
import { AOR_LABELS, type Aor } from "@/lib/aor";
import type { DemandOutlook, DemandDriver } from "@/lib/demandHorizon";

// 7-day demand horizon — the forecast the north star names.
//
// One row per combatant command: demand likely to RISE / HOLD / FALL, with
// confidence as a count of independent sensors and every driver listed with
// its weight when expanded. Deterministic, so a row can be argued with.
//
// A HOLD with no drivers is rendered as exactly that — "no signals", never
// "calm" — and the footer names which sensor families answered so an
// all-HOLD board on a broken feed cannot pass for a quiet world.

interface Body {
  horizonDays: number;
  generatedAt: string;
  outlooks: DemandOutlook[];
  sources: Record<string, boolean>;
}

const DIR = {
  rise: { chip: "▲ rise", cls: "text-red-300 border-red-500/45 bg-red-500/10" },
  hold: { chip: "▶ hold", cls: "text-slate-400 border-slate-700 bg-slate-800/40" },
  fall: { chip: "▼ fall", cls: "text-emerald-300 border-emerald-500/45 bg-emerald-500/10" },
} as const;

const CONF: Record<DemandOutlook["confidence"], string> = { high: "●●●", medium: "●●○", low: "●○○" };
const SRC_LABEL: Record<DemandDriver["source"], string> = { iw: "I&W", disaster: "HADR", neo: "NEO", posture: "Posture", chokepoint: "Strait" };

export default function DemandHorizonCard() {
  const [body, setBody] = useState<Body | null>(null);
  const [open, setOpen] = useState<Aor | null>(null);
  const [folded, setFolded] = useState(false);
  // Team state against the same demand: the declared crew counts joined to
  // each command's outlook (lib/crewState). Per-AOR lines keyed by AOR.
  const [crew, setCrew] = useState<{ headline: string; byAor: Record<string, { line: string; mismatch: boolean; posture: string }>; declared: boolean; stale: boolean } | null>(null);

  useEffect(() => {
    try { setFolded(localStorage.getItem("glance.demandFolded") === "1"); } catch { /* ignore */ }
    fetch("/api/demand-horizon")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && Array.isArray(j.outlooks)) setBody(j); })
      .catch(() => {});
    fetch("/api/team/crew")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.posture) return;
        const byAor: Record<string, { line: string; mismatch: boolean; posture: string }> = {};
        for (const l of j.posture.lines ?? []) byAor[l.aor] = { line: l.line, mismatch: !!l.mismatch, posture: l.posture };
        setCrew({ headline: j.posture.headline ?? "", byAor, declared: (j.summary?.total ?? 0) > 0, stale: !!j.summary?.stale });
      })
      .catch(() => {});
  }, []);

  const toggleFold = () => {
    setFolded((f) => { try { localStorage.setItem("glance.demandFolded", f ? "0" : "1"); } catch { /* ignore */ } return !f; });
  };

  if (!body) return null;

  const rising = body.outlooks.filter((o) => o.direction === "rise").length;
  const falling = body.outlooks.filter((o) => o.direction === "fall").length;
  const answered = Object.entries(body.sources).filter(([, v]) => v).map(([k]) => SRC_LABEL[k as DemandDriver["source"]] ?? k);
  const silent = Object.entries(body.sources).filter(([, v]) => !v).map(([k]) => SRC_LABEL[k as DemandDriver["source"]] ?? k);

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <button type="button" onClick={toggleFold} className="w-full flex items-center gap-2 px-3.5 py-2 text-left hover:bg-slate-800/40">
        <span className="text-slate-500 text-xs w-3">{folded ? "▸" : "▾"}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">{body.horizonDays}-day demand horizon</span>
        <span className="text-[10px] text-slate-500 truncate">
          {rising > 0 ? `${rising} command${rising === 1 ? "" : "s"} likely to rise` : "no command likely to rise"}
          {falling > 0 ? ` · ${falling} likely to fall` : ""}
        </span>
        <span className="ml-auto text-[9px] text-slate-600 flex-shrink-0">deterministic · no model</span>
      </button>

      {!folded && (
        <div>
          {/* Team posture against this demand — the other half of the equation. */}
          {crew && (
            <div className={`px-3.5 py-1.5 border-t border-slate-800/60 text-[10.5px] ${Object.values(crew.byAor).some((x) => x.mismatch) ? "text-amber-200 bg-amber-500/[0.05]" : crew.declared ? "text-slate-300" : "text-slate-500"}`}>
              <span className="text-[8.5px] font-bold uppercase tracking-wider text-slate-500 mr-2">Crews</span>
              {crew.headline}
              {!crew.declared && <span className="text-slate-600"> — declare counts in Preferences → Mission Profile → Team state.</span>}
            </div>
          )}
          {body.outlooks.map((o) => {
            const d = DIR[o.direction];
            const isOpen = open === o.aor;
            return (
              <div key={o.aor} className="border-t border-slate-800/60">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : o.aor)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-1.5 text-left hover:bg-slate-800/30"
                  aria-expanded={isOpen}
                >
                  <span className={`w-[56px] flex-shrink-0 text-center text-[8.5px] font-bold uppercase tracking-wider rounded py-0.5 border ${d.cls}`}>{d.chip}</span>
                  <span className="text-[11.5px] font-bold text-slate-200 w-[92px] flex-shrink-0 truncate">{AOR_LABELS[o.aor] ?? o.aor}</span>
                  <span className="flex-1 min-w-0 text-[10.5px] text-slate-400 truncate">
                    {o.drivers.length === 0 ? "no demand signals on the board" : o.drivers.slice(0, 2).map((x) => x.text).join(" · ")}
                  </span>
                  <span className="text-[9px] font-mono text-slate-500 flex-shrink-0" title={`${o.sources} independent source${o.sources === 1 ? "" : "s"}`}>{CONF[o.confidence]}</span>
                  <span className={`text-[10px] font-mono flex-shrink-0 ${o.score > 0 ? "text-amber-300" : o.score < 0 ? "text-emerald-300" : "text-slate-600"}`}>
                    {o.score > 0 ? "+" : ""}{o.score}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3.5 pb-2.5 pl-[76px] space-y-1">
                    {o.drivers.length === 0 && (
                      <p className="text-[10px] text-slate-500">Absence of signal, not evidence of calm — sensors that answered: {answered.join(", ") || "none"}.</p>
                    )}
                    {o.drivers.map((dr, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10.5px]">
                        <span className="w-[46px] flex-shrink-0 text-[8px] font-bold uppercase tracking-wider text-slate-500 pt-0.5">{SRC_LABEL[dr.source]}</span>
                        <span className="flex-1 text-slate-300">{dr.text}</span>
                        <span className={`font-mono flex-shrink-0 ${dr.delta > 0 ? "text-amber-300" : "text-emerald-300"}`}>{dr.delta > 0 ? "+" : ""}{dr.delta}</span>
                      </div>
                    ))}
                    {crew?.byAor[o.aor] && (
                      <p className={`text-[10px] pt-1 ${crew.byAor[o.aor].mismatch ? "text-amber-300" : "text-slate-400"}`}>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-slate-500 mr-1">Crews</span>{crew.byAor[o.aor].line}
                      </p>
                    )}
                    <p className="text-[9.5px] text-slate-600 pt-1">{o.line}</p>
                  </div>
                )}
              </div>
            );
          })}
          <p className="px-3.5 py-1.5 border-t border-slate-800/60 text-[9px] text-slate-600">
            Sensors answered: {answered.join(", ") || "none"}{silent.length ? ` · silent: ${silent.join(", ")}` : ""} · rise ≥ +25, fall ≤ −15 · confidence = independent sources
          </p>
        </div>
      )}
    </section>
  );
}
