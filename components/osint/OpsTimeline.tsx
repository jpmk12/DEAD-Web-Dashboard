"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { windowsWithNotams, packRows, rangeLabel, sliceAt, changePoints, zuluStamp, spanText, type OpsTimeline as Timeline, type TlLane, type Tone, type ClosureLike, type LimitWindow, type SliceTone } from "@/lib/opsTimeline";

// The 72-hour ops timeline (lib/opsTimeline): one hourly axis, a lane per
// operational question (sky · precip · temperature · ground ice · runway ·
// icing aloft · crosswind · ramp · NOTAMs), night shaded underneath, and the
// LIMITING WINDOWS listed beneath — the merged amber stretches with every
// factor that drives them. Move the mouse (or drag a finger) along it: a
// cursor carries the Zulu time and the readout beneath reads EVERY lane at
// that hour — the words live there, so a phone shows all 72 h at once. Click /
// tap pins it; ← → step an hour, Shift + ← → jump to the next change. Tap a
// window to light it and put the cursor on its start. Model reads and TEMPO /
// PROB risk are dashed.

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

const LABEL_COL = 94; // 86-px label column + 8-px gap

/** A bar label that fits: the full label, else the short one, else nothing. */
function fitLabel(label: string, short: string | undefined, px: number): string {
  const need = (t: string) => t.length * 5.4 + 6;
  if (px >= need(label)) return label;
  if (short && px >= need(short)) return short;
  return "";
}

function Lane({ lane, pct, trackPx }: { lane: TlLane; pct: (ms: number) => number; trackPx: number }) {
  const placed = packRows(lane.segs);
  const rows = Math.max(1, ...placed.map((p) => p.row + 1));
  const rowH = rows === 1 ? 18 : 15;
  const overflow = placed.filter((p) => p.over).length;
  return (
    <div className="flex items-center gap-2" style={{ height: rows * rowH + 4 }}>
      <span className="w-[86px] flex-shrink-0 text-right text-[9px] font-semibold text-slate-400 truncate" title={lane.unknown ?? lane.title}>
        {lane.title}{lane.unknown ? <span className="text-slate-600"> ?</span> : null}
        {rows > 1 && <span className="block font-normal text-[8px] text-slate-500">{lane.segs.length} overlap{overflow ? ` (+${overflow})` : ""}</span>}
      </span>
      <div className="relative flex-1 rounded bg-slate-800/20" style={{ height: rows * rowH }}>
        {lane.segs.map((s, i) => {
          const left = pct(s.fromMs), width = Math.max(0.6, pct(s.toMs) - left);
          const cls = lane.key === "sky" && s.cat ? CAT_BAR[s.cat] : TONE_BAR[s.tone];
          const { row, over } = placed[i];
          return (
            <span
              key={i}
              className={`absolute rounded-[3px] border px-0.5 text-[8px] font-bold leading-none flex items-center justify-center overflow-hidden whitespace-nowrap ${cls} ${s.dashed ? "border-dashed" : ""}`}
              style={{ left: `${left}%`, width: `${width}%`, top: row * rowH + 1, height: rowH - 2 }}
            >
              {over ? "" : fitLabel(s.label, s.short, (width / 100) * trackPx)}
            </span>
          );
        })}
        {lane.segs.length === 0 && lane.unknown && (
          <span className="absolute inset-0 flex items-center px-2 text-[8.5px] text-slate-500 italic truncate">{lane.unknown}</span>
        )}
      </div>
    </div>
  );
}

/** 0 °C crossings closer than a label's width are one marker: the air
 *  hovering at freezing reads "±0°" (its times in the tooltip), never a pile
 *  of arrows on top of each other. */
function crossingMarks(cs: Timeline["temp"]["crossings"], pct: (ms: number) => number, trackPx: number) {
  const groups: { px: number; items: typeof cs }[] = [];
  for (const c of cs) {
    const px = (pct(c.t) / 100) * trackPx;
    const last = groups[groups.length - 1];
    if (last && px - last.px < 30) last.items.push(c);
    else groups.push({ px, items: [c] });
  }
  return groups.map((g) => ({
    px: g.px,
    label: g.items.length === 1 ? (g.items[0].dir === "down" ? "↓0°" : "↑0°") : "±0°",
    title: g.items.map((c) => `${c.dir === "down" ? "falls below" : "rises above"} 0 °C ${zuluStamp(c.t, false)}`).join(" · "),
  }));
}

function TempLane({ tl, pct, trackPx }: { tl: Timeline; pct: (ms: number) => number; trackPx: number }) {
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
  const marks = crossingMarks(tl.temp.crossings, pct, trackPx);
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
        </svg>
        {marks.map((m, i) => (
          <span key={i} title={m.title} className="absolute top-0 text-[8px] font-bold text-sky-300 bg-slate-950/50 rounded-sm px-px"
            style={{ left: m.px, transform: m.px < 14 ? "none" : m.px > trackPx - 14 ? "translateX(-100%)" : "translateX(-50%)" }}>
            {m.label}
          </span>
        ))}
        {/* The 0 °C level label sits on the side no crossing marker uses. */}
        <span className={`absolute text-[7.5px] text-sky-300/80 font-mono ${marks.some((m) => m.px > trackPx - 44) ? "left-1" : "right-1"}`} style={{ top: `${Math.max(0, Math.min(88, (y0 / HGT) * 100 - 12))}%` }}>0°</span>
      </div>
    </div>
  );
}

const RO_TONE: Record<SliceTone, string> = {
  r: "text-red-300 font-semibold", a: "text-amber-200 font-semibold", i: "text-sky-300", g: "text-emerald-300/90", u: "text-slate-400 italic", n: "text-slate-500",
};

/** "0615 CET" in the field's own zone — null when the zone is unknown. */
function localStamp(ms: number, zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).formatToParts(ms);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("hour")}${get("minute")} ${get("timeZoneName")}`.trim();
  } catch { return null; }
}

export default function OpsTimeline({ tl, closures, zone }: { tl: Timeline; closures: ClosureLike[]; zone?: string | null }) {
  const [cur, setCur] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [hi, setHi] = useState<number | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [trackPx, setTrackPx] = useState(600);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const trackRef = useRef<HTMLDivElement | null>(null);
  const { lane: notam, windows } = useMemo(() => windowsWithNotams(tl, closures), [tl, closures]);
  const changes = useMemo(() => changePoints(tl, [notam]), [tl, notam]);
  const span = tl.hours * H;
  const endMs = tl.startMs + span;
  const pct = useCallback((ms: number) => Math.max(0, Math.min(100, ((ms - tl.startMs) / span) * 100)), [tl.startMs, span]);

  // Bar labels are fitted to real pixels, so a phone can show all 72 h at once.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => { for (const e of es) setTrackPx(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tl.live]);

  const slice = useMemo(() => (cur != null ? sliceAt(tl, [notam], windows, cur) : null), [cur, tl, notam, windows]);

  if (!tl.live) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Next 72 h — ops timeline</p>
        <p className="text-[10.5px] text-slate-500 mt-1">{tl.summary}</p>
      </section>
    );
  }

  const nowMs = Date.now();
  const nowIn = nowMs >= tl.startMs && nowMs < endMs;
  const msAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.min(endMs - 60_000, Math.round((tl.startMs + f * span) / 60_000) * 60_000);
  };
  const step = (dir: 1 | -1, toChange: boolean) => {
    const from = cur ?? (nowIn ? nowMs : tl.startMs);
    let to = from + dir * H;
    if (toChange) {
      const c = dir > 0 ? changes.find((x) => x > from + 1) : [...changes].reverse().find((x) => x < from - 1);
      if (c != null) to = c;
    }
    setCur(Math.min(endMs - 60_000, Math.max(tl.startMs, to)));
    setPinned(true);
  };

  // Axis: Zulu day starts and 6-hour ticks.
  const ticks: { ms: number; label: string; day: boolean }[] = [];
  for (let ms = Math.ceil(tl.startMs / (6 * H)) * 6 * H; ms < endMs; ms += 6 * H) {
    const d = new Date(ms);
    const day = d.getUTCHours() === 0;
    ticks.push({ ms, day, label: day ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}` : `${String(d.getUTCHours()).padStart(2, "0")}Z` });
  }
  const top = tl.lanes.filter((l) => l.key === "sky" || l.key === "precip");
  const rest = [...tl.lanes.filter((l) => l.key !== "sky" && l.key !== "precip"), notam];
  const shownWin: LimitWindow | null = slice?.window ? windows[slice.window.index] : hi != null ? windows[hi] ?? null : null;
  const amber = windows.length > 0;
  const curPct = cur != null ? pct(cur) : null;
  const local = cur != null ? localStamp(cur, zone) : null;
  // The cursor's flag sits on the axis row: the labels it would cover step
  // aside ("Sat 2" under "Sat 28 · 0648Z" was unreadable).
  const flag: [number, number] | null = (() => {
    if (curPct == null || cur == null) return null;
    const w = zuluStamp(cur, false).length * 6.2 + (local ? local.length * 5.2 + 6 : 0) + 14;
    const x = (curPct / 100) * trackPx;
    return curPct < 10 ? [x, x + w] : curPct > 90 ? [x - w, x] : [x - w / 2, x + w / 2];
  })();
  const underFlag = (x0: number, x1: number) => flag != null && x1 > flag[0] - 4 && x0 < flag[1] + 4;
  const labelSpan = (ms: number, text: string, centered: boolean): [number, number] => {
    const x = (pct(ms) / 100) * trackPx, w = text.length * 5.4;
    return centered ? [x - w / 2, x + w / 2] : [x, x + w];
  };

  return (
    <section
      className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50"
      tabIndex={0}
      aria-label="72-hour ops timeline — use the left and right arrow keys to move through the hours"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1, e.shiftKey); }
        if (e.key === "Escape") { setCur(null); setPinned(false); }
      }}
    >
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Next 72 h — ops timeline</p>
        <span className="text-[9px] text-slate-500">all times Z · model planning-grade · the TAF governs its window</span>
        <button type="button" onClick={() => setKeyOpen((v) => !v)} aria-expanded={keyOpen} className="ml-auto text-[9px] text-slate-500 hover:text-slate-300">key {keyOpen ? "▴" : "▾"}</button>
      </div>
      <p className={`text-[11px] mb-2 ${amber ? "text-amber-200" : "text-slate-400"}`}>{windows.length ? `${windows.length} limiting window${windows.length === 1 ? "" : "s"} in 72 h — first ${rangeLabel(windows[0].fromMs, windows[0].toMs)}` : tl.summary}</p>
      {keyOpen && (
        <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-[9.5px] text-slate-400 space-y-0.5">
          <p><span className="inline-block w-3 h-2 rounded-sm bg-amber-500/40 border border-amber-500/70 align-middle mr-1" />limiting (a forecast is amber at most; crosswind keeps its own bands) · <span className="inline-block w-3 h-2 rounded-sm bg-sky-500/25 border border-sky-500/50 align-middle mr-1" />note · dashed = model read or TEMPO / PROB risk</p>
          <p>Sky = flight category: the TAF in its window, model VISIBILITY only beyond it (ceiling is not modelled). Shading under the lanes = civil / nautical twilight and night. Temp: white = air, dotted = dew point, blue shading = at or below 0 °C, ↓0° / ↑0° = crossings. Green line = now.</p>
          <p>Ground ice = frost, freezing fog, glaze, de-ice / anti-ice. Runway = ice, snow, standing water, refreeze. Ramp = lightning holds, gusts at door / stand limits, wind chill, heat. Thresholds are planning guidance, not your de-ice policy or a flight manual.</p>
          <p>Move along the timeline (or drag a finger) to read any hour; click or tap to pin; ← → step an hour, Shift + ← → jump to the next change, Esc clears.</p>
        </div>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <div className="sm:min-w-[660px]">
          {/* axis */}
          <div className="flex items-end gap-2 h-4">
            <span className="w-[86px] flex-shrink-0" />
            <div className="relative flex-1 h-4">
              {/* A narrow (phone) track keeps the day names and 12Z — 6-hour labels would collide. */}
              {ticks.filter((t) => (t.day || trackPx >= 480 || t.label === "12Z") && !underFlag(...labelSpan(t.ms, t.label, true))).map((t, i) => (
                <span key={i} className={`absolute bottom-0 -translate-x-1/2 text-[8px] font-mono whitespace-nowrap ${t.day ? "text-slate-300 font-bold" : "text-slate-600"}`} style={{ left: `${pct(t.ms)}%` }}>{t.label}</span>
              ))}
              {tl.tafEndMs != null && tl.tafEndMs > tl.startMs && tl.tafEndMs < endMs && !underFlag(...labelSpan(tl.tafEndMs, "TAF ends", false)) && (
                <span className="absolute bottom-0 text-[7.5px] text-sky-300/80 pl-0.5 whitespace-nowrap" style={{ left: `${pct(tl.tafEndMs)}%` }}>TAF ends</span>
              )}
            </div>
          </div>

          <div className="relative">
            {/* light, ticks, TAF end, now and the highlighted window under every lane */}
            <div className="absolute top-0 bottom-0 right-0 pointer-events-none" style={{ left: `${LABEL_COL}px` }}>
              {tl.light.map((l, i) => (l.state === "day" ? null : <span key={i} className={`absolute top-0 bottom-0 ${LIGHT_BG[l.state]}`} style={{ left: `${pct(l.fromMs)}%`, width: `${pct(l.toMs) - pct(l.fromMs)}%` }} />))}
              {ticks.map((t, i) => <span key={i} className={`absolute top-0 bottom-0 border-l ${t.day ? "border-slate-500/50" : "border-slate-700/40"}`} style={{ left: `${pct(t.ms)}%` }} />)}
              {tl.tafEndMs != null && tl.tafEndMs < endMs && <span className="absolute top-0 bottom-0 border-l border-dashed border-sky-400/60" style={{ left: `${pct(tl.tafEndMs)}%` }} />}
              {shownWin && <span className="absolute top-0 bottom-0 bg-amber-300/10 border-x border-amber-300/60" style={{ left: `${pct(shownWin.fromMs)}%`, width: `${pct(shownWin.toMs) - pct(shownWin.fromMs)}%` }} />}
              {nowIn && <span className="absolute top-0 bottom-0 border-l-2 border-emerald-400/80" style={{ left: `${pct(nowMs)}%` }} title="now" />}
            </div>
            <div className="relative space-y-[2px] py-0.5">
              {top.map((l) => <Lane key={l.key} lane={l} pct={pct} trackPx={trackPx} />)}
              <TempLane tl={tl} pct={pct} trackPx={trackPx} />
              {rest.map((l) => <Lane key={l.key} lane={l} pct={pct} trackPx={trackPx} />)}
            </div>
            {/* The scrub layer: one hairline across every lane with the Zulu time on the axis. */}
            <div
              ref={trackRef}
              className="absolute top-0 bottom-0 right-0 cursor-crosshair touch-pan-y select-none"
              style={{ left: `${LABEL_COL}px` }}
              onPointerMove={(e) => { if (pinned && e.pointerType === "mouse") return; const m = msAt(e.clientX); if (m != null) setCur(m); }}
              onPointerDown={(e) => { if (e.pointerType !== "mouse") { const m = msAt(e.clientX); if (m != null) setCur(m); } }}
              onPointerLeave={(e) => { if (!pinned && e.pointerType === "mouse") setCur(null); }}
              onClick={(e) => { const m = msAt(e.clientX); if (m != null) setCur(m); setPinned((p) => !p); }}
            >
              {curPct != null && (
                <span className={`absolute top-0 bottom-0 pointer-events-none ${pinned ? "border-l-2 border-sky-300" : "border-l border-slate-100"}`} style={{ left: `${curPct}%` }}>
                  <span
                    className={`absolute -top-[18px] whitespace-nowrap rounded px-1.5 py-[1px] text-[10px] font-mono font-bold shadow-lg ${pinned ? "bg-sky-300 text-slate-950" : "bg-slate-100 text-slate-950"}`}
                    style={{ transform: curPct < 10 ? "translateX(0)" : curPct > 90 ? "translateX(-100%)" : "translateX(-50%)" }}
                  >
                    {zuluStamp(cur!, false)}{local && <span className="ml-1 font-sans font-medium text-[9px] text-slate-600">{local}</span>}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* The hour readout — every lane at the cursor; the finger never covers it. */}
      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-2 min-h-[64px]">
        {!slice ? (
          <p className="text-[10.5px] text-slate-500">Move along the timeline — or drag a finger across it — to read any hour in Zulu. Click or tap to pin; ← → step an hour, Shift + ← → jump to the next change.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
              <span className="font-mono text-[15px] font-semibold text-slate-100">{slice.stamp}</span>
              <span className="text-[10px] text-slate-400">
                {local ? `${local} local · ` : ""}{slice.ms >= nowMs ? `in ${spanText(slice.ms - nowMs)}` : `${spanText(nowMs - slice.ms)} ago`} · {slice.src === "taf" ? "the TAF governs this hour" : "beyond the TAF — model, planning-grade"}{pinned ? " · pinned" : ""}
              </span>
              {slice.window ? (
                <span className={`text-[10px] rounded px-1.5 py-[1px] ${slice.window.tone === "r" ? "bg-red-500/15 text-red-200" : "bg-amber-500/15 text-amber-200"}`}>
                  Inside limiting window {slice.window.index + 1} · clears {zuluStamp(slice.window.toMs, false)} ({spanText(slice.window.leftMs)} left)
                </span>
              ) : (
                <span className="text-[10px] rounded px-1.5 py-[1px] bg-emerald-500/10 text-emerald-200/90">
                  Outside any window{slice.next ? ` · next opens ${zuluStamp(slice.next.fromMs, false)} (in ${spanText(slice.next.inMs)})` : " for the rest of the 72 h"}
                </span>
              )}
            </div>
            <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {slice.rows.map((r) => {
                // A long read (a NOTAM's text) is clamped to two lines; tap opens it.
                const long = r.items ? r.items.some((x) => x.text.length > 90) : r.text.length > 150;
                const open = openRows.has(r.key);
                return (
                  <div key={r.key} className="grid grid-cols-[78px_1fr] gap-2 items-baseline min-w-0">
                    <dt className="text-[9px] uppercase tracking-wider text-slate-500">{r.title}</dt>
                    <dd className={`text-[10.5px] min-w-0 break-words ${RO_TONE[r.tone]}`}>
                      {r.items ? (
                        <span className="block space-y-0.5">
                          <span className="block text-[9px] font-normal text-slate-500">{r.items.length} in effect</span>
                          {r.items.map((it, k) => (
                            <span key={k} className={`${RO_TONE[it.tone]} ${long && !open ? "line-clamp-1" : "block"}`} title={long && !open ? it.text : undefined}>{it.text}</span>
                          ))}
                        </span>
                      ) : (
                        <span className={long && !open ? "line-clamp-2" : ""} title={long && !open ? r.text : undefined}>{r.text}</span>
                      )}
                      {long && (
                        <button type="button" className="text-[9px] font-normal text-slate-500 hover:text-slate-300"
                          onClick={() => setOpenRows((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}>
                          {open ? "less ▴" : "full text ▾"}
                        </button>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        )}
      </div>

      {/* Limiting windows */}
      <div className="mt-2 pt-2 border-t border-slate-800/60">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Limiting windows</p>
        {windows.length === 0 && <p className="text-[10.5px] text-slate-500">None in 72 h — {tl.summary.replace(/^Next 72 h: no limiting window — /, "")}</p>}
        <ul className="space-y-1">
          {windows.map((w, i) => (
            <li key={i}>
              <button type="button" onClick={() => { const open = hi !== i; setHi(open ? i : null); if (open) { setCur(w.fromMs); setPinned(true); } }} aria-pressed={hi === i}
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
