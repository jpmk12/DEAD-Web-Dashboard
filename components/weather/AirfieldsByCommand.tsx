"use client";

import { useMemo, useState } from "react";
import type { StationWx, FlightCategory, LocationHazard } from "@/lib/types";
import { tafTimeline, type TafSegment } from "@/lib/sitrepSignals";
import { CAT_RANK } from "@/lib/aviationWx";
import { COCOM_LABEL, type Aor } from "@/lib/aor";
import { openTrackPicker } from "@/lib/trackClient";
import { ExternalLinkIcon } from "@/lib/icons";
import { LED_CLASS, FLIGHT_CAT_HEX } from "@/lib/levelTokens";
import { relTime } from "@/lib/relTime";

// My airfields, by combatant command (REVIEW-2026-10 W5, W7, W9): the
// registry's airfields — hub › ★ › spokes › rest, the OSINT board's order —
// under one header per COCOM with the worst field named; each card shows the
// decoded METAR, the 24-h TAF category bar the SITREP already computes
// (`tafTimeline`), the worst category ahead with its window, the 30-h model
// hazard, the favoured runway's crosswind when runways are known, and a
// SITREP door. UNKNOWN says why in words. Quiet commands fold to one line.

export interface RegAirfield {
  icao: string; label: string; lat: number; lon: number; country: string; aor: Aor;
  roles: { posture: boolean; metar: boolean; sitrep: boolean; star: boolean };
  own: "hub" | "spoke" | null; auto: boolean;
}

const CAT_CLS: Record<FlightCategory, string> = {
  VFR: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  MVFR: "text-sky-300 bg-sky-500/10 border-sky-500/30",
  IFR: "text-red-300 bg-red-500/10 border-red-500/30",
  LIFR: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30",
  UNKNOWN: "text-slate-400 bg-slate-700/30 border-slate-600/40",
};
const CAT_BAR: Record<FlightCategory, string> = FLIGHT_CAT_HEX;
const AOR_ORDER: Aor[] = ["CENTCOM", "EUCOM", "INDOPACOM", "AFRICOM", "SOUTHCOM", "NORTHCOM", "UNKNOWN"];
const zHour = (ms: number) => `${String(new Date(ms).getUTCHours()).padStart(2, "0")}Z`;
const obsAge = (iso: string) => relTime(iso);

type Led = "r" | "a" | "g" | "u";
const LED_DOT: Record<Led, string> = LED_CLASS;
const worstLed = (a: Led, b: Led): Led => (["r", "a", "g", "u"] as Led[]).find((l) => a === l || b === l) ?? "u";

interface Read {
  a: RegAirfield; wx: StationWx | undefined; cat: FlightCategory; segs: TafSegment[];
  worstAhead: { cat: FlightCategory; from: number; to: number } | null; hazard: LocationHazard | null; led: Led; why: string;
}

function readOf(a: RegAirfield, wx: StationWx | undefined, hazards: LocationHazard[], now: number, awcDown: boolean): Read {
  const cat: FlightCategory = wx?.metar?.flightCategory ?? "UNKNOWN";
  const segs = wx?.taf?.periods?.length ? tafTimeline(wx.taf.periods, now) : [];
  let worstAhead: Read["worstAhead"] = null;
  for (const s of segs) if (s.cat !== "UNKNOWN" && (!worstAhead || CAT_RANK[s.cat] > CAT_RANK[worstAhead.cat])) worstAhead = { cat: s.cat, from: s.fromMs, to: s.toMs };
  const hazard = hazards.find((h) => h.label === a.icao || (Math.abs(h.lat - a.lat) < 0.05 && Math.abs(h.lon - a.lon) < 0.05)) ?? null;
  const rank = Math.max(CAT_RANK[cat], worstAhead ? CAT_RANK[worstAhead.cat] : -1);
  let led: Led = rank >= 2 ? "r" : rank === 1 ? "a" : rank === 0 ? "g" : "u";
  if (hazard?.severity === "severe") led = "r"; else if (hazard && led !== "r") led = "a";
  const why = worstAhead && CAT_RANK[worstAhead.cat] >= 1 && worstAhead.cat !== cat
    ? `${worstAhead.cat} forecast ${zHour(worstAhead.from)}–${zHour(worstAhead.to)}`
    : rank >= 1 ? `${cat} now` : hazard ? hazard.flags[0] : cat === "UNKNOWN" ? (awcDown ? "AWC unreachable" : "no observation") : "VFR";
  return { a, wx, cat, segs, worstAhead, hazard, led, why };
}

const ownRank = (a: RegAirfield) => (a.own === "hub" ? 0 : a.roles.star ? 1 : a.own === "spoke" ? 2 : 3);

function TafBar({ segs, now }: { segs: TafSegment[]; now: number }) {
  const span = 24 * 3600_000;
  return (
    <div>
      <div className="flex h-2 rounded overflow-hidden border border-slate-800 bg-slate-800/60">
        {segs.map((s, i) => (
          <div key={i} title={`${s.cat} ${zHour(s.fromMs)}–${zHour(s.toMs)}`} style={{ width: `${Math.max(1, ((s.toMs - s.fromMs) / span) * 100)}%`, background: CAT_BAR[s.cat] }} />
        ))}
      </div>
      <div className="flex justify-between text-[8px] font-mono text-slate-600 mt-0.5"><span>now</span><span>{zHour(now + 6 * 3600_000)}</span><span>{zHour(now + 12 * 3600_000)}</span><span>{zHour(now + 18 * 3600_000)}</span><span>+24h</span></div>
    </div>
  );
}

function openSitrep(icao: string) {
  window.dispatchEvent(new CustomEvent("app:navigate", { detail: "osint" }));
  setTimeout(() => window.dispatchEvent(new CustomEvent("osint:set-pane", { detail: "commands" })), 40);
  setTimeout(() => window.dispatchEvent(new CustomEvent("watch:focus", { detail: { kind: "sitrep", id: icao } })), 160);
}

function FieldCard({ r, now, selected, onSelect, canEdit }: { r: Read; now: number; selected: boolean; onSelect: () => void; canEdit: boolean }) {
  const m = r.wx?.metar ?? null;
  const [raw, setRaw] = useState(false);
  const x = r.wx?.xwind ?? null;
  return (
    <div className={`rounded-xl border p-3 bg-slate-950/40 ${selected ? "border-sky-500/60" : r.led === "r" ? "border-red-500/40" : r.led === "a" ? "border-amber-500/40" : "border-slate-800"}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {r.a.roles.star && <span className="text-amber-300 text-[11px]">★</span>}
        <span className="text-[12.5px] font-extrabold font-mono text-slate-100">{r.a.icao}</span>
        <span className="text-[11px] text-slate-400 truncate min-w-0 flex-1">{r.a.label}{r.a.country ? ` · ${r.a.country}` : ""}</span>
        {r.a.own && <span className="text-[8px] font-bold uppercase tracking-widest border border-slate-700 rounded px-1 py-px text-slate-400">{r.a.own}</span>}
        {!r.a.own && r.a.auto && <span className="text-[8px] font-mono font-bold text-emerald-400/80 bg-emerald-500/10 rounded px-1">AUTO</span>}
        <span title={r.cat === "UNKNOWN" ? "No observation — UNKNOWN is not VFR" : undefined} className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${CAT_CLS[r.cat]}`}>{r.cat}</span>
        <button type="button" disabled={!canEdit} onClick={() => openTrackPicker({ kind: "airfield", icao: r.a.icao })} title="Change what this field is tracked for, or untrack it" className="text-slate-600 hover:text-red-400 text-xs px-1 disabled:opacity-40" aria-label={`Edit tracking for ${r.a.icao}`}>✕</button>
      </div>

      {m ? (
        <>
          <p className="mt-1.5 text-[11px] text-slate-300 leading-relaxed">{m.summary}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-slate-500">
            {m.windSpeedKt != null && <span>wind <b className="text-slate-300 font-semibold">{m.windSpeedKt === 0 ? "calm" : `${m.windVariable ? "VRB" : m.windDir ?? "—"}@${m.windSpeedKt}${m.windGustKt ? `G${m.windGustKt}` : ""}kt`}</b></span>}
            {m.visibilityMi != null && <span>vis <b className="text-slate-300 font-semibold">{m.visibilityMi >= 10 ? "10+" : m.visibilityMi} mi</b></span>}
            <span>ceil <b className="text-slate-300 font-semibold">{m.ceilingFt != null ? `${m.ceilingFt.toLocaleString()} ft` : "none"}</b></span>
            {x && <span title={`Favoured runway ${x.ident} — crosswind component (planning-grade, not a limit)`}>xwind {x.ident} <b className={`font-semibold ${x.flag === "r" ? "text-red-300" : x.flag === "a" ? "text-amber-300" : "text-slate-300"}`}>{x.crossKt} kt{x.gustCrossKt != null ? ` (G${x.gustCrossKt})` : ""}</b></span>}
            {m.pressureTendency != null && m.pressureTendency !== 0 && <span>baro <b className="text-slate-300 font-semibold">{m.pressureTendency > 0 ? "↑ rising" : "↓ falling"}</b></span>}
            {m.observedAt && <span>obs <b className="text-slate-300 font-semibold">{obsAge(m.observedAt)}</b></span>}
          </div>
          {m.weather && <p className="mt-1 text-[10px] text-amber-400">⚠ {m.weather}</p>}
        </>
      ) : (
        <p className="mt-1.5 text-[11px] text-slate-500 italic">{r.wx?.error === "No data reported" ? "No observation reported — the field may not report at this hour. UNKNOWN is not VFR." : r.wx?.error ?? (r.wx ? "No current observation." : "Loading…")}</p>
      )}

      {r.segs.length > 0 ? (
        <div className="mt-2">
          <div className="flex justify-between text-[8px] uppercase tracking-widest text-slate-600 mb-0.5">
            <span>TAF · next 24 h</span>
            <span>worst ahead: {r.worstAhead ? <span className={CAT_RANK[r.worstAhead.cat] >= 2 ? "text-red-300" : CAT_RANK[r.worstAhead.cat] === 1 ? "text-sky-300" : "text-emerald-300"}>{r.worstAhead.cat}{CAT_RANK[r.worstAhead.cat] >= 1 ? ` ${zHour(r.worstAhead.from)}–${zHour(r.worstAhead.to)}` : ""}</span> : "—"}</span>
          </div>
          <TafBar segs={r.segs} now={now} />
        </div>
      ) : m ? <p className="mt-2 text-[9px] text-slate-600">No TAF issued for this field.</p> : null}

      {r.hazard && <p className={`mt-1.5 text-[10px] ${r.hazard.severity === "severe" ? "text-red-300" : "text-amber-300"}`}>⚠ {r.hazard.flags.join(" · ")} <span className="text-slate-600">· model (Open-Meteo)</span></p>}

      <div className="mt-2 flex items-center gap-3">
        {r.a.roles.sitrep ? <button type="button" onClick={() => openSitrep(r.a.icao)} className="text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300">SITREP →</button>
          : <button type="button" disabled={!canEdit} onClick={() => openTrackPicker({ kind: "airfield", icao: r.a.icao })} className="text-[9px] font-bold uppercase tracking-wider text-slate-600 hover:text-amber-300 disabled:opacity-50" title="★ gives this field a SITREP slot">no SITREP · ★ to add</button>}
        <button type="button" onClick={onSelect} className="text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-sky-300">map</button>
        {m && <button type="button" onClick={() => setRaw((v) => !v)} className="text-[9px] font-mono text-slate-600 hover:text-slate-300">{raw ? "− raw" : "+ raw"}</button>}
        <span className="ml-auto text-[8px] font-mono text-slate-600">AWC{r.hazard || true ? " · Open-Meteo" : ""}</span>
      </div>
      {raw && m && <pre className="mt-1.5 text-[10px] font-mono text-slate-500 whitespace-pre-wrap break-words">{m.raw}{r.wx?.taf?.raw ? `\n${r.wx.taf.raw}` : ""}</pre>}
    </div>
  );
}

export default function AirfieldsByCommand({ airfields, stations, awcDown, loading, hazards, selectedLabel, onSelect, canEdit }: {
  airfields: RegAirfield[]; stations: Record<string, StationWx>; awcDown: boolean; loading: boolean; hazards: LocationHazard[];
  selectedLabel: string | null; onSelect: (p: { label: string; lat: number; lon: number }) => void; canEdit: boolean;
}) {
  const [hideGreen, setHideGreen] = useState(false);
  const now = Date.now();
  const groups = useMemo(() => {
    const reads = airfields.filter((a) => a.icao).map((a) => readOf(a, stations[a.icao], hazards, now, awcDown));
    const by = new Map<Aor, Read[]>();
    for (const r of reads) { const k = r.a.aor; if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); }
    return AOR_ORDER.filter((aor) => by.has(aor)).map((aor) => {
      const rows = by.get(aor)!.sort((x, y) => ownRank(x.a) - ownRank(y.a) || x.a.label.localeCompare(y.a.label));
      const led = rows.reduce<Led>((acc, r) => worstLed(acc, r.led), "u");
      const worst = rows.slice().sort((x, y) => ["r", "a", "u", "g"].indexOf(x.led) - ["r", "a", "u", "g"].indexOf(y.led))[0];
      return { aor, rows, led, worst };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airfields, stations, hazards, awcDown]);
  const quiet = AOR_ORDER.filter((a) => a !== "UNKNOWN" && !groups.some((g) => g.aor === a));

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-slate-800">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">✈ My airfields</h3>
        <span className="text-[10px] text-slate-600">METAR · TAF · 30-h hazards — by combatant command, hub › ★ › spokes › rest</span>
        <span className="ml-auto flex items-center gap-2">
          {awcDown && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/40" title="aviationweather.gov unreachable — blank cards are missing data, not clear weather">⚠ AWC down</span>}
          {loading && <span className="text-[9px] text-slate-600 font-mono animate-pulse">loading…</span>}
          <a href="https://aviationweather.gov/gfa/#sigmet" target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono font-bold text-amber-400 hover:text-amber-300">SIGMET <ExternalLinkIcon size={11} className="inline -mt-px" /></a>
          <button type="button" onClick={() => setHideGreen((v) => !v)} className={`text-[9px] font-bold uppercase tracking-wider border rounded px-2 py-0.5 ${hideGreen ? "border-emerald-500/50 text-emerald-300" : "border-slate-700 text-slate-400"}`}>{hideGreen ? "showing non-green" : "hide green"}</button>
          <button type="button" disabled={!canEdit} onClick={() => openTrackPicker({ kind: "airfield" })} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40">＋ Airfield</button>
        </span>
      </div>
      {airfields.length === 0 && <p className="px-4 py-4 text-[11px] text-slate-500">No airfield tracked. <button type="button" onClick={() => openTrackPicker({ kind: "airfield" })} className="text-emerald-400 hover:underline">Track one</button> — by ICAO, name or country; posture + METAR by default.</p>}
      {groups.map((g) => {
        const rows = hideGreen ? g.rows.filter((r) => r.led !== "g") : g.rows;
        return (
          <div key={g.aor} className="border-t border-slate-800/70">
            <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-950/40 text-[11px]">
              <span className={`w-2 h-2 rounded-full ${LED_DOT[g.led]}`} />
              <b className="text-slate-100 tracking-wide">{COCOM_LABEL[g.aor]}</b>
              <span className="text-[9.5px] font-mono text-slate-500">{g.rows.length} field{g.rows.length === 1 ? "" : "s"} · {g.rows.filter((r) => r.led === "r").length ? `${g.rows.filter((r) => r.led === "r").length} red` : g.rows.filter((r) => r.led === "a").length ? `${g.rows.filter((r) => r.led === "a").length} amber` : g.led === "u" ? "UNKNOWN" : "all VFR"}</span>
              {g.worst && g.led !== "g" && <span className="ml-auto text-[10px] text-slate-400 truncate">worst: <span className="font-mono text-slate-200">{g.worst.a.icao}</span> — {g.worst.why}</span>}
            </div>
            {rows.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 p-3">
                {rows.map((r) => <FieldCard key={r.a.icao} r={r} now={now} selected={selectedLabel === r.a.icao} onSelect={() => onSelect({ label: r.a.icao, lat: r.a.lat, lon: r.a.lon })} canEdit={canEdit} />)}
              </div>
            )}
            {rows.length === 0 && <p className="px-4 py-2 text-[10px] text-slate-600">all green — hidden</p>}
          </div>
        );
      })}
      {quiet.length > 0 && <p className="px-4 py-2 border-t border-slate-800/70 text-[10.5px] text-slate-600">{quiet.map((a) => COCOM_LABEL[a]).join(" · ")} — no airfield tracked.</p>}
    </div>
  );
}
