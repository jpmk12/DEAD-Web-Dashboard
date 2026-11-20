"use client";

import type { FieldOutlook, OutlookBlock } from "@/lib/fieldOutlook";
import { wmoWordShort } from "@/lib/fieldOutlook";
import { WeatherIcon, wmoIconId } from "@/lib/weatherIcon";

// The 72-hour outlook on the SITREP Weather card — one row per Zulu day, four
// 6-hour blocks each, read the way the Weather tab's cards read a week: an
// icon, the temperature, then the aviation columns (wind / gust in knots,
// precipitation chance, visibility when it is down, the TAF category where the
// TAF reaches). A flagged block is amber with its reasons on hover; nothing
// here is ever red and nothing here moves the weather LED.

const CAT_CLS: Record<string, string> = {
  VFR: "text-emerald-400 border-emerald-700/50",
  MVFR: "text-sky-400 border-sky-700/50",
  IFR: "text-red-400 border-red-700/50",
  LIFR: "text-fuchsia-400 border-fuchsia-700/50",
};
const cToF = (c: number | null) => (c == null ? null : Math.round(c * 9 / 5 + 32));
const dow = (ymd: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${ymd}T12:00:00Z`).getUTCDay()] ?? ymd;
const hh = (ms: number) => `${String(new Date(ms).getUTCHours()).padStart(2, "0")}Z`;

function windText(b: OutlookBlock): string {
  if (b.windKt == null) return "—";
  const dir = b.windDir != null ? String(b.windDir === 0 ? 360 : b.windDir).padStart(3, "0") : "VRB";
  return `${dir}/${b.windKt}${b.gustKt != null && b.gustKt > b.windKt + 4 ? `G${b.gustKt}` : ""}`;
}

export default function FieldOutlookStrip({ outlook }: { outlook: FieldOutlook }) {
  if (!outlook.live) {
    return <p className="text-[10px] text-slate-500 mt-2.5">{outlook.summary}</p>;
  }
  return (
    <div className="mt-2.5 border border-slate-800/60 rounded-lg px-2.5 py-2">
      <p className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <span className={`w-2 h-2 rounded-full ${outlook.flagged ? "bg-amber-400" : "bg-slate-500"}`} />
        Outlook — next 72 h
        <span className="ml-auto font-normal normal-case tracking-normal text-slate-600">6-h Zulu blocks · °F · wind kt</span>
      </p>
      <p className={`text-[11px] mt-1 ${outlook.flagged ? "text-amber-300" : "text-slate-400"}`}>{outlook.summary}</p>
      <div className="mt-1.5 space-y-1">
        {outlook.days.map((d) => (
          <div key={d.date} className="grid grid-cols-[52px_repeat(4,minmax(0,1fr))] gap-1 items-stretch">
            <div className="text-[9px] text-slate-500 leading-tight pt-1">
              <b className="text-slate-300 text-[10px]">{dow(d.date)}</b> {d.date.slice(8)}
              <br />
              <span className="font-mono">{cToF(d.hiC) ?? "—"}/{cToF(d.loC) ?? "—"}°</span>
              {d.maxPrecipPct != null && d.maxPrecipPct > 0 && <><br /><span className="font-mono text-sky-400">{d.maxPrecipPct}%</span></>}
            </div>
            {/* Pad so a day that starts mid-way keeps its blocks under the right hour. */}
            {Array.from({ length: Math.floor(new Date(d.blocks[0].fromMs).getUTCHours() / 6) }).map((_, i) => <div key={`pad${i}`} />)}
            {d.blocks.map((b) => {
              const word = wmoWordShort(b.code);
              const tip = [
                `${hh(b.fromMs)}–${hh(b.toMs)} · ${word}`,
                b.tempMinC != null ? `${b.tempMinC}…${b.tempMaxC} °C` : null,
                b.windKt != null ? `wind ${windText(b)} kt` : null,
                b.precipPct != null ? `precip ${b.precipPct}%${b.precipMm ? ` (${b.precipMm} mm)` : ""}` : null,
                b.visMi != null ? `vis ${b.visMi} mi (model)` : null,
                b.cloudPct != null ? `cloud ${b.cloudPct}%` : null,
                b.taf ? `TAF ${b.taf}` : b.inTaf ? null : "beyond the TAF — model only",
                ...b.flags.map((f) => `⚠ ${f}`),
              ].filter(Boolean).join("\n");
              return (
                <div key={b.fromMs} title={tip} className={`rounded-md border px-1 py-1 text-center ${b.flags.length ? "border-amber-500/50 bg-amber-500/[0.06]" : "border-slate-800/60"}`}>
                  <p className="text-[8.5px] font-mono text-slate-500">{hh(b.fromMs)}</p>
                  <div className="flex justify-center my-0.5">
                    {b.code != null ? <WeatherIcon id={wmoIconId(b.code, b.isDay)} isDay={b.isDay} size={15} strokeWidth={2} title={word} /> : <span className="text-slate-700">·</span>}
                  </div>
                  <p className="text-[10px] font-bold text-slate-300">{cToF(b.tempMaxC) ?? "—"}°</p>
                  <p className={`text-[8.5px] font-mono ${b.gustKt != null && b.gustKt >= 30 ? "text-amber-300" : "text-slate-500"}`}>{windText(b)}</p>
                  {b.precipPct != null && b.precipPct > 0 && <p className="text-[8px] font-mono text-sky-400">{b.precipPct}%</p>}
                  {b.visMi != null && b.visMi < 5 && <p className="text-[8px] font-mono text-amber-300/90">{b.visMi}mi</p>}
                  {b.taf && <span className={`inline-block mt-0.5 px-1 rounded border text-[7.5px] font-mono ${CAT_CLS[b.taf]}`}>{b.taf}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[9px] text-slate-600 mt-1">
        model (Open-Meteo) planning-grade · TAF category shown where the TAF reaches{outlook.tafEndMs ? ` (to ${hh(outlook.tafEndMs)} ${new Date(outlook.tafEndMs).toISOString().slice(8, 10)})` : ""} — the TAF governs its window · amber = thunderstorms, freezing precipitation, snow, wind ≥25 / gusts ≥30 kt, model vis &lt;3 mi beyond the TAF, or TAF IFR · never moves the weather LED
      </p>
    </div>
  );
}
