"use client";

import { useEffect, useMemo, useState } from "react";
import {
  lunarNights, lunarWindows, hhmmIn, sanitizeThresholds, illumBand, DEFAULT_LUNAR_THRESHOLDS, MOON_USEFUL_ALT_DEG,
  type LunarNight, type LunarThresholds, type LunarWindow, type IllumBand,
} from "@/lib/moon";
import { renderLunarHtml } from "@/lib/lunarExport";
import { downloadFile } from "@/lib/exports";
import { ymdInZone } from "@/lib/effectiveZone";
import { clientCache } from "@/lib/clientCache";
import { nightCloud, nightCloudClause, type HourlyCloud, type NightCloud } from "@/lib/lunarCloud";

// Lunar windows — the Weather tab's "☾" card (mockup docs/mockups/
// moon-options.html, option C on top with A folding open beneath). All of
// it is PURE client-side maths over lib/moon.ts for the place the tab has
// selected (TDY › home › a tapped airfield, the map's own rule); the only
// network call is one Open-Meteo read for the place's IANA ZONE, so the
// clock times are that place's, not this device's. Thresholds are per
// browser (localStorage) — a planning default, not a declaration.
//
// The point the card makes: percent illumination alone misleads. Each
// night is a BUDGET — darkness (EENT→BMNT), the part the moon is up for,
// the part it is usefully up for (≥30°), and the moon-free rest — and the
// windows are chosen on that budget, not the percent.

const THRESH_KEY = "weather.lunar.thresholds";
const OPEN_KEY = "weather.lunar.detailOpen";
const NIGHTS = 60;
/** Nights the cloud overlay covers — the model's horizon, never the moon's. */
const CLOUD_NIGHTS = 7;
const COVER_CLS: Record<NightCloud["cover"], string> = {
  CLR: "text-sky-200 border-sky-400/40 bg-sky-500/10",
  FEW: "text-sky-200 border-sky-400/30 bg-sky-500/[0.06]",
  SCT: "text-slate-200 border-slate-500/40 bg-slate-500/10",
  BKN: "text-slate-300 border-slate-500/50 bg-slate-600/30",
  OVC: "text-slate-400 border-slate-500/60 bg-slate-700/60",
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymdParts = (ymd: string) => ymd.split("-").map(Number) as [number, number, number];
const dayLabel = (ymd: string) => { const [y, m, d] = ymdParts(ymd); return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, "0")} ${MON[m - 1]}`; };
const dayShort = (ymd: string) => { const [, m, d] = ymdParts(ymd); return `${String(d).padStart(2, "0")} ${MON[m - 1]}`; };
const h = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} h`);
/** Moonlight colour: slate at new, pale amber at full. */
const moonCol = (pct: number) => { const t = pct / 100; return `rgb(${Math.round(30 + 223 * t)},${Math.round(41 + 189 * t)},${Math.round(59 + 79 * t)})`; };
const BAND_CLS: Record<IllumBand, string> = {
  hi: "text-amber-200 bg-amber-200/10 border-amber-200/40",
  mid: "text-slate-300 bg-slate-400/10 border-slate-500/40",
  lo: "text-indigo-200 bg-indigo-500/15 border-indigo-400/40",
};
const BAND_LABEL: Record<IllumBand, string> = { hi: "HIGH ILLUM", mid: "MODERATE", lo: "LOW ILLUM" };
const Pill = ({ band, children }: { band: IllumBand; children?: React.ReactNode }) => (
  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-px rounded border ${BAND_CLS[band]}`}>{children ?? BAND_LABEL[band]}</span>
);

/** Local hours since the night's local midnight-1 (so 17:00 → 17, 06:00 next day → 30). */
function localHours(ms: number, zone: string, nightDate: string): number {
  const [y, m, d] = ymdParts(nightDate);
  const base = Date.UTC(y, m - 1, d);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(ms)).reduce<Record<string, number>>((a, p) => { if (p.type !== "literal") a[p.type] = Number(p.value); return a; }, {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return (asUtc - base) / 3_600_000;
}

function loadThresholds(): LunarThresholds {
  try { return sanitizeThresholds(JSON.parse(localStorage.getItem(THRESH_KEY) ?? "null")); } catch { return DEFAULT_LUNAR_THRESHOLDS; }
}

export default function LunarCard({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const [zone, setZone] = useState<{ zone: string; source: "place" | "device" } | null>(null);
  // The model's hourly cloud for the place (the same Open-Meteo read that
  // gives the zone); null = no forecast → the overlay says UNKNOWN, never clear.
  const [cloud, setCloud] = useState<HourlyCloud[] | null>(null);
  const [thresholds, setThresholds] = useState<LunarThresholds>(DEFAULT_LUNAR_THRESHOLDS);
  const [editThr, setEditThr] = useState(false);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const deviceZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } })();

  useEffect(() => {
    setThresholds(loadThresholds());
    try { setOpen(localStorage.getItem(OPEN_KEY) === "1"); } catch { /* ignore */ }
  }, []);

  // The place's own zone — one cached read; a dead feed falls back to the
  // device zone and SAYS so.
  useEffect(() => {
    let alive = true;
    setZone(null);
    setCloud(null);
    const key = `weather:zone:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cloudKey = `weather:cloud:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = clientCache.get<string>(key);
    const cachedCloud = clientCache.get<HourlyCloud[]>(cloudKey);
    if (cached && cachedCloud) { setZone({ zone: cached, source: "place" }); setCloud(cachedCloud); return; }
    fetch(`/api/weather/current?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { current?: { timezone?: string | null; hourlyCloud?: HourlyCloud[] } } | null) => {
        if (!alive) return;
        const tz = j?.current?.timezone;
        if (tz) { clientCache.set(key, tz, 24 * 3_600_000); setZone({ zone: tz, source: "place" }); }
        else setZone({ zone: deviceZone, source: "device" });
        const hc = Array.isArray(j?.current?.hourlyCloud) ? j!.current!.hourlyCloud! : [];
        if (hc.length) clientCache.set(cloudKey, hc, 60 * 60_000);
        setCloud(hc);
      })
      .catch(() => { if (alive) { setZone({ zone: deviceZone, source: "device" }); setCloud([]); } });
    return () => { alive = false; };
  }, [lat, lon, deviceZone]);

  const nights = useMemo<LunarNight[]>(() => {
    if (!zone) return [];
    const today = ymdInZone(Date.now(), zone.zone);
    return lunarNights(lat, lon, zone.zone, today, NIGHTS, thresholds);
  }, [lat, lon, zone, thresholds]);
  const windows = useMemo(() => lunarWindows(nights), [nights]);
  const tonight = nights[0];
  // Cloud over the dark hours, the next CLOUD_NIGHTS nights — read in the
  // zone the hourly stamps are written in (the place's, when it answered).
  const cloudNights = useMemo<(NightCloud | null)[]>(() => {
    if (!zone || !cloud) return [];
    return nights.slice(0, CLOUD_NIGHTS).map((n) => nightCloud(n, cloud, zone.zone));
  }, [nights, cloud, zone]);
  const nextLow = windows.find((w) => w.band === "lo");
  const nextHigh = windows.find((w) => w.band === "hi");

  const saveThresholds = (t: LunarThresholds) => {
    const s = sanitizeThresholds(t);
    setThresholds(s);
    try { localStorage.setItem(THRESH_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  };
  const toggleOpen = () => { setOpen((o) => { try { localStorage.setItem(OPEN_KEY, o ? "0" : "1"); } catch { /* ignore */ } return !o; }); };
  const exportHtml = () => {
    const html = renderLunarHtml({ placeLabel: label, lat, lon, nights: nights.slice(0, 30), thresholds, generatedISO: new Date().toISOString() });
    downloadFile(html, `light-data-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "place"}-${nights[0]?.date ?? ""}.html`, "text/html");
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-slate-800">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">☾ Lunar windows · {label}</h3>
        {tonight && <span className="text-[10px] text-slate-600">tonight {dayShort(tonight.date)} · times {zone?.zone}{zone?.source === "device" ? " (device zone — the place's zone was unavailable)" : ""} · night = EENT → BMNT</span>}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setEditThr((v) => !v)} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200" aria-expanded={editThr}>
            LOW &lt; {thresholds.low}% · HIGH ≥ {thresholds.high}% {editThr ? "▴" : "▾"}
          </button>
          <button type="button" onClick={exportHtml} disabled={!nights.length} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:border-emerald-500/50 disabled:opacity-40" title="Download the 30-night light-data table — one self-contained HTML file, no script, prints to a page">⇩ light data</button>
          <button type="button" onClick={toggleOpen} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:border-sky-500/50" aria-expanded={open}>{open ? "▴" : "▾"} 30-night detail</button>
        </div>
      </div>

      {editThr && (
        <div className="px-4 py-2 border-b border-slate-800 bg-slate-950/40 flex items-center gap-3 flex-wrap text-[11px] text-slate-300">
          <label className="flex items-center gap-1.5">LOW below <input type="number" min={0} max={99} value={thresholds.low} onChange={(e) => saveThresholds({ ...thresholds, low: Number(e.target.value) })} className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-100 font-mono" />%</label>
          <label className="flex items-center gap-1.5">HIGH at or above <input type="number" min={1} max={100} value={thresholds.high} onChange={(e) => saveThresholds({ ...thresholds, high: Number(e.target.value) })} className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-100 font-mono" />%</label>
          <button type="button" onClick={() => saveThresholds(DEFAULT_LUNAR_THRESHOLDS)} className="text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300">reset</button>
          <span className="text-[10px] text-slate-500">planning defaults · Army aviation NVG training minimums sit near 23% with the moon ≥ 30° up · remembered on this browser</span>
        </div>
      )}

      {!zone || !tonight ? (
        <div className="px-4 py-5 text-xs text-slate-500 font-mono">computing the lunar month for {label}…</div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Tonight's light data */}
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
            {[
              ["BMNT", hhmmIn(tonight.bmnt, tonight.zone), ""], ["Sunrise", hhmmIn(tonight.sunrise, tonight.zone), ""],
              ["Sunset", hhmmIn(tonight.sunset, tonight.zone), ""], ["EENT", hhmmIn(tonight.eent, tonight.zone), ""],
              ["Moonrise", tonight.moonrise.length ? tonight.moonrise.map((m) => hhmmIn(m, tonight.zone)).join("/") : "—", ""],
              ["Moonset", tonight.moonset.length ? tonight.moonset.map((m) => hhmmIn(m, tonight.zone)).join("/") : "—", ""],
              ["Illum", `${tonight.illumPct}%`, "moon"], ["Moon-free dark", tonight.polar ? "—" : `${tonight.moonFreeDarkH}h`, "free"],
            ].map(([k, v, kind]) => (
              <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1.5 min-w-0">
                <div className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500 truncate">{k}</div>
                <div className={`text-[15px] font-extrabold font-mono leading-tight ${kind === "moon" ? "text-amber-200" : kind === "free" ? "text-indigo-200" : "text-slate-100"}`}>{v}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-300">
            <span className="font-semibold text-slate-100">Tonight:</span> {tonight.polar ? "no nautical darkness (polar)" : <>
              <span className="text-amber-200">{tonight.illumPct}% {tonight.phaseName}</span> · {tonight.darkH} h dark · moon up <b className="text-slate-100">{tonight.moonlitDarkH} h</b> of it ({tonight.usefulMoonH} h at ≥{MOON_USEFUL_ALT_DEG}°) · <b className="text-indigo-200">{tonight.moonFreeDarkH} h moon-free</b>
              {tonight.moonUp.length === 0 ? " · moon down all night" : tonight.moonUp[0][0] > (tonight.eent ?? 0) ? ` · moon-free until ${hhmmIn(tonight.moonUp[0][0], tonight.zone)}` : tonight.moonUp[tonight.moonUp.length - 1][1] < (tonight.bmnt ?? Infinity) ? ` · moon-free after ${hhmmIn(tonight.moonUp[tonight.moonUp.length - 1][1], tonight.zone)}` : " · moon up all night"}
              {" · "}{tonight.daylightH} h daylight today
            </>}
          </p>
          {!tonight.polar && cloud !== null && (
            <p className="text-[11px] text-slate-400 -mt-1.5">
              <span className="font-semibold text-slate-300">Tonight&apos;s sky:</span> {nightCloudClause(cloudNights[0] ?? null)}
            </p>
          )}

          {/* Cloud overlay — the model's horizon, 7 nights, never re-banding the moon */}
          {cloud !== null && (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1">Cloud over the dark hours · next {CLOUD_NIGHTS} nights <span className="font-normal normal-case tracking-normal text-slate-600">· Open-Meteo model, mean EENT→BMNT · a night keeps its illumination band — cloud says how much of that light reaches the ground</span></div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                {nights.slice(0, CLOUD_NIGHTS).map((n, i) => {
                  const c = cloudNights[i] ?? null;
                  return (
                    <div key={n.date} className={`rounded-lg border px-2 py-1.5 min-w-0 ${c ? COVER_CLS[c.cover] : "text-slate-500 border-slate-800 bg-slate-950/50"}`}
                      title={c ? `${dayLabel(n.date)} · ${nightCloudClause(c)} · ${c.overcastH} h overcast · ${c.clearH} h ≤FEW · ${c.samples} model hours` : `${dayLabel(n.date)} · no forecast for the dark hours`}>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-[8px] font-bold uppercase tracking-wider truncate">{i === 0 ? "tonight" : dayShort(n.date)}</span>
                        <span className="text-[8px] font-mono" style={{ color: moonCol(n.illumPct) }}>☾{n.illumPct}%</span>
                      </div>
                      <div className="text-[14px] font-extrabold font-mono leading-tight">{c ? `${c.meanPct}%` : n.polar ? "polar" : "—"}</div>
                      <div className="text-[9px] font-bold tracking-wider">{c ? c.cover : n.polar ? "" : "UNKNOWN"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Windows */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <WindowBox w={nextHigh} kind="hi" nights={nights} />
            <WindowBox w={nextLow} kind="lo" nights={nights} />
          </div>

          {/* 60-day heat strip */}
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1">Illumination · {NIGHTS} nights <span className="font-normal normal-case tracking-normal text-slate-600">· cell = % lit at local midnight · underline = window · outline = tonight</span></div>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${NIGHTS}, minmax(0,1fr))` }}>
              {nights.map((n, i) => (
                <div key={n.date} title={`${dayLabel(n.date)} · ${n.illumPct}% · ${n.polar ? "polar" : `${n.moonFreeDarkH} h moon-free`}`}
                  className={`h-5 rounded-[2px] ${i === 0 ? "outline outline-2 outline-sky-400 outline-offset-1" : ""}`}
                  style={{ background: n.polar ? "#1e293b" : moonCol(n.illumPct), boxShadow: n.polar ? undefined : n.band === "lo" ? "inset 0 -3px 0 #818cf8" : n.band === "hi" ? "inset 0 -3px 0 #fde68a" : undefined }} />
              ))}
            </div>
            <div className="grid gap-[2px] mt-0.5 text-[8px] font-mono text-slate-600" style={{ gridTemplateColumns: `repeat(${NIGHTS}, minmax(0,1fr))` }}>
              {nights.map((n, i) => { const [, , d] = ymdParts(n.date); return <div key={n.date} className="whitespace-nowrap overflow-visible">{i === 0 || d === 1 || i % 7 === 0 ? dayShort(n.date) : ""}</div>; })}
            </div>
          </div>

          {open && (
            <div className="border-t border-slate-800 pt-3 space-y-3">
              <MonthChart nights={nights.slice(0, 30)} windows={lunarWindows(nights.slice(0, 30))} thresholds={thresholds} />
              <div className="flex items-center gap-3 flex-wrap text-[10px] text-slate-500">
                <span><i className="inline-block w-3 h-2 rounded-sm bg-slate-700/60 align-middle mr-1" />daylight / twilight</span>
                <span><i className="inline-block w-3 h-2 rounded-sm bg-slate-800 align-middle mr-1" />darkness (EENT→BMNT)</span>
                <span><i className="inline-block w-3 h-2 rounded-sm align-middle mr-1" style={{ background: "linear-gradient(90deg,rgba(253,230,138,.3),#fde68a)" }} />moon up during darkness · brighter = more lit · solid = ≥{MOON_USEFUL_ALT_DEG}°, faint = lower</span>
                <span>▲ moonrise · ▼ moonset</span>
                <span className="ml-auto">● new ◐ first quarter ○ full ◑ last quarter</span>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Light data · {showAll ? "30" : "7"} nights</span>
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300">{showAll ? "▴ 7 nights" : "▾ all 30"}</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] whitespace-nowrap">
                    <thead><tr className="text-[9px] uppercase tracking-wider text-slate-500 text-left">
                      {["Night", "BMNT", "Sunrise", "Sunset", "EENT", "Moonrise", "Moonset", "Illum", "Dark", "Moonlit", `≥${MOON_USEFUL_ALT_DEG}°`, "Moon-free", "Window"].map((k) => <th key={k} className="px-2 py-1 border-b border-slate-800 font-bold">{k}</th>)}
                    </tr></thead>
                    <tbody>
                      {nights.slice(0, showAll ? 30 : 7).map((n, i) => (
                        <tr key={n.date} className={`border-b border-slate-800/60 ${i === 0 ? "bg-sky-500/[0.06]" : ""}`}>
                          <td className="px-2 py-1 font-semibold text-slate-100">{dayLabel(n.date)}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{hhmmIn(n.bmnt, n.zone)}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{hhmmIn(n.sunrise, n.zone)}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{hhmmIn(n.sunset, n.zone)}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{hhmmIn(n.eent, n.zone)}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{n.moonrise.map((m) => hhmmIn(m, n.zone)).join("/") || "—"}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{n.moonset.map((m) => hhmmIn(m, n.zone)).join("/") || "—"}</td>
                          <td className={`px-2 py-1 font-mono font-bold ${n.band === "lo" ? "text-indigo-200" : "text-amber-200"}`}>{n.illumPct}%</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{h(n.darkH)}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{h(n.moonlitDarkH)}</td>
                          <td className="px-2 py-1 font-mono text-slate-300">{h(n.usefulMoonH)}</td>
                          <td className="px-2 py-1 font-mono font-bold text-indigo-200">{h(n.moonFreeDarkH)}</td>
                          <td className="px-2 py-1">{n.polar ? <span className="text-[9px] text-slate-500">POLAR</span> : <Pill band={n.band}>{n.band === "hi" ? "HIGH" : n.band === "lo" ? "LOW" : "MOD"}</Pill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-[10px] text-slate-600">Planning-grade: rise and set from a low-precision lunar model, to a minute or two — not an almanac. Night = nautical twilight (sun −12°). Cloud is a 7-night model overlay above and is not part of the budget or the bands.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WindowBox({ w, kind, nights }: { w: LunarWindow | undefined; kind: "hi" | "lo"; nights: LunarNight[] }) {
  const cls = kind === "lo" ? "border-indigo-400/40 bg-indigo-500/[0.07]" : "border-amber-200/35 bg-amber-200/[0.05]";
  const kcls = kind === "lo" ? "text-indigo-200" : "text-amber-200";
  if (!w) return <div className={`rounded-lg border px-3 py-2 ${cls}`}><div className={`text-[9px] font-bold uppercase tracking-[0.14em] ${kcls}`}>{kind === "lo" ? "Next LOW-illumination window" : "Next HIGH-illumination window"}</div><div className="text-[11px] text-slate-400 mt-1">none in the next {nights.length} nights at these thresholds</div></div>;
  const span = nights.slice(w.startIndex, w.startIndex + w.nights);
  const lo = Math.min(...span.map((n) => n.illumPct)), hi = Math.max(...span.map((n) => n.illumPct));
  const b = w.best;
  const upText = b.moonUp.length ? `${hhmmIn(b.moonUp[0][0], b.zone)}–${hhmmIn(b.moonUp[b.moonUp.length - 1][1], b.zone)}` : "";
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[9px] font-bold uppercase tracking-[0.14em] ${kcls}`}>{kind === "lo" ? "Next LOW-illumination window" : "HIGH-illumination window"}</span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{w.startIndex === 0 ? "now" : `in ${w.startIndex} nights`} · {w.nights} nights</span>
      </div>
      <div className="text-[16px] font-extrabold text-slate-100 mt-0.5">{dayShort(w.from)} – {dayShort(w.to)}</div>
      <div className="text-[11px] text-slate-300 leading-snug">
        Illumination {lo}–{hi}%. Best night <b className="text-slate-100">{dayLabel(b.date)}</b>: {b.illumPct}% ·{" "}
        {kind === "lo"
          ? <><b className="text-slate-100">{b.moonFreeDarkH} h</b> moon-free of {b.darkH} h dark{b.moonUp.length ? ` · moon up ${upText}` : " · moon down all night"}</>
          : <>moon up <b className="text-slate-100">{b.moonlitDarkH} h</b> of {b.darkH} h dark ({b.usefulMoonH} h at ≥{MOON_USEFUL_ALT_DEG}°){upText ? ` · ${upText}` : ""}</>}
      </div>
    </div>
  );
}

/** Option A: the illumination curve over 30 nights with a night column per
 *  date (darkness, the moon-up part lit by illumination, the ≥30° part
 *  solid). Hours on the y-axis are LOCAL to the place (17:00 → 07:00).
 *  Exported for the static render check (docs/mockups) — not a public API. */
export function MonthChart({ nights, windows, thresholds }: { nights: LunarNight[]; windows: LunarWindow[]; thresholds: LunarThresholds }) {
  const W = 1180, H = 330, padL = 44, padR = 12, top = 44, chartH = 110, gap = 14, nightH = 126;
  const N = nights.length, colW = (W - padL - padR) / N;
  const x = (i: number) => padL + i * colW;
  const yI = (p: number) => top + chartH - (p / 100) * chartH;
  const ny0 = top + chartH + gap;
  const yT = (hr: number) => ny0 + ((hr - 17) / 14) * nightH;
  const clampY = (hr: number) => Math.max(yT(17), Math.min(yT(31), yT(hr)));
  const phaseGlyph = (n: LunarNight, prev: LunarNight | undefined, next: LunarNight | undefined) => {
    const p = n.illumPct;
    if (p <= 1 && (!prev || prev.illumPct >= p) && (!next || next.illumPct > p)) return "●";
    if (p >= 99 && (!prev || prev.illumPct <= p) && (!next || next.illumPct < p)) return "○";
    if (Math.abs(p - 50) <= 4 && (!prev || Math.abs(prev.illumPct - 50) > Math.abs(p - 50)) && (!next || Math.abs(next.illumPct - 50) >= Math.abs(p - 50))) return n.waxing ? "◐" : "◑";
    return "";
  };
  const path = nights.map((n, i) => `${i ? "L" : "M"}${x(i) + colW / 2},${yI(n.illumPct)}`).join(" ");
  const area = `M${x(0) + colW / 2},${yI(0)} ${nights.map((n, i) => `L${x(i) + colW / 2},${yI(n.illumPct)}`).join(" ")} L${x(N - 1) + colW / 2},${yI(0)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "auto", aspectRatio: `${W} / ${H}`, display: "block" }} role="img" aria-label="Moon illumination and night darkness over 30 nights">
      <defs><linearGradient id="lunar-ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fde68a" stopOpacity=".3" /><stop offset="1" stopColor="#fde68a" stopOpacity="0" /></linearGradient></defs>
      {windows.filter((w) => w.band !== "mid").map((w) => (
        <rect key={w.from} x={x(w.startIndex)} y={top - 6} width={w.nights * colW} height={chartH + gap + nightH + 10} fill={w.band === "hi" ? "rgba(253,230,138,.06)" : "rgba(99,102,241,.10)"} />
      ))}
      {[[thresholds.high, "rgba(253,230,138,.35)"], [thresholds.low, "rgba(165,180,252,.45)"]].map(([p, c]) => (
        <g key={String(p)}><line x1={padL} x2={W - padR} y1={yI(Number(p))} y2={yI(Number(p))} stroke={String(c)} strokeDasharray="3 3" /><text x={padL - 6} y={yI(Number(p)) + 3} fontSize="9" textAnchor="end" fill={String(c)}>{p}%</text></g>
      ))}
      {[0, 100].map((p) => <text key={p} x={padL - 6} y={yI(p) + 3} fontSize="9" textAnchor="end" fill="#475569">{p}%</text>)}
      <path d={area} fill="url(#lunar-ga)" /><path d={path} fill="none" stroke="#fde68a" strokeWidth="2" />
      {nights.map((n, i) => {
        const px = x(i) + colW / 2, g = phaseGlyph(n, nights[i - 1], nights[i + 1]);
        return (<g key={n.date}>
          <circle cx={px} cy={yI(n.illumPct)} r="2.2" fill={moonCol(n.illumPct)} stroke="#0b1220" />
          {g && <><text x={px} y={top - 14} fontSize="12" textAnchor="middle" fill="#e2e8f0">{g}</text><text x={px} y={yI(n.illumPct) - 8} fontSize="9" textAnchor="middle" fill="#fde68a" fontWeight="700">{n.illumPct}%</text></>}
        </g>);
      })}
      {[[18, "1800"], [21, "2100"], [24, "0000"], [27, "0300"], [30, "0600"]].map(([hr, l]) => (
        <g key={String(l)}><line x1={padL} x2={W - padR} y1={yT(Number(hr))} y2={yT(Number(hr))} stroke="rgba(51,65,85,.35)" /><text x={padL - 6} y={yT(Number(hr)) + 3} fontSize="9" textAnchor="end" fill="#475569" fontFamily="ui-monospace,Menlo,monospace">{l}</text></g>
      ))}
      {nights.map((n, i) => {
        const cx = x(i) + 2, cw = colW - 4;
        const lh = (ms: number) => localHours(ms, n.zone, n.date);
        const [, , d] = ymdParts(n.date);
        return (<g key={n.date}>
          <rect x={cx} y={yT(17)} width={cw} height={nightH} fill="rgba(51,65,85,.25)" />
          {!n.polar && <rect x={cx} y={clampY(lh(n.eent!))} width={cw} height={Math.max(0, clampY(lh(n.bmnt!)) - clampY(lh(n.eent!)))} fill="#1e293b" />}
          {n.moonUp.map(([a, b]) => <rect key={a} x={cx} y={clampY(lh(a))} width={cw} height={Math.max(1, clampY(lh(b)) - clampY(lh(a)))} fill={moonCol(n.illumPct)} opacity={0.25 + 0.35 * n.illumPct / 100} />)}
          {n.moonHigh.map(([a, b]) => <rect key={`h${a}`} x={cx} y={clampY(lh(a))} width={cw} height={Math.max(1, clampY(lh(b)) - clampY(lh(a)))} fill={moonCol(n.illumPct)} opacity={0.5 + 0.5 * n.illumPct / 100} />)}
          {n.moonrise.map((m) => { const hr = lh(m); return hr > 17 && hr < 31 ? <text key={m} x={cx + cw / 2} y={yT(hr) + 3} fontSize="7" textAnchor="middle" fill="#fde68a">▲</text> : null; })}
          {n.moonset.map((m) => { const hr = lh(m); return hr > 17 && hr < 31 ? <text key={m} x={cx + cw / 2} y={yT(hr) + 3} fontSize="7" textAnchor="middle" fill="#fde68a">▼</text> : null; })}
          {i % 3 === 0 && <text x={cx + cw / 2} y={H - 4} fontSize="9" textAnchor="middle" fill="#64748b" fontFamily="ui-monospace,Menlo,monospace">{String(d).padStart(2, "0")} {MON[Number(n.date.slice(5, 7)) - 1]}</text>}
          {i === 0 && <><rect x={cx - 1} y={top - 8} width={cw + 2} height={chartH + gap + nightH + 14} fill="none" stroke="#38bdf8" strokeWidth="1.2" rx="2" /><text x={cx + cw / 2} y={top - 26} fontSize="8" textAnchor="middle" fill="#7dd3fc" fontWeight="800" letterSpacing="1">TONIGHT</text></>}
        </g>);
      })}
      {windows.filter((w) => w.band !== "mid").map((w) => (
        <text key={`l${w.from}`} x={x(w.startIndex) + w.nights * colW / 2} y={ny0 + 12} fontSize="9" fontWeight="800" letterSpacing="1.2" textAnchor="middle" fill={w.band === "hi" ? "#fde68a" : "#a5b4fc"} style={{ paintOrder: "stroke", stroke: "#0b1220", strokeWidth: 3 }}>{w.band === "hi" ? "HIGH ILLUM" : "LOW ILLUM"} · {w.nights} nights</text>
      ))}
    </svg>
  );
}

export { illumBand };
