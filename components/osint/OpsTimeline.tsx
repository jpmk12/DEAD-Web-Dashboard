"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { planView, packRows, rangeLabel, sliceAt, changePoints, zuluStamp, spanText, windowVerdict, PROC_TITLE, BEST_MIN_H, type OpsTimeline as Timeline, type TlLane, type Tone, type ClosureLike, type LimitWindow, type SliceTone, type Proc, type ProcStrip, type StripTone, type BestWindow, type StandingLimit } from "@/lib/opsTimeline";
import { resolveWall } from "@/lib/plannerTools";
import type { Limfac } from "@/lib/limfac";

// The 72-hour generation & launch timeline (lib/opsTimeline planView). Built
// for one question: WHEN to generate and launch, and what stops it. On top:
// limits STANDING most of the period (said once — a three-day outage used to
// merge every other limit into one window) and the field's open LIMFACs; then
// two hourly strips — GENERATION (de-ice, refuelling, loading, maintenance:
// ground ice, ramp / crew, fuel and parking NOTAMs) and LAUNCH & RECOVERY
// (sky, runway, crosswind, icing aloft, runway / airfield / navaid NOTAMs and
// operating hours) — over the evidence lanes; then the BEST windows per
// process and the time-bound limiting windows. Zulu axis with the field's
// local row beneath; the planner's own flying window per local day (it
// changes day to day) is saved in this browser and read against both strips.
// Move the mouse (or drag a finger) along it to read any hour; click pins;
// ← → step, Shift + ← → jump to the next change. Model reads and TEMPO / PROB
// risk are dashed; past the TAF everything is drawn fainter.

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

function Lane({ lane, pct, trackPx, tafEndMs }: { lane: TlLane; pct: (ms: number) => number; trackPx: number; tafEndMs: number | null }) {
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
              className={`absolute rounded-[3px] border px-0.5 text-[8px] font-bold leading-none flex items-center justify-center overflow-hidden whitespace-nowrap ${cls} ${s.dashed ? "border-dashed" : ""} ${beyondTaf(s.fromMs, tafEndMs, lane.key) ? "opacity-60" : ""}`}
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

/** Beyond the TAF the read is the model's — drawn a step fainter (NOTAMs are
 *  published, not forecast, and keep full strength). */
function beyondTaf(fromMs: number, tafEndMs: number | null, key?: string): boolean {
  return key !== "notam" && tafEndMs != null && fromMs >= tafEndMs;
}

const STRIP_BAR: Record<StripTone, string> = {
  g: "bg-emerald-500/30 border-emerald-500/50",
  a: "bg-amber-500/45 border-amber-400/80",
  r: "bg-red-500/50 border-red-400/80",
  u: "bg-transparent border-dashed border-slate-500/70",
};

/** One process as an hourly strip: clear (green) · limited (amber / red, the
 *  limits on hover and in the readout) · UNKNOWN (dashed — never clear). */
function StripRow({ strip, standing, pct, trackPx, tafEndMs }: { strip: ProcStrip; standing: StandingLimit[]; pct: (ms: number) => number; trackPx: number; tafEndMs: number | null }) {
  const st = standing.filter((x) => x.proc === strip.proc);
  return (
    <div className="flex items-center gap-2 h-[17px]">
      <span className="w-[86px] flex-shrink-0 text-right text-[9px] font-bold text-slate-200 truncate leading-none" title={st.length ? `Standing beside this strip: ${st.map((x) => x.label).join(", ")}` : PROC_TITLE[strip.proc]}>
        {strip.proc === "gen" ? "Generation" : "Launch & rec."}
        {st.length > 0 && <span className="block text-[7.5px] font-semibold text-amber-300/90">+ {st.length} standing</span>}
      </span>
      <div className="relative flex-1 h-[13px] rounded bg-slate-800/30">
        {strip.runs.map((r, i) => {
          const left = pct(r.fromMs), width = Math.max(0.6, pct(r.toMs) - left);
          const txt = r.tone === "g" ? (width / 100 * trackPx > 34 ? "clear" : "") : r.tone === "u" ? "UNKNOWN" : r.why.slice(0, 2).join(" · ");
          return (
            <span key={i} title={`${rangeLabel(r.fromMs, r.toMs)} — ${r.tone === "g" ? "clear" : r.tone === "u" ? r.why.join(", ") : r.why.join(", ")}`}
              className={`absolute top-0 bottom-0 rounded-[2px] border text-[7.5px] font-bold leading-none flex items-center justify-center overflow-hidden whitespace-nowrap ${r.tone === "g" ? "text-emerald-200/80" : r.tone === "u" ? "text-slate-400" : "text-slate-950"} ${STRIP_BAR[r.tone]} ${beyondTaf(r.fromMs, tafEndMs) ? "opacity-65" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}>
              {fitLabel(txt, undefined, (width / 100) * trackPx)}
            </span>
          );
        })}
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

const PARTS_FMT = new Map<string, Intl.DateTimeFormat>();
/** The field's wall clock at an instant: date, weekday, hour, minute. */
function localParts(ms: number, zone: string): { ymd: string; dow: string; day: string; mon: string; hh: string; mm: string } | null {
  try {
    let f = PARTS_FMT.get(zone);
    if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "short", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); PARTS_FMT.set(zone, f); }
    const p = f.formatToParts(ms).reduce<Record<string, string>>((a, x) => { if (x.type !== "literal") a[x.type] = x.value; return a; }, {});
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mi = MON.indexOf(p.month);
    return { ymd: `${p.year}-${String(mi + 1).padStart(2, "0")}-${p.day}`, dow: p.weekday, day: p.day, mon: p.month, hh: p.hour === "24" ? "00" : p.hour, mm: p.minute };
  } catch { return null; }
}

/** "0700–1500L" (a weekday when it crosses the local midnight). */
function localRange(fromMs: number, toMs: number, zone: string | null | undefined): string | null {
  if (!zone) return null;
  const a = localParts(fromMs, zone), b = localParts(toMs, zone);
  if (!a || !b) return null;
  return a.ymd === b.ymd || (b.hh === "00" && b.mm === "00") ? `${a.dow} ${a.hh}${a.mm}–${b.hh}${b.mm}L` : `${a.dow} ${a.hh}${a.mm}–${b.dow} ${b.hh}${b.mm}L`;
}

/** The planner's flying window, per LOCAL date ("the flying window changes"):
 *  saved in this browser per field, never sent anywhere. */
type FlyWin = Record<string, { from: string; to: string }>;
const fwKey = (icao: string) => `opsTl.flyWin.${icao}`;
function loadFw(icao: string | undefined): FlyWin {
  if (!icao) return {};
  try { const v = JSON.parse(localStorage.getItem(fwKey(icao)) ?? "{}"); return v && typeof v === "object" ? v as FlyWin : {}; } catch { return {}; }
}
function saveFw(icao: string | undefined, fw: FlyWin) {
  if (!icao) return;
  try { localStorage.setItem(fwKey(icao), JSON.stringify(fw)); } catch { /* private window — the window lives for this view only */ }
}
const HHMM_RE = /^([01]\d|2[0-3]):?([0-5]\d)$/;

/** "0615 CET" in the field's own zone — null when the zone is unknown. */
function localStamp(ms: number, zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).formatToParts(ms);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("hour")}${get("minute")} ${get("timeZoneName")}`.trim();
  } catch { return null; }
}

const PROC_TAG: Record<Proc, string> = { gen: "GEN", launch: "L&R" };
const VERDICT_TONE: Record<StripTone, string> = { g: "text-emerald-300", a: "text-amber-200", r: "text-red-300", u: "text-slate-400 italic" };

export default function OpsTimeline({ tl, closures, zone, icao, limfacs }: {
  tl: Timeline; closures: ClosureLike[]; zone?: string | null;
  /** Keys the flying windows saved in this browser. */
  icao?: string;
  /** The field's commander-entered LIMFACs (open ones are standing context). */
  limfacs?: Limfac[];
}) {
  const [cur, setCur] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const [hi, setHi] = useState<number | null>(null);
  const [bestHi, setBestHi] = useState<BestWindow | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [fwOpen, setFwOpen] = useState(false);
  const [fw, setFw] = useState<FlyWin>({});
  const [trackPx, setTrackPx] = useState(600);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const trackRef = useRef<HTMLDivElement | null>(null);
  const view = useMemo(() => planView(tl, closures), [tl, closures]);
  const { lane: notam, windows, standing, strips, best } = view;
  const changes = useMemo(() => changePoints(tl, [notam]), [tl, notam]);
  const span = tl.hours * H;
  const endMs = tl.startMs + span;
  const pct = useCallback((ms: number) => Math.max(0, Math.min(100, ((ms - tl.startMs) / span) * 100)), [tl.startMs, span]);
  const fwZone = zone || "UTC";
  const fwSuffix = zone ? "L" : "Z";

  useEffect(() => { setFw(loadFw(icao)); }, [icao]);

  // Bar labels are fitted to real pixels, so a phone can show all 72 h at once.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => { for (const e of es) setTrackPx(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [tl.live]);

  const slice = useMemo(() => (cur != null ? sliceAt(tl, [notam], windows, cur) : null), [cur, tl, notam, windows]);

  // The local dates the horizon touches, each with its flying window resolved to instants.
  const days = useMemo(() => {
    const out: { ymd: string; label: string; win: { fromMs: number; toMs: number } | null; raw: { from: string; to: string } | null }[] = [];
    const seen = new Set<string>();
    for (let ms = tl.startMs; ms < endMs; ms += H) {
      const p = localParts(ms, fwZone);
      if (!p || seen.has(p.ymd)) continue;
      seen.add(p.ymd);
      const raw = fw[p.ymd] ?? null;
      let win: { fromMs: number; toMs: number } | null = null;
      if (raw && HHMM_RE.test(raw.from) && HHMM_RE.test(raw.to)) {
        const a = resolveWall(p.ymd, raw.from, fwZone), b = resolveWall(p.ymd, raw.to, fwZone);
        if (a && b) win = { fromMs: a.ms, toMs: b.ms <= a.ms ? b.ms + 24 * H : b.ms };
      }
      out.push({ ymd: p.ymd, label: `${p.dow} ${p.day} ${p.mon}`, win, raw });
    }
    return out;
  }, [tl.startMs, endMs, fw, fwZone]);
  const flyWins = days.filter((d) => d.win && d.win.toMs > tl.startMs && d.win.fromMs < endMs);

  if (!tl.live) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Next 72 h — generation & launch</p>
        <p className="text-[10.5px] text-slate-500 mt-1">{tl.summary}</p>
      </section>
    );
  }

  const setDay = (ymd: string, from: string, to: string) => {
    const next = { ...fw };
    if (!from && !to) delete next[ymd]; else next[ymd] = { from, to };
    // Forget dates already behind the horizon.
    for (const k of Object.keys(next)) if (!days.some((d) => d.ymd === k) && k < days[0]?.ymd) delete next[k];
    setFw(next); saveFw(icao, next);
  };

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
  // Local axis: the field's midnights and 6-hour marks, read every half hour so a
  // half-hour zone (Tehran, India) still gets its ticks.
  const lticks: { ms: number; label: string; day: boolean }[] = [];
  if (zone) {
    for (let ms = Math.ceil(tl.startMs / (H / 2)) * (H / 2); ms < endMs; ms += H / 2) {
      const p = localParts(ms, zone);
      if (!p || p.mm !== "00" || Number(p.hh) % 6 !== 0) continue;
      const day = p.hh === "00";
      lticks.push({ ms, day, label: day ? `${p.dow} ${p.day}L` : `${p.hh}L` });
    }
  }
  const top = tl.lanes.filter((l) => l.key === "sky" || l.key === "precip");
  const rest = [...tl.lanes.filter((l) => l.key !== "sky" && l.key !== "precip"), notam];
  const shownWin: LimitWindow | null = slice?.window ? windows[slice.window.index] : hi != null ? windows[hi] ?? null : null;
  const curPct = cur != null ? pct(cur) : null;
  const local = cur != null ? localStamp(cur, zone) : null;
  const curHour = cur != null ? Math.floor((cur - tl.startMs) / H) : null;
  const procAt = (p: Proc) => (curHour != null ? strips[p].hours[curHour] ?? null : null);
  const inFly = cur != null ? flyWins.find((d) => cur >= d.win!.fromMs && cur < d.win!.toMs) ?? null : null;
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
  // "TAF ends" yields to a day label and to the cursor flag; 6-hour labels yield to it.
  const tafSpan: [number, number] | null = tl.tafEndMs != null && tl.tafEndMs > tl.startMs && tl.tafEndMs < endMs ? labelSpan(tl.tafEndMs, "TAF ends", false) : null;
  const overlaps = (a: [number, number], b: [number, number]) => a[1] > b[0] - 4 && a[0] < b[1] + 4;
  const showTafLabel = tafSpan != null && !underFlag(...tafSpan)
    && !ticks.some((t) => t.day && (t.day || trackPx >= 480) && overlaps(labelSpan(t.ms, t.label, true), tafSpan));
  const nearTafLabel = (x0: number, x1: number) => showTafLabel && tafSpan != null && overlaps([x0, x1], tafSpan);
  const openLimfacs = (limfacs ?? []).filter((l) => l.source === "manual" && l.status !== "resolved" && (l.capability === "pmc" || l.capability === "nmc"));
  const headline = (p: Proc) => {
    const b = best[p][0];
    return b ? `${rangeLabel(b.fromMs, b.toMs)} (${b.hours} h)` : `none ≥ ${BEST_MIN_H} h clear`;
  };
  const stateWord = (h: ReturnType<typeof procAt>) => !h ? "—" : h.tone === "g" ? "clear" : h.tone === "u" ? `UNKNOWN — ${h.why.join(", ")}` : `limited — ${h.why.join(", ")}`;
  const overlapsFly = (a: number, b: number) => flyWins.some((d) => d.win!.fromMs < b && d.win!.toMs > a);

  return (
    <section
      className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5 outline-none focus-visible:ring-1 focus-visible:ring-sky-500/50"
      tabIndex={0}
      aria-label="72-hour generation and launch timeline — use the left and right arrow keys to move through the hours"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1, e.shiftKey); }
        if (e.key === "Escape") { setCur(null); setPinned(false); setBestHi(null); }
      }}
    >
      <div className="flex items-baseline gap-2 flex-wrap mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Next 72 h — generation &amp; launch</p>
        <span className="text-[9px] text-slate-500">times Z{zone ? " (local row beneath)" : ""} · model planning-grade · the TAF governs its window</span>
        <span className="ml-auto flex items-center gap-3">
          <button type="button" onClick={() => setFwOpen((v) => !v)} aria-expanded={fwOpen} className="text-[9px] text-violet-300 hover:text-violet-200">flying window {fwOpen ? "▴" : "▾"}</button>
          <button type="button" onClick={() => setKeyOpen((v) => !v)} aria-expanded={keyOpen} className="text-[9px] text-slate-500 hover:text-slate-300">key {keyOpen ? "▴" : "▾"}</button>
        </span>
      </div>
      <p className="text-[11px] mb-2 text-slate-300">
        <span className="text-emerald-300/90">Best generation</span> {headline("gen")} · <span className="text-emerald-300/90">best launch &amp; recovery</span> {headline("launch")}
        <span className="text-slate-500"> · {windows.length ? `${windows.length} limiting window${windows.length === 1 ? "" : "s"}` : "no time-bound limit"}{standing.length ? ` · ${standing.length} standing` : ""}</span>
      </p>
      {keyOpen && (
        <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-1.5 text-[9.5px] text-slate-400 space-y-0.5">
          <p><b className="text-slate-300">Generation</b> = de-ice, refuelling, loading, maintenance on the ramp (lanes: ground ice, ramp / crew, fuel and parking NOTAMs). <b className="text-slate-300">Launch &amp; recovery</b> = sky, runway, crosswind, icing aloft, runway / airfield / navaid NOTAMs and operating hours. Each strip: green clear · amber / red limited · dashed UNKNOWN (never clear).</p>
          <p><b className="text-slate-300">Standing</b> = a limit in effect most of the 72 h — listed once above, beside every window, never merged into one. Best windows are the longest clear stretches of {BEST_MIN_H} h or more.</p>
          <p><span className="inline-block w-3 h-2 rounded-sm bg-amber-500/40 border border-amber-500/70 align-middle mr-1" />limiting (a forecast is amber at most; crosswind keeps its own bands) · <span className="inline-block w-3 h-2 rounded-sm bg-sky-500/25 border border-sky-500/50 align-middle mr-1" />note · dashed = model read or TEMPO / PROB risk · fainter = beyond the TAF (model only) · <span className="inline-block w-3 h-2 rounded-sm border border-violet-400/70 bg-violet-500/10 align-middle mr-1" />your flying window</p>
          <p>Sky = flight category: the TAF in its window, model VISIBILITY only beyond it (ceiling is not modelled). Shading under the lanes = civil / nautical twilight and night. Temp: white = air, dotted = dew point, blue shading = at or below 0 °C. Green line = now.</p>
          <p>Thresholds are planning guidance, not your de-ice policy, refuelling or lightning radius policy, or a flight manual. Move along the timeline to read any hour; click to pin; ← → step an hour, Shift + ← → jump to the next change, Esc clears.</p>
        </div>
      )}

      {(standing.length > 0 || openLimfacs.length > 0) && (
        <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
          <p className="text-[9px] font-bold uppercase tracking-widest text-amber-300/90 mb-0.5">Standing — beside every window below</p>
          <ul className="space-y-0.5">
            {standing.map((x, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[10.5px] min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 translate-y-[-1px] ${x.tone === "r" ? "bg-red-500" : "bg-amber-400"}`} />
                {x.proc && <span className="text-[8px] font-bold text-slate-400 border border-slate-700 rounded px-1 flex-shrink-0">{PROC_TAG[x.proc]}</span>}
                <span className="text-amber-100 font-semibold flex-shrink-0">{x.label}</span>
                <span className="text-slate-400 truncate min-w-0" title={x.detail}>{x.hours >= tl.hours ? "all 72 h" : `${x.hours} of ${tl.hours} h`} · {x.detail}</span>
              </li>
            ))}
            {openLimfacs.map((l) => (
              <li key={l.id} className="flex items-baseline gap-2 text-[10.5px] min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 translate-y-[-1px] ${l.capability === "nmc" ? "bg-red-500" : "bg-amber-400"}`} />
                <span className="text-[8px] font-bold text-violet-300 border border-violet-500/40 rounded px-1 flex-shrink-0">LIMFAC</span>
                <span className="text-amber-100 font-semibold flex-shrink-0">{l.fnLabel} {l.capability.toUpperCase()}</span>
                <span className="text-slate-400 truncate min-w-0" title={`${l.driver} — ${l.impact}`}>{l.driver}{l.window ? ` · ${l.window}` : ""} (entered)</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fwOpen && (
        <div className="mb-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-2.5 py-2">
          <p className="text-[9.5px] text-slate-400 mb-1.5">Your flying window for each day, in {zone ? `the field's local time (${zone})` : "Zulu — the field's zone is unknown"}. Saved on this browser for {icao ?? "this field"}; it is read against both strips below. An end earlier than the start runs past midnight.</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {days.map((d) => (
              <label key={d.ymd} className="flex items-center gap-1.5 text-[10.5px] text-slate-300">
                <span className="w-[76px] font-mono">{d.label}</span>
                <input type="time" value={d.raw?.from ?? ""} onChange={(e) => setDay(d.ymd, e.target.value, d.raw?.to ?? "")} aria-label={`${d.label} window start`} className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10.5px] font-mono text-slate-200 w-[84px]" />
                <span className="text-slate-500">–</span>
                <input type="time" value={d.raw?.to ?? ""} onChange={(e) => setDay(d.ymd, d.raw?.from ?? "", e.target.value)} aria-label={`${d.label} window end`} className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-[10.5px] font-mono text-slate-200 w-[84px]" />
                <span className="text-[9px] text-slate-500">{fwSuffix}</span>
                {d.raw && <button type="button" onClick={() => setDay(d.ymd, "", "")} className="text-[9px] text-slate-500 hover:text-slate-300">clear</button>}
              </label>
            ))}
          </div>
        </div>
      )}

      {flyWins.length > 0 && (
        <ul className="mb-2 space-y-1">
          {flyWins.map((d) => (
            <li key={d.ymd} className="rounded-lg border border-violet-500/25 bg-slate-950/30 px-2.5 py-1 text-[10.5px]">
              <span className="font-mono text-violet-200">{d.label} · {d.raw!.from.replace(":", "")}–{d.raw!.to.replace(":", "")}{fwSuffix}</span>
              {(["gen", "launch"] as const).map((p) => {
                const runs = windowVerdict(strips[p], d.win!.fromMs, d.win!.toMs);
                const clear = runs.length > 0 && runs.every((r) => r.tone === "g");
                return (
                  <span key={p} className="block sm:inline sm:ml-3">
                    <span className="text-slate-500">{PROC_TITLE[p]}: </span>
                    {clear ? <span className={VERDICT_TONE.g}>clear the whole window</span>
                      : runs.length === 0 ? <span className="text-slate-500">outside the 72 h</span>
                      : runs.map((r, k) => (
                        <span key={k} className={VERDICT_TONE[r.tone]}>
                          {k > 0 ? " · " : ""}{(localRange(r.fromMs, r.toMs, zone) ?? rangeLabel(r.fromMs, r.toMs)).replace(/^\w{3} /, "")} {r.tone === "g" ? "clear" : r.tone === "u" ? "UNKNOWN" : r.why.slice(0, 2).join(", ")}
                        </span>
                      ))}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <div className="sm:min-w-[660px]">
          {/* axis */}
          <div className="flex items-end gap-2 h-4">
            <span className="w-[86px] flex-shrink-0 text-right text-[7.5px] text-slate-600 font-mono">Z</span>
            <div className="relative flex-1 h-4">
              {/* A narrow (phone) track keeps the day names and 12Z — 6-hour labels would collide. */}
              {ticks.filter((t) => (t.day || trackPx >= 480 || t.label === "12Z") && !underFlag(...labelSpan(t.ms, t.label, true)) && (t.day || !nearTafLabel(...labelSpan(t.ms, t.label, true)))).map((t, i) => (
                <span key={i} className={`absolute bottom-0 -translate-x-1/2 text-[8px] font-mono whitespace-nowrap ${t.day ? "text-slate-300 font-bold" : "text-slate-600"}`} style={{ left: `${pct(t.ms)}%` }}>{t.label}</span>
              ))}
              {showTafLabel && (
                <span className="absolute bottom-0 text-[7.5px] text-sky-300/80 pl-0.5 whitespace-nowrap" style={{ left: `${pct(tl.tafEndMs!)}%` }}>TAF ends</span>
              )}
            </div>
          </div>
          {lticks.length > 0 && (
            <div className="flex items-end gap-2 h-3">
              <span className="w-[86px] flex-shrink-0 text-right text-[7.5px] text-violet-300/60 font-mono truncate" title={zone ?? ""}>local</span>
              <div className="relative flex-1 h-3">
                {lticks.filter((t) => t.day || trackPx >= 480 || t.label === "12L").map((t, i) => (
                  <span key={i} className={`absolute bottom-0 -translate-x-1/2 text-[7.5px] font-mono whitespace-nowrap ${t.day ? "text-violet-200/80 font-bold" : "text-violet-300/45"}`} style={{ left: `${pct(t.ms)}%` }}>{t.label}</span>
                ))}
              </div>
            </div>
          )}

          <div className="relative">
            {/* light, ticks, TAF end, flying windows, now and the highlighted window under every lane */}
            <div className="absolute top-0 bottom-0 right-0 pointer-events-none" style={{ left: `${LABEL_COL}px` }}>
              {tl.light.map((l, i) => (l.state === "day" ? null : <span key={i} className={`absolute top-0 bottom-0 ${LIGHT_BG[l.state]}`} style={{ left: `${pct(l.fromMs)}%`, width: `${pct(l.toMs) - pct(l.fromMs)}%` }} />))}
              {ticks.map((t, i) => <span key={i} className={`absolute top-0 bottom-0 border-l ${t.day ? "border-slate-500/50" : "border-slate-700/40"}`} style={{ left: `${pct(t.ms)}%` }} />)}
              {tl.tafEndMs != null && tl.tafEndMs < endMs && <span className="absolute top-0 bottom-0 border-l border-dashed border-sky-400/60" style={{ left: `${pct(tl.tafEndMs)}%` }} />}
              {flyWins.map((d) => <span key={d.ymd} className="absolute top-0 bottom-0 bg-violet-500/[0.07] border-x border-violet-400/60" style={{ left: `${pct(d.win!.fromMs)}%`, width: `${pct(d.win!.toMs) - pct(d.win!.fromMs)}%` }} />)}
              {bestHi && <span className="absolute top-0 bottom-0 bg-emerald-300/10 border-x border-emerald-300/60" style={{ left: `${pct(bestHi.fromMs)}%`, width: `${pct(bestHi.toMs) - pct(bestHi.fromMs)}%` }} />}
              {shownWin && !bestHi && <span className="absolute top-0 bottom-0 bg-amber-300/10 border-x border-amber-300/60" style={{ left: `${pct(shownWin.fromMs)}%`, width: `${pct(shownWin.toMs) - pct(shownWin.fromMs)}%` }} />}
              {nowIn && <span className="absolute top-0 bottom-0 border-l-2 border-emerald-400/80" style={{ left: `${pct(nowMs)}%` }} title="now" />}
            </div>
            <div className="relative space-y-[2px] py-0.5">
              <StripRow strip={strips.gen} standing={standing} pct={pct} trackPx={trackPx} tafEndMs={tl.tafEndMs} />
              <StripRow strip={strips.launch} standing={standing} pct={pct} trackPx={trackPx} tafEndMs={tl.tafEndMs} />
              <div className="h-[3px] ml-[94px] border-b border-slate-700/60" />
              {top.map((l) => <Lane key={l.key} lane={l} pct={pct} trackPx={trackPx} tafEndMs={tl.tafEndMs} />)}
              <TempLane tl={tl} pct={pct} trackPx={trackPx} />
              {rest.map((l) => <Lane key={l.key} lane={l} pct={pct} trackPx={trackPx} tafEndMs={tl.tafEndMs} />)}
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
                    className={`absolute ${lticks.length ? "-top-[30px]" : "-top-[18px]"} whitespace-nowrap rounded px-1.5 py-[1px] text-[10px] font-mono font-bold shadow-lg ${pinned ? "bg-sky-300 text-slate-950" : "bg-slate-100 text-slate-950"}`}
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
              {inFly && <span className="text-[10px] rounded px-1.5 py-[1px] bg-violet-500/15 text-violet-200">inside your flying window</span>}
            </div>
            <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {(["gen", "launch"] as const).map((p) => {
                const h = procAt(p);
                return (
                  <div key={p} className="grid grid-cols-[78px_1fr] gap-2 items-baseline min-w-0">
                    <dt className="text-[9px] uppercase tracking-wider text-slate-300 font-bold">{p === "gen" ? "Generation" : "Launch & rec."}</dt>
                    <dd className={`text-[10.5px] min-w-0 break-words font-semibold ${h ? VERDICT_TONE[h.tone] : "text-slate-500"}`}>{stateWord(h)}{standing.some((x) => x.proc === p) ? <span className="font-normal text-amber-300/80"> · + standing</span> : null}</dd>
                  </div>
                );
              })}
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

      {/* Best windows — the longest clear stretches per process. */}
      <div className="mt-2 pt-2 border-t border-slate-800/60 grid gap-3 sm:grid-cols-2">
        {(["gen", "launch"] as const).map((p) => (
          <div key={p} className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/80 mb-1">Best for {p === "gen" ? "generation" : "launch & recovery"}</p>
            {best[p].length === 0 ? (
              <p className="text-[10.5px] text-slate-500">No clear stretch of {BEST_MIN_H} h or more in 72 h{strips[p].hours.some((h) => h.tone === "u") ? " — some hours are UNKNOWN, not clear" : ""}.</p>
            ) : (
              <ul className="space-y-1">
                {best[p].map((b, i) => {
                  const on = bestHi != null && bestHi.proc === b.proc && bestHi.fromMs === b.fromMs;
                  const lr = localRange(b.fromMs, b.toMs, zone);
                  return (
                    <li key={i}>
                      <button type="button" aria-pressed={on}
                        onClick={() => { setBestHi(on ? null : b); setHi(null); if (!on) { setCur(b.fromMs); setPinned(true); } }}
                        className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors ${on ? "border-emerald-400/60 bg-emerald-500/10" : "border-slate-800 hover:border-slate-600 bg-slate-950/30"}`}>
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-emerald-400" />
                          <span className="font-mono text-[10.5px] text-slate-200">{rangeLabel(b.fromMs, b.toMs)}</span>
                          <span className="text-[9px] text-slate-400">{b.hours} h{lr ? ` · ${lr}` : ""}</span>
                          {overlapsFly(b.fromMs, b.toMs) && <span className="text-[8px] font-bold uppercase tracking-wider text-violet-200 border border-violet-500/40 rounded px-1">your window</span>}
                        </span>
                        <span className="block mt-0.5 ml-4 text-[9.5px] text-slate-400">
                          {b.tafH === b.hours ? "TAF" : b.tafH === 0 ? "model only (planning-grade)" : `TAF ${b.tafH} h, then model`} · {b.dayH} h daylight · {b.endsBy ? <>ends with <span className={b.endsBy.tone === "u" ? "text-slate-400" : "text-amber-200"}>{b.endsBy.tone === "u" ? "UNKNOWN" : b.endsBy.why.slice(0, 3).join(", ")}</span></> : "runs to the end of the 72 h"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {standing.some((x) => x.proc === p) && <p className="mt-1 text-[9px] text-amber-300/80">Beside the standing limit{standing.filter((x) => x.proc === p).length > 1 ? "s" : ""} above: {standing.filter((x) => x.proc === p).map((x) => x.label).join(", ")}.</p>}
          </div>
        ))}
      </div>

      {/* Limiting windows (time-bound) */}
      <div className="mt-2 pt-2 border-t border-slate-800/60">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Limiting windows</p>
        {windows.length === 0 && <p className="text-[10.5px] text-slate-500">No time-bound limiting window in 72 h{standing.length ? " (the standing limits above still apply)" : ""}.</p>}
        <ul className="space-y-1">
          {windows.map((w, i) => (
            <li key={i}>
              <button type="button" onClick={() => { const open = hi !== i; setHi(open ? i : null); setBestHi(null); if (open) { setCur(w.fromMs); setPinned(true); } }} aria-pressed={hi === i}
                className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors ${hi === i ? "border-amber-400/60 bg-amber-500/10" : "border-slate-800 hover:border-slate-600 bg-slate-950/30"}`}>
                <span className="flex items-center gap-2 flex-wrap">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${w.tone === "r" ? "bg-red-500" : "bg-amber-400"}`} />
                  <span className="font-mono text-[10.5px] text-slate-200">{rangeLabel(w.fromMs, w.toMs)}</span>
                  <span className="text-[9px] text-slate-500">{Math.round((w.toMs - w.fromMs) / H)} h{zone ? ` · ${localRange(w.fromMs, w.toMs, zone) ?? ""}` : ""}</span>
                  {w.factors.map((f, k) => (
                    <span key={k} className="text-[8.5px] font-bold uppercase tracking-wider rounded border border-slate-700 bg-slate-800/60 text-slate-300 px-1 py-[1px]" title={f.proc ? PROC_TITLE[f.proc] : "context"}>
                      {f.proc && <span className="text-slate-500 mr-1">{PROC_TAG[f.proc]}</span>}{f.label}
                    </span>
                  ))}
                </span>
                {hi === i && (
                  <ul className="mt-1 ml-4 list-disc text-[10px] text-slate-300 space-y-0.5">
                    {w.factors.map((f, k) => <li key={k}>{f.proc ? `[${PROC_TITLE[f.proc]}] ` : ""}{f.detail}</li>)}
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
