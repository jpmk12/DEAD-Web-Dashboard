"use client";

import type { IcingRead } from "@/lib/icingSignals";
import type { XwindOutlook } from "@/lib/crosswind";
import type { TurbulenceRead } from "@/lib/turbulence";

// Two rows of the SITREP Weather card: icing at the field and on the approach
// (lib/icingSignals) and crosswind on the best runway across the next 24 h
// (lib/crosswind). Colour is the reads' own; UNKNOWN is said, never green.

const DOT: Record<string, string> = { r: "bg-red-500", a: "bg-amber-400", g: "bg-emerald-400", u: "bg-slate-600", i: "bg-sky-400" };
const TXT: Record<string, string> = { r: "text-red-300", a: "text-amber-300", g: "text-slate-300", u: "text-slate-400", i: "text-slate-400" };
const CHIP: Record<string, string> = {
  r: "border-red-500/50 text-red-300 bg-red-500/10",
  a: "border-amber-500/50 text-amber-300 bg-amber-500/10",
  g: "border-slate-700 text-slate-400",
  u: "border-slate-700 text-slate-500",
};
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`; };
const LEVEL_WORD: Record<string, string> = { r: "OBSERVED / WARNED", a: "EXPECTED", g: "NONE INDICATED", u: "UNKNOWN" };

export default function IcingCrosswind({ icing, crosswind, turbulence = null }: { icing: IcingRead | null; crosswind: XwindOutlook | null; turbulence?: TurbulenceRead | null }) {
  if (!icing && !crosswind && !turbulence) return null;
  return (
    <div className="mb-2.5 space-y-2.5">
      {icing && (
        <div className="border border-slate-800/60 rounded-lg px-2.5 py-2">
          <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span className={`w-2 h-2 rounded-full ${DOT[icing.level]}`} />
            Icing — field &amp; approach
            <span className={`font-mono normal-case tracking-normal ${TXT[icing.level]}`}>{LEVEL_WORD[icing.level]}</span>
            {icing.freezingLevel && (
              <span className="ml-auto font-normal normal-case tracking-normal text-slate-500" title="Model freezing level now">
                0 °C at {icing.freezingLevel.msl.toLocaleString("en-US")} ft MSL{icing.elevFt != null ? ` (${icing.freezingLevel.agl.toLocaleString("en-US")} AGL)` : ""}
              </span>
            )}
          </p>
          <p className={`text-[11px] mt-1 ${TXT[icing.level]}`}>{icing.summary}</p>
          {icing.drivers.length > 1 && (
            <ul className="mt-1 space-y-0.5">
              {icing.drivers.slice(1, 7).map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-[10.5px] text-slate-400">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${DOT[d.tone]}`} />
                  <span className="flex-1 min-w-0">{d.text}</span>
                  <span className="text-[8.5px] font-mono text-slate-600 flex-shrink-0">{d.source}</span>
                </li>
              ))}
            </ul>
          )}
          {icing.windows.length > 0 && <IcingStrip icing={icing} />}
          <p className="text-[9px] text-slate-600 mt-1">
            approach = field to 10,000 ft AGL, 30 NM · sources:{" "}
            {[
              ["METAR", icing.sources.metar],
              [icing.militaryTaf ? "TAF (military icing groups)" : "TAF", icing.sources.taf],
              ["model", icing.sources.model],
              ["SIGMET", icing.sources.sigmet],
              ["PIREP", icing.sources.pirep],
            ].map(([k, v]) => (
              <span key={String(k)} className={v === false ? "text-amber-300/80" : v == null ? "text-slate-700" : undefined}>
                {String(k)}{v === false ? " down" : v == null ? " n/a" : ""}{" "}
              </span>
            ))}
            · model layers are planning-grade (temperature + humidity), not an icing forecast product · no PIREP is not "no icing"
          </p>
        </div>
      )}

      {turbulence && (
        <div className="border border-slate-800/60 rounded-lg px-2.5 py-2">
          <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span className={`w-2 h-2 rounded-full ${DOT[turbulence.level]}`} />
            Turbulence &amp; wind shear — field &amp; approach
            <span className={`font-mono normal-case tracking-normal ${TXT[turbulence.level]}`}>{turbulence.level === "r" ? "OBSERVED / WARNED" : turbulence.level === "a" ? (turbulence.drivers.some((d) => d.tone === "a" && d.source === "PIREP") ? "REPORTED" : "FORECAST") : turbulence.level === "g" ? "NONE INDICATED" : "UNKNOWN"}</span>
          </p>
          <p className={`text-[11px] mt-1 ${TXT[turbulence.level]}`}>{turbulence.summary}</p>
          {turbulence.drivers.length > 1 && (
            <ul className="mt-1 space-y-0.5">
              {turbulence.drivers.slice(1, 6).map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-[10.5px] text-slate-400">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${DOT[d.tone]}`} />
                  <span className="flex-1 min-w-0">{d.text}</span>
                  <span className="text-[8.5px] font-mono text-slate-600 flex-shrink-0">{d.source}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[9px] text-slate-600 mt-1">
            sources: METAR{turbulence.sources.metar ? "" : " n/a"} · {turbulence.militaryTaf ? "TAF (military turbulence groups)" : turbulence.sources.taf ? "TAF (wind shear, gusts — a civil TAF has no turbulence groups)" : "TAF n/a"} · SIGMET{turbulence.sources.sigmet === false ? " down" : turbulence.sources.sigmet == null ? " n/a" : ""} · PIREP{turbulence.sources.pirep === false ? " down" : turbulence.sources.pirep == null ? " n/a" : ""} · gust spread ≥15 kt = mechanical turbulence near the ground (rule of thumb) · a TAF group is a forecast, never red
          </p>
        </div>
      )}

      {crosswind && (
        <div className="border border-slate-800/60 rounded-lg px-2.5 py-2">
          <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            <span className={`w-2 h-2 rounded-full ${DOT[crosswind.level]}`} />
            Crosswind — best runway, next 24 h
            <span className="ml-auto font-normal normal-case tracking-normal text-slate-600">{crosswind.source === "taf" ? "TAF" : crosswind.source === "model" ? "model (no TAF wind)" : ""}</span>
          </p>
          {crosswind.now && (
            <div className={`mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border px-2 py-1.5 ${CHIP[crosswind.now.flag]}`}>
              <span className="text-[10px] uppercase tracking-widest text-slate-400">Now</span>
              <span className="text-[11px] text-slate-300">RWY <b className="font-mono">{crosswind.now.ident}</b></span>
              <span className="text-[11px]">crosswind <b className="font-mono text-[15px]">{crosswind.now.crossKt}{crosswind.now.gustCrossKt ? <>G{crosswind.now.gustCrossKt}</> : null}</b> kt</span>
              <span className="text-[11px] text-slate-300">{crosswind.now.headKt >= 0 ? <>headwind <b className="font-mono">{crosswind.now.headKt}</b> kt</> : <span className="text-amber-300">TAILWIND <b className="font-mono">{-crosswind.now.headKt}</b> kt</span>}</span>
            </div>
          )}
          <p className={`text-[11px] mt-1 ${TXT[crosswind.level]}`}>{crosswind.summary}</p>
          {crosswind.rows.length > 0 && (
            <div className="mt-1.5 overflow-x-auto">
              <table className="w-full text-[10.5px] font-mono tabular-nums border-separate border-spacing-y-0.5">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-slate-500 font-sans">
                    <th className="text-left font-normal pr-2">Window (Z)</th>
                    <th className="text-left font-normal pr-2">Wind</th>
                    <th className="text-left font-normal pr-2">RWY</th>
                    <th className="text-right font-normal pr-2">Crosswind</th>
                    <th className="text-right font-normal pr-2">Head / tail</th>
                    <th className="text-left font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {crosswind.rows.map((r, i) => {
                    const risk = /TEMPO|PROB/.test(r.change);
                    return (
                      <tr key={i} className={risk ? "text-slate-400" : "text-slate-300"}>
                        <td className="pr-2 whitespace-nowrap">{hhmm(r.fromMs)}–{hhmm(r.toMs)}{r.change && r.change !== "model" ? <span className={`ml-1 text-[9px] ${risk ? "border border-dashed border-slate-600 rounded px-1" : "text-slate-500"}`}>{r.change}</span> : null}</td>
                        <td className="pr-2 whitespace-nowrap">{r.wind}</td>
                        <td className="pr-2">{r.best ? r.best.ident : "—"}</td>
                        <td className="pr-2 text-right whitespace-nowrap">
                          {r.best
                            ? <span className={`inline-block px-1.5 rounded border font-bold ${CHIP[r.flag]} ${risk ? "border-dashed" : ""}`}>{r.best.crossKt}{r.best.gustCrossKt ? `G${r.best.gustCrossKt}` : ""} kt</span>
                            : <span className="text-slate-500">{r.variable ? "variable — n/a" : "—"}</span>}
                        </td>
                        <td className="pr-2 text-right whitespace-nowrap">{r.best ? (r.best.headKt >= 0 ? `H ${r.best.headKt}` : <span className="text-amber-300">T {-r.best.headKt}</span>) : ""}</td>
                        <td className="text-amber-300 text-[9.5px] font-sans" title={r.contaminated ?? undefined}>{r.contaminated ? "ice / contaminated" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[9px] text-slate-600 mt-1">best runway = least crosswind with a headwind · crosswind in kt (G = gust component) · advisory bands 20 / 30 kt (gust 25 / 35), not flight-manual limits · dashed = TEMPO / PROB risk · &quot;ice&quot; = freezing or frozen precipitation in the same window</p>
        </div>
      )}
    </div>
  );
}

/** 30-h strip of model icing windows on the approach, solid = likely, faint = possible. */
function IcingStrip({ icing }: { icing: IcingRead }) {
  const start = Math.min(...icing.windows.map((w) => w.fromMs), Date.now());
  const span = 30 * 3_600_000;
  return (
    <div className="mt-1.5">
      <div className="relative h-3 rounded bg-slate-900 border border-slate-800 overflow-hidden" title="Model icing on the approach, next 30 h">
        {icing.windows.map((w, i) => {
          const left = Math.max(0, ((w.fromMs - start) / span) * 100);
          const width = Math.max(1.5, ((w.toMs - w.fromMs) / span) * 100);
          return (
            <span
              key={i}
              className={`absolute top-0 bottom-0 ${w.potential === "likely" ? "bg-amber-400/70" : "bg-sky-400/30"}`}
              style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
              title={`${w.potential} ${hhmm(w.fromMs)}–${hhmm(w.toMs)} · ${w.baseFtAgl}–${w.topFtAgl} ft AGL · ${w.maxC}…${w.minC} °C`}
            />
          );
        })}
      </div>
      <div className="relative h-2.5 text-[7.5px] text-slate-600 font-mono mt-0.5">
        <span className="absolute left-0">{hhmm(start)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: "40%" }}>+12h</span>
        <span className="absolute -translate-x-1/2" style={{ left: "80%" }}>+24h</span>
        <span className="absolute right-0">+30h</span>
      </div>
    </div>
  );
}
