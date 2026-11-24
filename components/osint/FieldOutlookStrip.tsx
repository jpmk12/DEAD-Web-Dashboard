"use client";

import type { FieldOutlook, OutlookBlock } from "@/lib/fieldOutlook";
import { flagChip, wmoTileWord, FLAG_GUST_KT, FLAG_VIS_MI } from "@/lib/fieldOutlook";
import { WeatherIcon, wmoIconId } from "@/lib/weatherIcon";

// The 72-hour outlook on the SITREP Weather card — twelve 6-hour Zulu blocks,
// grouped by Zulu day, in a strip that scrolls sideways inside its own box
// (the card is ~280 px wide in the two-column SITREP view, so four tiles to a
// row could not carry more than an icon and a number). Each tile reads top to
// bottom like a forecaster's column (2026-11-24, "a better understanding of
// the weather for each time slice"):
//   time · TAF category (or "model only") · icon + the weather in WORDS ·
//   temperature (°F, °C beneath) · wind with a direction arrow and the gust ·
//   precipitation chance as a bar + amount · cloud cover as a bar ·
//   visibility · the block's flags as short chips (TS, FZRA, G34, IFR…).
// Night blocks sit on a darker sky. A flagged block is amber with its reasons
// on the chips; nothing here is ever red and nothing here moves the weather
// LED. The model is planning-grade; the TAF governs its own window.

const CAT_CLS: Record<string, string> = {
  VFR: "text-emerald-300 border-emerald-600/50 bg-emerald-500/10",
  MVFR: "text-sky-300 border-sky-600/50 bg-sky-500/10",
  IFR: "text-red-300 border-red-600/50 bg-red-500/10",
  LIFR: "text-fuchsia-300 border-fuchsia-600/50 bg-fuchsia-500/10",
};
const cToF = (c: number | null) => (c == null ? null : Math.round(c * 9 / 5 + 32));
const dow = (ymd: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${ymd}T12:00:00Z`).getUTCDay()] ?? ymd;
const hh = (ms: number) => `${String(new Date(ms).getUTCHours()).padStart(2, "0")}Z`;
const pad3 = (d: number) => String(d === 0 ? 360 : d).padStart(3, "0");

/** Arrow pointing where the wind blows TO (a 310° wind flows toward 130°). */
function WindArrow({ dir }: { dir: number | null }) {
  if (dir == null) return <span className="text-[9px] text-slate-600" aria-hidden>·</span>;
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden style={{ transform: `rotate(${dir}deg)` }} className="shrink-0">
      <path d="M6 11 L6 2 M6 11 L3 7.5 M6 11 L9 7.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bar({ pct, cls }: { pct: number | null; cls: string }) {
  return (
    <span className="block h-1 w-full rounded-full bg-slate-800 overflow-hidden" aria-hidden>
      {pct != null && pct > 0 && <span className={`block h-full rounded-full ${cls}`} style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />}
    </span>
  );
}

function Tile({ b }: { b: OutlookBlock }) {
  const word = wmoTileWord(b.code);
  const flagged = b.flags.length > 0;
  const fHi = cToF(b.tempMaxC), fLo = cToF(b.tempMinC);
  const gustStrong = b.gustKt != null && b.gustKt >= FLAG_GUST_KT - 5;
  const showGust = b.gustKt != null && b.windKt != null && b.gustKt > b.windKt + 4;
  const visLow = b.visMi != null && b.visMi < FLAG_VIS_MI;
  const visMid = b.visMi != null && b.visMi < 5;
  const sky = b.isDay ? "bg-slate-900/40" : "bg-indigo-950/40";
  // The TAF chip already names IFR / LIFR at the top — not twice.
  const chips = [...new Set(b.flags.map(flagChip))].filter((c) => c !== b.taf);
  const tip = [
    `${hh(b.fromMs)}–${hh(b.toMs)} · ${word}${b.isDay ? "" : " (night)"}`,
    b.tempMinC != null ? `temperature ${b.tempMinC}…${b.tempMaxC} °C (${fLo}…${fHi} °F)` : null,
    b.windKt != null ? `wind ${b.windDir != null ? `${pad3(b.windDir)}°` : "variable"} ${b.windKt} kt${b.gustKt != null ? `, gusts ${b.gustKt} kt` : ""}` : null,
    b.precipPct != null ? `precipitation chance ${b.precipPct}%${b.precipMm ? `, ${b.precipMm} mm` : ""}` : null,
    b.cloudPct != null ? `cloud cover ${b.cloudPct}%` : null,
    b.visMi != null ? `visibility ${b.visMi} mi (model)` : null,
    b.taf ? `TAF: ${b.taf} (the TAF governs this window)` : b.inTaf ? null : "beyond the TAF — model only",
    ...b.flags.map((f) => `⚠ ${f}`),
  ].filter(Boolean).join("\n");
  return (
    <div title={tip} className={`w-[104px] shrink-0 rounded-md border px-1.5 py-1.5 flex flex-col gap-1 ${flagged ? "border-amber-500/60 bg-amber-500/[0.07]" : `border-slate-800/70 ${sky}`}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[9px] font-mono font-bold text-slate-400">{hh(b.fromMs)}–{hh(b.toMs)}</span>
        {b.taf
          ? <span className={`px-1 rounded border text-[8px] font-mono font-bold ${CAT_CLS[b.taf]}`}>{b.taf}</span>
          : <span className="text-[7.5px] uppercase tracking-wide text-slate-600" title="Beyond the TAF — model only">model</span>}
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        {b.code != null ? <WeatherIcon id={wmoIconId(b.code, b.isDay)} isDay={b.isDay} size={20} strokeWidth={2} title={word} /> : <span className="text-slate-700">·</span>}
        <span className={`text-[9.5px] leading-tight font-semibold ${flagged ? "text-amber-200" : "text-slate-200"} min-w-0`}>{word}</span>
      </div>
      <div className="leading-none">
        <span className="text-[14px] font-bold text-slate-100 tabular-nums">{fHi ?? "—"}°</span>
        {fLo != null && fLo !== fHi && <span className="text-[10px] text-slate-500 tabular-nums"> / {fLo}°F</span>}
        {b.tempMaxC != null && <span className="block text-[8.5px] text-slate-600 tabular-nums mt-0.5">{b.tempMinC === b.tempMaxC ? `${b.tempMaxC}` : `${b.tempMinC}…${b.tempMaxC}`} °C</span>}
      </div>
      <div className="flex items-center gap-1 text-[9.5px] font-mono tabular-nums text-slate-300">
        <WindArrow dir={b.windDir} />
        <span>{b.windKt == null ? "—" : `${b.windDir != null ? pad3(b.windDir) : "VRB"}/${b.windKt}`}</span>
        {showGust && <span className={gustStrong ? "text-amber-300 font-bold" : "text-slate-400"}>G{b.gustKt}</span>}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-1 text-[8.5px] tabular-nums">
          <span className="text-slate-500">precip</span>
          <span className={b.precipPct != null && b.precipPct >= 50 ? "text-sky-300 font-semibold" : "text-slate-400"}>{b.precipPct != null ? `${b.precipPct}%` : "—"}{b.precipMm ? ` · ${b.precipMm}mm` : ""}</span>
        </div>
        <Bar pct={b.precipPct} cls="bg-sky-500/80" />
      </div>
      <div>
        <div className="flex items-baseline justify-between text-[8.5px] tabular-nums">
          <span className="text-slate-500">cloud</span>
          <span className="text-slate-400">{b.cloudPct != null ? `${b.cloudPct}%` : "—"}</span>
        </div>
        <Bar pct={b.cloudPct} cls="bg-slate-400/70" />
      </div>
      <div className="flex items-baseline justify-between text-[8.5px] tabular-nums">
        <span className="text-slate-500">vis</span>
        <span className={visLow ? "text-amber-300 font-bold" : visMid ? "text-amber-200/80" : "text-slate-400"}>{b.visMi == null ? "—" : b.visMi >= 10 ? "10+ mi" : `${b.visMi} mi`}</span>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-0.5">
          {chips.map((c) => <span key={c} className="text-[8px] font-mono font-bold px-1 rounded border border-amber-500/50 text-amber-200 bg-amber-500/10">{c}</span>)}
        </div>
      )}
    </div>
  );
}

export default function FieldOutlookStrip({ outlook }: { outlook: FieldOutlook }) {
  if (!outlook.live) {
    return <p className="text-[10px] text-slate-500 mt-2.5">{outlook.summary}</p>;
  }
  return (
    <div className="mt-2.5 border border-slate-800/60 rounded-lg px-2.5 py-2 min-w-0">
      <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <span className={`w-2 h-2 rounded-full ${outlook.flagged ? "bg-amber-400" : "bg-slate-500"}`} />
        Outlook — next 72 h
        <span className="ml-auto font-normal normal-case tracking-normal text-slate-600">6-h Zulu blocks · scroll →</span>
      </p>
      <p className={`text-[11px] mt-1 ${outlook.flagged ? "text-amber-300" : "text-slate-400"}`}>{outlook.summary}</p>
      <div className="mt-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5">
        <div className="flex gap-2.5 w-max">
          {outlook.days.map((d) => (
            <div key={d.date} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5 px-0.5 text-[9.5px] whitespace-nowrap">
                <b className="text-slate-200 text-[10.5px]">{dow(d.date)} {d.date.slice(8)}</b>
                <span className="font-mono text-slate-400 tabular-nums">{cToF(d.hiC) ?? "—"}° / {cToF(d.loC) ?? "—"}°F</span>
                {d.maxPrecipPct != null && d.maxPrecipPct > 0 && <span className="font-mono text-sky-400 tabular-nums">☂ {d.maxPrecipPct}%</span>}
              </div>
              <div className="flex gap-1">
                {d.blocks.map((b) => <Tile key={b.fromMs} b={b} />)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[9px] text-slate-600 mt-1">
        model (Open-Meteo) planning-grade · the TAF category chip shows where the TAF reaches{outlook.tafEndMs ? ` (to ${hh(outlook.tafEndMs)} ${new Date(outlook.tafEndMs).toISOString().slice(8, 10)})` : ""} and governs its window · arrow = where the wind blows to · darker tile = night · amber = thunderstorms, freezing precipitation, snow, wind ≥25 / gusts ≥30 kt, model vis &lt;3 mi beyond the TAF, or TAF IFR · never moves the weather LED
      </p>
    </div>
  );
}
