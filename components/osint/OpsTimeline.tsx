"use client";

import { useMemo, useState } from "react";
import { windowsWithNotams, rangeLabel, type OpsTimeline as Timeline, type TlLane, type TlSeg, type Tone, type ClosureLike, type LimitWindow } from "@/lib/opsTimeline";

// The 72-hour ops timeline (lib/opsTimeline): one hourly axis, a lane per
// operational question (sky · precip · temperature · ground ice · runway ·
// icing aloft · crosswind · ramp · NOTAMs), night shaded underneath, and the
// LIMITING WINDOWS listed beneath — the merged amber stretches with every
// factor that drives them. Tap a bar for its sentence; tap a window to light
// it across the lanes. Model reads are dashed; TEMPO / PROB risk is dashed.

const H = 3_600_000;

const TONE_BAR: Record<Tone, string> = {
  r: "bg-red-500/30 border-red-500/70 text-red-100",
  a: "bg-amber-500/25 border-amber-500/65 text-amber-100",
  i: "bg-sky-500/15 border-sky-500/45 text-sky-200",
  g: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200/80",
  u: "bg-transparent border-slate-500/60 text-slate-400",
};
const CAT_BAR: Record<string, string> = {
  VFR: "bg-emerald-500/20 border-emerald-500/45 text-emerald-200",
  MVFR: "bg-sky-500/30 border-sky-400/60 text-sky-100",
  IFR: "bg-red-500/30 border-red-500/65 text-red-100",
  LIFR: "bg-fuchsia-500/35 border-fuchsia-400/70 text-fuchsia-100",
};
const LIGHT_BG: Record<string, string> = {
  day: "",
  civil: "bg-indigo-950/25",
  nautical: "bg-indigo-950/45",
  night: "bg-indigo-950/70",
};

function Lane({ lane, pct, sel, onSel, hours }: { lane: TlLane; pct: (ms: number) => number; sel: TlSeg | null; onSel: (s: TlSeg | null, lane: TlLane) => void; hours: number }) {
  return (
    <div className="flex items-center gap-2 h-[22px]">
      <span className="w-[86px] flex-shrink-0 text-right text-[9px] font-semibold text-slate-400 truncate" title={lane.unknown ?? lane.title}>
        {lane.title}{lane.unknown ? <span className="text-slate-600"> ?</span> : null}
      </span>
      <div className="relative flex-1 h-[18px] rounded bg-slate-800/20">
        {lane.segs.map((s, i) => {
          const left = pct(s.fromMs), width = Math.max(0.6, pct(s.toMs) - left);
          const showText = width > (s.label.length * 1.15 * 72) / hours;
          const cls = lane.key === "sky" && s.cat ? CAT_BAR[s.cat] : TONE_BAR[s.tone];
          const isSel = sel === s;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSel(isSel ? null : s, lane)}
              title={`${lane.title} · ${rangeLabel(s.fromMs, s.toMs)} — ${s.detail}`}
              className={`absolute top-[1px] bottom-[1px] rounded-[3px] border px-0.5 text-[8px] font-bold leading-none flex items-center justify-center overflow-hidden whitespace-nowrap ${cls} ${s.dashed ? "border-dashed" : ""} ${isSel ? "ring-2 ring-sky-300 z-10" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              {showText ? s.label : ""}
            </button>
          );
        })}
        {lane.segs.length === 0 && lane.unknown && (
          <span className="absolute inset-0 flex items-center px-2 text-[8.5px] text-slate-500 italic truncate">{lane.unknown}</span>
        )}
      </div>
    </div>
  );
}

function TempLane({ tl, pct }: { tl: Timeline; pct: (ms: number) => number }) {
  const pts = tl.temps;
  const vals = pts.flatMap((p) => [p.c, p.dew]).filter((v): v is number => v != null);
  if (!vals.length) {
    return (
      <div className="flex items-center gap-2 h-[22px]">
        <span className="w-[86px] flex-shrink-0 text-right text-[9px] font-semibold text-slate-400">Temp °C</span>
        <span className="text-[8.5px] text-slate-500 italic">UNKNOWN — the model profile did not answer</span>
      </div>
    );
  }
  const lo = Math.min(...vals, -2), hi = Math.max(...vals, 2);
  const W = tl.hours, HGT = 40;
  const y = (c: number) => HGT - ((c - lo) / (hi - lo)) * HGT;
  const line = (f: (p: (typeof pts)[number]) => number | null) =>
    pts.map((p, k) => { const v = f(p); return v == null ? null : `${k + 0.5},${y(v).toFixed(1)}`; }).filter(Boolean).join(" ");
  const y0 = y(0);
  return (
    <div className="flex items-center gap-2 h-[46px]">
      <span className="w-[86px] flex-shrink-0 text-right text-[9px] font-semibold text-slate-400 leading-tight">
        Temp °C<br /><span className="font-mono font-normal text-slate-500">{tl.temp.minC ?? "—"} / {tl.temp.maxC ?? "—"}</span>
      </span>
      <div className="relative flex-1 h-[42px] rounded bg-slate-800/20 overflow-hidden">
        <svg viewBox={`0 0 ${W} ${HGT}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          {/* Below-freezing hours shaded. */}
          {pts.map((p, k) => (p.c != null && p.c <= 0 ? <rect key={k} x={k} y={0} width={1} height={HGT} fill="rgb(56 189 248 / 0.10)" /> : null))}
          <line x1={0} x2={W} y1={y0} y2={y0} stroke="rgb(125 211 252 / 0.7)" strokeWidth={0.6} strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
          <polyline points={line((p) => p.dew)} fill="none" stroke="rgb(148 163 184 / 0.7)" strokeWidth={1} strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
          <polyline points={line((p) => p.c)} fill="none" stroke="rgb(241 245 249)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          {/* Hover targets, one per hour. */}
          {pts.map((p, k) => (
            <rect key={`h${k}`} x={k} y={0} width={1} height={HGT} fill="transparent">
              <title>{`${rangeLabel(p.t, p.t + H)} · ${p.c ?? "—"} °C · dew ${p.dew ?? "—"} °C · feels ${p.feels ?? "—"} °C${p.fzlFtAgl != null ? ` · 0 °C level ${p.fzlFtAgl.toLocaleString("en-US")} ft AGL` : ""}`}</title>
            </rect>
          ))}
        </svg>
        {tl.temp.crossings.map((c, i) => (
          <span key={i} className="absolute top-0 text-[8px] font-bold text-sky-300 -translate-x-1/2" style={{ left: `${pct(c.t)}%` }} title={`${c.dir === "down" ? "Falls to" : "Rises above"} 0 °C ${rangeLabel(c.t, c.t + H)}`}>
            {c.dir === "down" ? "↓0°" : "↑0°"}
          </span>
        ))}
        <span className="absolute right-1 text-[7.5px] text-sky-300/80 font-mono" style={{ top: `${Math.max(0, Math.min(88, (y0 / HGT) * 100 - 12))}%` }}>0°</span>
      </div>
    </div>
  );
}

export default function OpsTimeline({ tl, closures }: { tl: Timeline; closures: ClosureLike[] }) {
  const [sel, setSel] = useState<{ seg: TlSeg; lane: string } | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const { lane: notam, windows } = useMemo(() => windowsWithNotams(tl, closures), [tl, closures]);
  const span = tl.hours * H;
  const pct = (ms: number) => Math.max(0, Math.min(100, ((ms - tl.startMs) / span) * 100));

  if (!tl.live) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Next 72 h — ops timeline</p>
        <p className="text-[10.5px] text-slate-500 mt-1">{tl.summary}</p>
      </section>
    );
  }

  // Axis: Zulu day starts and 6-hour ticks.
  const ticks: { ms: number; label: string; day: boolean }[] = [];
  for (let ms = Math.ceil(tl.startMs / (6 * H)) * 6 * H; ms < tl.startMs + span; ms += 6 * H) {
    const d = new Date(ms);
    const day = d.getUTCHours() === 0;
    ticks.push({ ms, day, label: day ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}` : `${String(d.getUTCHours()).padStart(2, "0")}Z` });
  }
  const top = tl.lanes.filter((l) => l.key === "sky" || l.key === "precip");
  const rest = [...tl.lanes.filter((l) => l.key !== "sky" && l.key !== "precip"), notam];
  const hiWin: LimitWindow | null = hi != null ? windows[hi] ?? null : null;
  const amber = windows.length > 0;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5">
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Next 72 h — ops timeline</p>
        <span className="text-[9px] text-slate-500">all times Z · model planning-grade · the TAF governs its window</span>
        <button type="button" onClick={() => setKeyOpen((v) => !v)} aria-expanded={keyOpen} className="ml-auto text-[9px] text-slate-500 hover:text-slate-300">key {keyOpen ? "▴" : "▾"}</button>
      </div>
      <p className={`text-[11px] mb-2 ${amber ? "text-amber-200" : "text-slate-400"}`}>{windows.length ? `${windows.length} limiting window${windows.length === 1 ? "" : "s"} in 72 h — first ${rangeLabel(windows[0].fromMs, windows[0].toMs)}` : tl.summary}</p>
      {keyOpen && (
        <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-[9.5px] text-slate-400 space-y-0.5">
          <p><span className="inline-block w-3 h-2 rounded-sm bg-amber-500/40 border border-amber-500/70 align-middle mr-1" />limiting (a forecast is amber at most; crosswind keeps its own bands) · <span className="inline-block w-3 h-2 rounded-sm bg-sky-500/25 border border-sky-500/50 align-middle mr-1" />note · dashed = model read or TEMPO / PROB risk</p>
          <p>Sky = flight category: the TAF in its window, model VISIBILITY only beyond it (ceiling is not modelled). Shading under the lanes = civil / nautical twilight and night. Temp: white = air, dotted = dew point, blue shading = at or below 0 °C, ↓0° / ↑0° = crossings.</p>
          <p>Ground ice = frost, freezing fog, glaze, de-ice / anti-ice. Runway = ice, snow, standing water, refreeze. Ramp = lightning holds, gusts at door / stand limits, wind chill, heat. Thresholds are planning guidance, not your de-ice policy or a flight manual.</p>
        </div>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[660px]">
          {/* axis */}
          <div className="flex items-end gap-2 h-4">
            <span className="w-[86px] flex-shrink-0" />
            <div className="relative flex-1 h-4">
              {ticks.map((t, i) => (
                <span key={i} className={`absolute bottom-0 -translate-x-1/2 text-[8px] font-mono whitespace-nowrap ${t.day ? "text-slate-300 font-bold" : "text-slate-600"}`} style={{ left: `${pct(t.ms)}%` }}>{t.label}</span>
              ))}
              {tl.tafEndMs != null && tl.tafEndMs > tl.startMs && tl.tafEndMs < tl.startMs + span && (
                <span className="absolute bottom-0 text-[7.5px] text-sky-300/80 pl-0.5 whitespace-nowrap" style={{ left: `${pct(tl.tafEndMs)}%` }}>TAF ends</span>
              )}
            </div>
          </div>

          <div className="relative">
            {/* light, ticks, TAF end and the highlighted window under every lane */}
            <div className="absolute top-0 bottom-0 right-0 pointer-events-none" style={{ left: "94px" }}>
              {tl.light.map((l, i) => (l.state === "day" ? null : <span key={i} className={`absolute top-0 bottom-0 ${LIGHT_BG[l.state]}`} style={{ left: `${pct(l.fromMs)}%`, width: `${pct(l.toMs) - pct(l.fromMs)}%` }} />))}
              {ticks.map((t, i) => <span key={i} className={`absolute top-0 bottom-0 border-l ${t.day ? "border-slate-500/50" : "border-slate-700/40"}`} style={{ left: `${pct(t.ms)}%` }} />)}
              {tl.tafEndMs != null && tl.tafEndMs < tl.startMs + span && <span className="absolute top-0 bottom-0 border-l border-dashed border-sky-400/60" style={{ left: `${pct(tl.tafEndMs)}%` }} />}
              {hiWin && <span className="absolute top-0 bottom-0 bg-amber-300/10 border-x border-amber-300/60" style={{ left: `${pct(hiWin.fromMs)}%`, width: `${pct(hiWin.toMs) - pct(hiWin.fromMs)}%` }} />}
            </div>
            <div className="relative space-y-[2px] py-0.5">
              {top.map((l) => <Lane key={l.key} lane={l} pct={pct} hours={tl.hours} sel={sel?.seg ?? null} onSel={(s, ln) => setSel(s ? { seg: s, lane: ln.title } : null)} />)}
              <TempLane tl={tl} pct={pct} />
              {rest.map((l) => <Lane key={l.key} lane={l} pct={pct} hours={tl.hours} sel={sel?.seg ?? null} onSel={(s, ln) => setSel(s ? { seg: s, lane: ln.title } : null)} />)}
            </div>
          </div>
        </div>
      </div>

      {sel && (
        <p className="mt-1.5 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-[10.5px] text-slate-200">
          <b className="text-slate-100">{sel.lane}</b> <span className="font-mono text-slate-400">{rangeLabel(sel.seg.fromMs, sel.seg.toMs)}</span> — {sel.seg.detail}
        </p>
      )}

      {/* Limiting windows */}
      <div className="mt-2 pt-2 border-t border-slate-800/60">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Limiting windows</p>
        {windows.length === 0 && <p className="text-[10.5px] text-slate-500">None in 72 h — {tl.summary.replace(/^Next 72 h: no limiting window — /, "")}</p>}
        <ul className="space-y-1">
          {windows.map((w, i) => (
            <li key={i}>
              <button type="button" onClick={() => setHi(hi === i ? null : i)} aria-pressed={hi === i}
                className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors ${hi === i ? "border-amber-400/60 bg-amber-500/10" : "border-slate-800 hover:border-slate-600 bg-slate-950/30"}`}>
                <span className="flex items-center gap-2 flex-wrap">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${w.tone === "r" ? "bg-red-500" : "bg-amber-400"}`} />
                  <span className="font-mono text-[10.5px] text-slate-200">{rangeLabel(w.fromMs, w.toMs)}</span>
                  <span className="text-[9px] text-slate-500">{Math.round((w.toMs - w.fromMs) / H)} h</span>
                  {w.factors.map((f, k) => (
                    <span key={k} className="text-[8.5px] font-bold uppercase tracking-wider rounded border border-slate-700 bg-slate-800/60 text-slate-300 px-1 py-[1px]">{f.label}</span>
                  ))}
                </span>
                {hi === i && (
                  <ul className="mt-1 ml-4 list-disc text-[10px] text-slate-300 space-y-0.5">
                    {w.factors.map((f, k) => <li key={k}>{f.detail}</li>)}
                  </ul>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
