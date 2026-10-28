"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wrench } from "@/lib/icons";
import { useEffectiveZone, deviceZone } from "@/lib/zoneClient";
import { DEFAULT_CLOCKS, isValidTz, formatUtcOffset, type ClockDef } from "@/lib/worldClocks";
import { toast } from "@/lib/feedback";
import {
  ymdToJulian, parseJulianInput, daysBetween, isoWeek, parseYmd,
  wallToMs, inZone, dtgZulu, parseDtg, DEFAULT_H_OFFSETS, hLabel, parseOffsetInput, hHourTable, hTableText, hCountdown,
} from "@/lib/plannerTools";
import { lightAt, forecastLine, nearestLightEvent, nightDateFor, SUN_STATE_LABEL, type Tone } from "@/lib/hHour";
import { hhmmZ, lunarNight, lunarTonightLine, zoneForLongitude, MOON_USEFUL_ALT_DEG } from "@/lib/moon";
import { readPrivate, writePrivate, parseLatLon, PRIVATE_BLOCKS } from "@/lib/toolsPrivacy";
import type { HConsiderations } from "@/app/api/tools/hhour/route";

// The Tools tab — planner date-time arithmetic, ALL of it in the browser
// (lib/plannerTools, PURE, tested): no model, nothing stored but this
// browser's own H-hour (localStorage). Three cards: the Julian converter
// (date ↔ ordinal day), the H-hour planner (one anchor, every offset in
// every clock the operator keeps, as DTGs — and, once a PLACE is chosen,
// what H looks like there: light, moon, forecast, TAF, NOTAM windows,
// posture, holidays, space weather, from /api/tools/hhour), and day
// arithmetic. The zones offered are the ones the Glance clock row already
// shows plus Zulu, this device and the effective zone — one list, no
// second editor; the places are the ones the app already tracks.
//
// PRIVATE MODE (lib/toolsPrivacy): the tab has exactly ONE network door
// (`toolsFetch`) and ONE storage door (`saveH`), both of which refuse while
// the switch is on — tests/toolsPrivacy.test.ts pins them as the only
// network call and the only storage write in this file. While private: no
// request leaves the tab (the zone hook, which fetches /api/zone, is not
// mounted), nothing is written, the place is typed as coordinates, and the
// At-H panel shows only what the browser computes itself. The scope is
// this tab; the rest of the dashboard keeps its own polling, and the
// header says so.

const H_KEY = "tools.hhour";
const CLOCKS_KEY = "glance.clocks";

interface ZoneCol { zone: string; label: string }
export interface HPlace { kind: "airfield" | "home" | "tdy" | "place" | "manual"; id: string; label: string; lat: number; lon: number; icao: string | null; country: string | null; own?: "hub" | "spoke" | null }
interface HState { hMs: number | null; offsets: number[]; hidden: string[]; place: HPlace | null }

/** The tab's ONLY network door. Private → null, and nothing is sent. */
async function toolsFetch<T>(path: string, priv: boolean): Promise<T | null> {
  if (priv) return null;
  try {
    const r = await fetch(path, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

function loadClocks(): ClockDef[] {
  try {
    const raw = localStorage.getItem(CLOCKS_KEY);
    if (!raw) return DEFAULT_CLOCKS;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_CLOCKS;
    const out = arr.filter((c): c is ClockDef => c && typeof c.label === "string" && typeof c.tz === "string" && isValidTz(c.tz));
    return out.length ? out : DEFAULT_CLOCKS;
  } catch { return DEFAULT_CLOCKS; }
}

const EMPTY_H: HState = { hMs: null, offsets: DEFAULT_H_OFFSETS, hidden: [], place: null };

function loadH(): HState {
  try {
    const raw = localStorage.getItem(H_KEY);
    if (!raw) return EMPTY_H;
    const j = JSON.parse(raw);
    const hMs = typeof j.hMs === "number" && Number.isFinite(j.hMs) ? j.hMs : null;
    const offsets = Array.isArray(j.offsets) ? j.offsets.filter((o: unknown): o is number => typeof o === "number" && Number.isFinite(o)) : DEFAULT_H_OFFSETS;
    const hidden = Array.isArray(j.hidden) ? j.hidden.filter((z: unknown): z is string => typeof z === "string") : [];
    const p = j.place;
    const place: HPlace | null = p && typeof p.label === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon)
      ? { kind: p.kind ?? "place", id: String(p.id ?? p.label), label: p.label, lat: p.lat, lon: p.lon, icao: typeof p.icao === "string" ? p.icao : null, country: typeof p.country === "string" ? p.country : null, own: p.own ?? null }
      : null;
    return { hMs, offsets: offsets.length ? offsets : DEFAULT_H_OFFSETS, hidden, place };
  } catch { return EMPTY_H; }
}

/** The tab's ONLY storage door. Private → nothing is written. */
function saveH(s: HState, priv: boolean): void {
  if (priv) return;
  try { localStorage.setItem(H_KEY, JSON.stringify(s)); } catch { /* per-browser convenience only */ }
}

/** Remove what an earlier, non-private session left behind. */
function forgetStoredH(): boolean {
  try { const had = localStorage.getItem(H_KEY) != null; localStorage.removeItem(H_KEY); return had; } catch { return false; }
}

const todayYmd = (zone: string): string => inZone(Date.now(), zone).ymd;

const Card = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
  <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
    <header className="px-4 py-2.5 border-b border-slate-800 flex items-baseline justify-between gap-3 flex-wrap">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">{title}</h3>
      {sub && <span className="text-[10px] font-mono text-slate-600">{sub}</span>}
    </header>
    <div className="p-4 space-y-3">{children}</div>
  </section>
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{children}</span>
);

const inputCls = "bg-slate-950/60 border border-slate-700 rounded-md px-2 py-1.5 text-[12px] font-mono text-slate-100 focus:outline-none focus:border-sky-500/60 [color-scheme:dark]";

// ── Julian converter ────────────────────────────────────────────────────────

function JulianCard({ zone, zoneLabel }: { zone: string; zoneLabel: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [date, setDate] = useState("");
  const [jdText, setJdText] = useState("");
  const [year, setYear] = useState<number>(() => new Date().getUTCFullYear());
  useEffect(() => { if (now && !date) setDate(todayYmd(zone)); }, [now, zone, date]);

  const fromDate = date ? ymdToJulian(date) : null;
  const fromJd = jdText ? parseJulianInput(jdText, year) : null;
  const dev = deviceZone();

  return (
    <Card title="Julian date" sub="ordinal day of the year, 001–366 — not the astronomical JDN">
      {now && (
        <div className="flex flex-wrap gap-2">
          {[{ z: "UTC", l: "Zulu today" }, { z: dev, l: "This device today" }, ...(zone !== dev && zone !== "UTC" ? [{ z: zone, l: `${zoneLabel} today` }] : [])].map(({ z, l }) => {
            const j = ymdToJulian(inZone(now, z).ymd);
            return (
              <div key={l} className="flex-1 min-w-[140px] rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{l}</div>
                <div className="text-2xl font-bold tabular-nums text-emerald-300 leading-tight">JD {j?.label}</div>
                <div className="text-[10px] font-mono text-slate-500">{j?.weekday} {j?.ymd} · {j?.yyddd}</div>
              </div>
            );
          })}
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>Date → Julian</Label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-full`} aria-label="Date to convert" />
          <p className="mt-1.5 text-[12px] font-mono">
            {fromDate
              ? <><span className="text-emerald-300 font-bold text-base">JD {fromDate.label}</span> <span className="text-slate-400">· {fromDate.yyddd} · {fromDate.weekday} · week {isoWeek(fromDate.ymd)}{fromDate.leap ? " · leap year" : ""}</span></>
              : <span className="text-slate-600">{date ? "not a real date" : "pick a date"}</span>}
          </p>
        </div>
        <div>
          <Label>Julian → date</Label>
          <div className="flex gap-2">
            <input value={jdText} onChange={(e) => setJdText(e.target.value)} placeholder="300 · 26300 · 2026-300" className={`${inputCls} flex-1 min-w-0`} aria-label="Julian day to convert" />
            <input type="number" value={year} min={1} max={9999} onChange={(e) => setYear(Number(e.target.value) || year)} className={`${inputCls} w-20`} aria-label="Year for a bare Julian day" title="the year a bare 1–3 digit Julian belongs to" />
          </div>
          <p className="mt-1.5 text-[12px] font-mono">
            {fromJd
              ? <><span className="text-emerald-300 font-bold text-base">{fromJd.weekday} {fromJd.ymd}</span> <span className="text-slate-400">· JD {fromJd.label} of {fromJd.year}{fromJd.leap ? " (leap)" : ""}</span></>
              : <span className="text-slate-600">{jdText ? `no such day in ${year}` : "type a Julian — bare (uses the year), YYDDD, or YYYY-DDD"}</span>}
          </p>
        </div>
      </div>
    </Card>
  );
}

// ── H-hour planner ──────────────────────────────────────────────────────────

const TONE_DOT: Record<Tone, string> = { r: "bg-red-500", a: "bg-amber-400", u: "bg-slate-500", i: "bg-sky-400", g: "bg-emerald-500" };
const TONE_TEXT: Record<Tone, string> = { r: "text-red-200", a: "text-amber-100", u: "text-slate-400", i: "text-slate-200", g: "text-slate-300" };
const CAT_CLS: Record<string, string> = { VFR: "text-emerald-300", MVFR: "text-sky-300", IFR: "text-red-300", LIFR: "text-fuchsia-300", UNKNOWN: "text-slate-400" };
const SUN_GLYPH: Record<string, string> = { day: "☀", civil: "◐", nautical: "◑", night: "●" };

/** The tracked places a planner may anchor H at, in the order they matter.
 *  Private → an empty list and no request. */
function usePlaces(priv: boolean): HPlace[] | null {
  const [places, setPlaces] = useState<HPlace[] | null>(null);
  useEffect(() => {
    if (priv) { setPlaces([]); return; }
    let alive = true;
    const load = async () => {
      const out: HPlace[] = [];
      try {
        type Track = { registry?: { airfields?: Array<{ icao: string; label: string; lat: number; lon: number; country: string; own: "hub" | "spoke" | null; roles?: { star?: boolean } }>; places?: Array<{ id: string; label: string; lat: number; lon: number }> } };
        type Prefs = { prefs?: { localCity?: string; localLat?: number; localLon?: number } };
        type Trips = { active?: { id?: string; label: string; lat: number; lon: number } | null };
        const [track, prefs, trips] = await Promise.all([toolsFetch<Track>("/api/track", priv), toolsFetch<Prefs>("/api/user-prefs", priv), toolsFetch<Trips>("/api/trips", priv)]);
        const p = prefs?.prefs ?? {};
        const active = trips?.active;
        if (active && Number.isFinite(active.lat) && Number.isFinite(active.lon)) out.push({ kind: "tdy", id: `tdy:${active.id ?? active.label}`, label: `TDY · ${active.label}`, lat: active.lat, lon: active.lon, icao: null, country: null });
        if (Number.isFinite(p.localLat) && Number.isFinite(p.localLon)) out.push({ kind: "home", id: "home", label: `Home · ${p.localCity?.trim() || "home"}`, lat: p.localLat!, lon: p.localLon!, icao: null, country: null });
        const af = track?.registry?.airfields ?? [];
        const rank = (a: typeof af[number]) => (a.own === "hub" ? 0 : a.own === "spoke" ? 1 : a.roles?.star ? 2 : 3);
        for (const a of [...af].filter((a) => a.icao && (a.lat || a.lon)).sort((x, y) => rank(x) - rank(y) || x.icao.localeCompare(y.icao))) {
          out.push({ kind: "airfield", id: `af:${a.icao}`, label: `${a.icao} · ${a.label}${a.own ? ` (${a.own})` : ""}`, lat: a.lat, lon: a.lon, icao: a.icao, country: a.country || null, own: a.own });
        }
        for (const x of track?.registry?.places ?? []) if (Number.isFinite(x.lat) && Number.isFinite(x.lon)) out.push({ kind: "place", id: `pl:${x.id}`, label: x.label, lat: x.lat, lon: x.lon, icao: null, country: null });
      } catch { /* an empty list is fine — the picker says so */ }
      if (alive) setPlaces(out);
    };
    load();
    window.addEventListener("tracking:changed", load);
    return () => { alive = false; window.removeEventListener("tracking:changed", load); };
  }, [priv]);
  return places;
}

function HHourCard({ cols, effective, priv }: { cols: ZoneCol[]; effective: ZoneCol; priv: boolean }) {
  const [st, setSt] = useState<HState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [inZoneId, setInZoneId] = useState("UTC");
  const [dateIn, setDateIn] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [dtgIn, setDtgIn] = useState("");
  const [offIn, setOffIn] = useState("");
  const [coordIn, setCoordIn] = useState("");
  const [copied, setCopied] = useState(false);
  // When the clipboard is refused (a locked-down browser), the text is shown
  // selected in a box instead — the planner copies it by hand.
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const places = usePlaces(priv);
  const [cons, setCons] = useState<HConsiderations | null>(null);
  const [consState, setConsState] = useState<"idle" | "loading" | "error">("idle");
  const consSeq = useRef(0);

  useEffect(() => {
    // Private: the stored anchor is still READ (no trail in reading) so a
    // planner who flips the switch mid-session keeps their H; nothing new
    // is written from here on.
    const s = loadH();
    setSt(s);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // Keep the form in step with the stored anchor when it loads or changes zone.
  useEffect(() => {
    if (!st?.hMs) return;
    const z = inZone(st.hMs, inZoneId);
    setDateIn(z.ymd); setTimeIn(z.hhmm);
  }, [st?.hMs, inZoneId]);
  // Flipping private ON drops any answer already on screen — a cached read
  // is still a read — and cancels one in flight.
  useEffect(() => { if (priv) { consSeq.current++; setCons(null); setConsState("idle"); } }, [priv]);

  const update = useCallback((patch: Partial<HState>) => {
    setSt((prev) => { const next = { ...(prev ?? EMPTY_H), ...patch }; saveH(next, priv); return next; });
  }, [priv]);

  // The considerations at H for the chosen place — re-read when either
  // moves (debounced: a date input fires per keystroke), bounded by a
  // sequence so a slow earlier answer cannot land over a newer one. Never
  // while private.
  const hMs = st?.hMs ?? null, place = st?.place ?? null;
  useEffect(() => {
    if (priv || !hMs || !place || place.kind === "manual") { if (!priv) { setCons(null); setConsState("idle"); } return; }
    const seq = ++consSeq.current;
    setConsState("loading");
    const t = setTimeout(() => {
      const q = new URLSearchParams({ at: String(hMs), lat: String(place.lat), lon: String(place.lon), label: place.label.replace(/^(TDY|Home) · /, "") });
      if (place.icao) q.set("icao", place.icao);
      if (place.country) q.set("country", place.country);
      toolsFetch<HConsiderations>(`/api/tools/hhour?${q}`, priv)
        .then((j) => { if (seq !== consSeq.current) return; if (j) { setCons(j); setConsState("idle"); } else setConsState("error"); });
    }, 400);
    return () => clearTimeout(t);
  }, [priv, hMs, place?.id, place?.lat, place?.lon, place?.icao, place?.country, place?.kind]);  // eslint-disable-line react-hooks/exhaustive-deps

  const setFromForm = (ymd: string, hhmm: string, zone: string) => {
    const ms = wallToMs(ymd, hhmm, zone);
    if (ms == null) return;
    update({ hMs: ms });
  };
  const setFromDtg = () => {
    const ms = parseDtg(dtgIn);
    if (ms == null) { toast.warn("Not a DTG", "DDHHMMZMONYY, e.g. 271930ZOCT26 — a letter zone or +0330 also reads; J (local) is refused"); return; }
    update({ hMs: ms }); setDtgIn("");
  };
  const addOffset = () => {
    const o = parseOffsetInput(offIn);
    if (o == null) { toast.warn("Not an offset", "H-72 · +36 · 2d · 90m · H-1:30"); return; }
    update({ offsets: [...new Set([...(st?.offsets ?? []), o])].sort((a, b) => a - b) }); setOffIn("");
  };
  const setManualPlace = () => {
    const ll = parseLatLon(coordIn);
    if (!ll) { toast.warn("Not a position", "31.826, 36.782 · 31°49'N 36°47'E · N31 49.5 E036 47.2"); return; }
    update({ place: { kind: "manual", id: `manual:${ll.lat},${ll.lon}`, label: `${ll.lat.toFixed(3)}, ${ll.lon.toFixed(3)}`, lat: ll.lat, lon: ll.lon, icao: null, country: null } });
    setCoordIn("");
  };
  const toggleZone = (zone: string) => {
    const hidden = st?.hidden ?? [];
    update({ hidden: hidden.includes(zone) ? hidden.filter((z) => z !== zone) : [...hidden, zone] });
  };

  const shown = cols.filter((c) => !(st?.hidden ?? []).includes(c.zone));
  const rows = useMemo(() => (st?.hMs ? hHourTable(st.hMs, st.offsets) : []), [st?.hMs, st?.offsets]);
  const hZone = st?.hMs ? inZone(st.hMs, "UTC") : null;
  const countdown = st?.hMs ? hCountdown(st.hMs, now) : null;

  const copy = async () => {
    if (!st?.hMs) return;
    const text = hTableText(st.hMs, st.offsets, shown);
    try { await navigator.clipboard.writeText(text); setCopied(true); setCopyFallback(null); setTimeout(() => setCopied(false), 2000); toast.ok("H-hour table copied"); }
    catch { setCopyFallback(text); toast.warn("Clipboard refused", "the table is shown as text below — select and copy it by hand"); }
  };

  const zoneOptions: ZoneCol[] = [{ zone: "UTC", label: "Zulu" }, ...cols.filter((c) => c.zone !== "UTC")];
  // The place's own clock joins the columns once Open-Meteo names its zone.
  const placeZone = cons?.place.zone && cons.place.zoneSource === "open-meteo" && !shown.some((c) => c.zone === cons.place.zone) && isValidTz(cons.place.zone) ? { zone: cons.place.zone, label: `${place?.icao ?? place?.label.split(" · ")[0] ?? "place"} local` } : null;
  const tableCols = placeZone ? [...shown, placeZone] : shown;

  return (
    <Card title="H-hour" sub={hZone ? `H = ${hZone.dtg} · ${countdown?.text}${priv ? " · private — in memory only" : ""}` : "set an anchor — every offset below follows it"}>
      <div className="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div><Label>H date</Label><input type="date" value={dateIn} onChange={(e) => { setDateIn(e.target.value); if (timeIn) setFromForm(e.target.value, timeIn, inZoneId); }} className={`${inputCls} w-full`} aria-label="H-hour date" /></div>
          <div><Label>H time</Label><input type="time" value={timeIn} onChange={(e) => { setTimeIn(e.target.value); if (dateIn) setFromForm(dateIn, e.target.value, inZoneId); }} className={`${inputCls} w-28`} aria-label="H-hour time" /></div>
          <div>
            <Label>in</Label>
            <select value={inZoneId} onChange={(e) => setInZoneId(e.target.value)} className={`${inputCls} w-full max-w-[140px]`} aria-label="Zone the H-hour is typed in" title="the zone the date and time above are typed in">
              {zoneOptions.map((z) => <option key={z.zone} value={z.zone}>{z.label}</option>)}
            </select>
          </div>
        </div>
        <div className="text-[10px] font-mono text-slate-600 text-center hidden md:block">or</div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div><Label>DTG</Label><input value={dtgIn} onChange={(e) => setDtgIn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setFromDtg(); }} placeholder="271930ZOCT26" className={`${inputCls} w-full`} aria-label="H-hour as a DTG" /></div>
          <button type="button" onClick={setFromDtg} className="px-2.5 py-1.5 rounded-md border border-slate-700 text-[11px] font-bold uppercase tracking-wider text-slate-300 hover:border-sky-500/60 hover:text-sky-300">Set</button>
          <button type="button" onClick={() => update({ hMs: Math.floor(Date.now() / 60_000) * 60_000 })} className="px-2.5 py-1.5 rounded-md border border-slate-700 text-[11px] font-bold uppercase tracking-wider text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300" title="H = now, to the minute">H = now</button>
        </div>
      </div>

      {/* Where: the tracked places — airfields (hub › spokes › ★ › rest), home, TDY, civil points — or, private, typed coordinates. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Where</span>
        {priv ? (
          <>
            <input value={coordIn} onChange={(e) => setCoordIn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setManualPlace(); }} placeholder="31.826, 36.782 · 31°49'N 36°47'E" className={`${inputCls} min-w-[240px]`} aria-label="Coordinates of the place" />
            <button type="button" onClick={setManualPlace} className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300">set</button>
            {place && <span className="text-[10px] font-mono text-sky-200">{place.label}{place.kind !== "manual" ? " (from before)" : ""} <button type="button" onClick={() => update({ place: null })} className="text-slate-600 hover:text-red-400" aria-label="clear the place">✕</button></span>}
            <span className="text-[10px] text-slate-600">private — coordinates by hand; nothing looked up</span>
          </>
        ) : (
          <>
            <select value={st?.place?.id ?? ""} onChange={(e) => update({ place: places?.find((p) => p.id === e.target.value) ?? null })} className={`${inputCls} min-w-[220px] max-w-full`} aria-label="Place the H-hour is read at" disabled={!places}>
              <option value="">{places ? (places.length ? "— no place (times only)" : "— nothing tracked yet") : "loading places…"}</option>
              {places?.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <span className="text-[10px] text-slate-600">a place turns on the light column and the considerations at H · Track a field on the Weather tab or the command board to add one</span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mr-1">Offsets</span>
        {(st?.offsets ?? DEFAULT_H_OFFSETS).map((o) => (
          <span key={o} className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-mono ${o === 0 ? "border-emerald-500/50 text-emerald-300" : "border-slate-700 text-slate-300"}`}>
            {hLabel(o)}
            <button type="button" onClick={() => update({ offsets: (st?.offsets ?? []).filter((x) => x !== o) })} className="text-slate-600 hover:text-red-400" aria-label={`remove ${hLabel(o)}`}>✕</button>
          </span>
        ))}
        <input value={offIn} onChange={(e) => setOffIn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addOffset(); }} placeholder="＋ H-36 · 2d · 90m" className={`${inputCls} w-36 py-0.5 text-[11px]`} aria-label="Add an offset" />
        <button type="button" onClick={addOffset} className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300">add</button>
        <button type="button" onClick={() => update({ offsets: DEFAULT_H_OFFSETS })} className="text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:text-slate-300 ml-auto">reset offsets</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mr-1">Clocks</span>
        {cols.map((c) => {
          const on = !(st?.hidden ?? []).includes(c.zone);
          return (
            <button key={c.zone} type="button" onClick={() => toggleZone(c.zone)} aria-pressed={on}
              className={`rounded border px-1.5 py-px text-[10px] font-mono ${on ? "border-sky-500/50 text-sky-200 bg-sky-500/10" : "border-slate-800 text-slate-600"}`}
              title={`${c.zone} · ${formatUtcOffset(inZone(now, c.zone).offsetMin)}`}>
              {c.label}{c.zone === effective.zone && c.zone !== "UTC" ? " ◦" : ""}
            </button>
          );
        })}
        <span className="text-[10px] text-slate-600 ml-1">from the Glance clock row — edit them there · ◦ = your effective zone{placeZone ? " · the place's own clock is added once known" : ""}</span>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="min-w-full text-[11px] font-mono tabular-nums">
            <thead>
              <tr className="text-[9px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="text-left py-1 pr-3">Offset</th>
                <th className="text-left py-1 pr-3">Zulu DTG</th>
                {tableCols.map((c) => <th key={c.zone} className="text-left py-1 pr-3 whitespace-nowrap">{c.label} <span className="font-normal normal-case tracking-normal text-slate-600">{formatUtcOffset(inZone(st!.hMs!, c.zone).offsetMin)}</span></th>)}
                {place && <th className="text-left py-1 pr-3 whitespace-nowrap">Light at {place.icao ?? "place"}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const past = r.ms < now;
                const isH = r.offsetH === 0;
                const light = place ? lightAt(r.ms, place.lat, place.lon) : null;
                return (
                  <tr key={r.offsetH} className={`border-b border-slate-800/60 ${isH ? "bg-emerald-500/[0.07]" : ""} ${past && !isH ? "text-slate-500" : "text-slate-200"}`}>
                    <td className={`py-1 pr-3 font-bold ${isH ? "text-emerald-300" : ""}`}>{r.label}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{r.dtg}</td>
                    {tableCols.map((c) => {
                      const t = inZone(r.ms, c.zone);
                      // Amber when that clock's calendar day is not the DTG's
                      // Zulu day — the roll a planner misreads.
                      const zDay = r.dtg.slice(0, 2);
                      return (
                        <td key={c.zone} className="py-1 pr-3 whitespace-nowrap">
                          <span className={t.ymd.slice(8, 10) !== zDay ? "text-amber-200/80" : "text-slate-500"}>{t.weekday} {t.dayShort}</span> <span className="font-bold">{t.hhmm}</span>{t.letter && t.letter !== "Z" ? <span className="text-slate-500">{t.letter}</span> : null}
                        </td>
                      );
                    })}
                    {light && (
                      <td className="py-1 pr-3 whitespace-nowrap" title={`sun ${light.sunAltDeg}° · moon ${light.moonAltDeg}° · ${light.illumPct}% ${light.phaseName}`}>
                        <span className={light.sun === "day" ? "text-amber-200" : light.sun === "night" ? "text-indigo-300" : "text-slate-300"}>{SUN_GLYPH[light.sun]} {SUN_STATE_LABEL[light.sun]}</span>
                        {light.sun !== "day" && <span className={`ml-1.5 ${light.moonUp ? (light.moonUseful ? "text-amber-100" : "text-slate-300") : "text-slate-600"}`}>{light.moonUp ? `☾ ${light.illumPct}% ${light.moonAltDeg}°` : "☾ down"}</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 pt-2 text-[10px] text-slate-600">
            <span>amber date = that clock is on a different calendar day from the Zulu DTG · dimmed = already past · letter = that zone's military designator (none for a half-hour zone){place ? " · light: ☀ day ◐ civil ◑ nautical ● night · ☾ illumination and altitude when up (planning-grade, no cloud)" : ""}</span>
            <button type="button" onClick={copy} className="ml-auto text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300">{copied ? "✓ copied" : "⧉ copy table"}</button>
            <button type="button" onClick={() => update({ hMs: null })} className="text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:text-red-400">clear H</button>
          </div>
          {copyFallback && (
            <textarea readOnly value={copyFallback} rows={Math.min(20, copyFallback.split("\n").length + 1)} onFocus={(e) => e.currentTarget.select()} autoFocus
              className="mt-2 w-full bg-slate-950/60 border border-amber-500/40 rounded-md p-2 text-[10px] font-mono text-slate-200 whitespace-pre overflow-x-auto" aria-label="H-hour table as text" />
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 font-mono">No H-hour set. Type a date and time in a zone, paste a DTG, or press H = now. {priv ? "Private: kept in memory only — a reload clears it." : "Remembered in this browser only."}</p>
      )}

      {hMs && place && (priv || place.kind === "manual"
        ? <PrivateAtH place={place} hMs={hMs} priv={priv} />
        : <ConsiderationsPanel cons={cons} state={consState} place={place} hMs={hMs} />)}
    </Card>
  );
}

// ── At H, computed here: the light and the moon only ────────────────────────

function PrivateAtH({ place, hMs, priv }: { place: HPlace; hMs: number; priv: boolean }) {
  // The night window is placed by a fixed offset from longitude (no zone
  // lookup) and every time prints in Zulu — the airfield-card rule.
  const zone = zoneForLongitude(place.lon);
  const light = lightAt(hMs, place.lat, place.lon);
  const night = lunarNight(place.lat, place.lon, zone, nightDateFor(hMs, zone));
  const rel = nearestLightEvent(night, hMs);
  return (
    <div className="mt-2 pt-3 border-t border-slate-800">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">At H — {place.label}</h4>
        <span className="text-[10px] font-mono text-slate-600">{priv ? "private — computed here, nothing asked" : "typed coordinates — computed here, nothing asked"}</span>
      </div>
      <ul className="space-y-1 text-[11px] leading-snug text-slate-200">
        <li className="flex items-start gap-2"><span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${TONE_DOT.i}`} aria-hidden /><span>H in {SUN_STATE_LABEL[light.sun]}{rel ? ` — ${rel}` : ""}{light.sun === "day" ? ` (sun ${light.sunAltDeg}°)` : ""}</span></li>
        {light.sun !== "day" && <li className="flex items-start gap-2"><span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${TONE_DOT.i}`} aria-hidden /><span>{light.moonUp ? `Moon UP at H — ${light.illumPct}% ${light.phaseName}, ${light.moonAltDeg}° above the horizon${light.moonUseful ? " (useful light)" : " (low — little useful light)"}` : `Moon DOWN at H — ${light.illumPct}% ${light.phaseName}, no moonlight`}</span></li>}
        <li className="flex items-start gap-2"><span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${TONE_DOT.i}`} aria-hidden /><span>{night.polar ? "No nautical darkness on the night of H (polar)" : `The night of ${night.date}: ${lunarTonightLine(night, hhmmZ)}`}</span></li>
        <li className="flex items-start gap-2 text-slate-400"><span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${TONE_DOT.u}`} aria-hidden /><span>Weather, TAF, NOTAMs, posture, holidays and space weather: NOT READ — {priv ? "private mode asks nothing" : "a typed position has no feeds attached"}. UNKNOWN by choice, never clear.</span></li>
      </ul>
      <p className="mt-1.5 text-[9px] text-slate-600">EENT {hhmmZ(night.eent)} · BMNT {hhmmZ(night.bmnt)} · moon ≥{MOON_USEFUL_ALT_DEG}° counts as useful · night window placed by longitude · planning-grade · cloud not included</p>
    </div>
  );
}

// ── At H: the considerations panel ──────────────────────────────────────────

function ConsiderationsPanel({ cons, state, place, hMs }: { cons: HConsiderations | null; state: "idle" | "loading" | "error"; place: HPlace; hMs: number }) {
  // The read belongs to an H AND a place: switching the place keeps the old
  // read off screen until the new one lands (code review 2026-10-28).
  const samePlace = !!cons && Math.abs(cons.place.lat - place.lat) < 1e-4 && Math.abs(cons.place.lon - place.lon) < 1e-4 && (cons.place.icao ?? null) === (place.icao ?? null);
  const stale = !!cons && (cons.hMs !== hMs || !samePlace);
  const hLocal = cons ? inZone(hMs, cons.place.zone) : null;
  const zLabel = (ms: number | null) => (ms == null ? "—" : `${hhmmZ(ms)}${cons ? ` (${inZone(ms, cons.place.zone).hhmm} local)` : ""}`);
  return (
    <div className="mt-2 pt-3 border-t border-slate-800">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">At H — {place.label.replace(/^(TDY|Home) · /, "")}</h4>
        <span className="text-[10px] font-mono text-slate-600">
          {state === "loading" && "reading…"}{state === "error" && <span className="text-amber-300">the read failed — UNKNOWN, not clear</span>}
          {state === "idle" && cons && !stale && `${hLocal?.weekday} ${hLocal?.dayShort} ${hLocal?.hhmm} local (${cons.place.zone}${cons.place.zoneSource === "longitude" ? ", by longitude" : ""}) · as of ${inZone(Date.parse(cons.asOf), "UTC").hhmm}Z`}
        </span>
      </div>
      {!cons || stale ? (
        state === "loading" || stale ? <div className="space-y-1 animate-pulse">{[0, 1, 2].map((i) => <div key={i} className="h-3 rounded bg-slate-800/70" style={{ width: `${70 - i * 15}%` }} />)}</div> : null
      ) : (
        <div className="space-y-3">
          <ul className="space-y-1">
            {cons.summary.map((c, i) => (
              <li key={i} className={`flex items-start gap-2 text-[11px] leading-snug ${TONE_TEXT[c.tone]}`}>
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${TONE_DOT[c.tone]}`} aria-hidden />
                <span className="min-w-0">{c.text} <span className="text-[9px] font-mono uppercase text-slate-600">{c.source}</span></span>
              </li>
            ))}
          </ul>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2 text-[10.5px] font-mono">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 space-y-0.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Light · the night of {cons.night?.date ?? "—"}</div>
              {cons.light && <div className="text-slate-200">{SUN_GLYPH[cons.light.sun]} {SUN_STATE_LABEL[cons.light.sun]} at H · sun {cons.light.sunAltDeg}°</div>}
              {cons.light && <div className={cons.light.moonUp ? "text-amber-100" : "text-slate-400"}>☾ {cons.light.illumPct}% {cons.light.phaseName} · {cons.light.moonUp ? `up, ${cons.light.moonAltDeg}°${cons.light.moonUseful ? " (useful)" : " (low)"}` : "down"}</div>}
              {cons.night && !cons.night.polar && (
                <>
                  <div className="text-slate-400">EENT {zLabel(cons.night.eent)}</div>
                  <div className="text-slate-400">BMNT {zLabel(cons.night.bmnt)}</div>
                  <div className="text-slate-400">dark {cons.night.darkH ?? "—"} h · moonlit {cons.night.moonlitDarkH ?? "—"} h · moon-free {cons.night.moonFreeDarkH ?? "—"} h</div>
                </>
              )}
              {cons.night?.polar && <div className="text-slate-400">no nautical darkness (polar)</div>}
              <div className="text-[9px] text-slate-600">planning-grade · cloud not included</div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 space-y-0.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Weather at H · Open-Meteo</div>
              {!cons.forecast.live ? <div className="text-slate-400">UNKNOWN — feed unreachable</div>
                : cons.forecast.hour ? <div className="text-slate-200">{forecastLine(cons.forecast.hour)}</div>
                : <div className="text-slate-400">no forecast hour covers H{(hMs - Date.parse(cons.asOf)) > cons.forecast.horizonDays * 86_400_000 ? ` (beyond ${cons.forecast.horizonDays} d)` : ""}</div>}
              {cons.forecast.day && <div className="text-slate-400">day: {cons.forecast.day.highF ?? "—"}° / {cons.forecast.day.lowF ?? "—"}°F · precip {cons.forecast.day.precipPct ?? "—"}%</div>}
              {cons.hazard && <div className={cons.hazard.severity === "severe" ? "text-red-300" : "text-amber-200"}>hazard (30-h model): {cons.hazard.flags.join(" · ")}</div>}
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 space-y-0.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{cons.airfield ? `${cons.airfield.icao} · AWC / DAIP` : "Airfield"}</div>
              {!cons.airfield ? <div className="text-slate-500">not an airfield — pick an ICAO for TAF and NOTAMs</div> : (
                <>
                  <div className="text-slate-400">METAR now: <span className={CAT_CLS[cons.airfield.metarCat ?? "UNKNOWN"]}>{cons.airfield.metarLive ? cons.airfield.metarCat ?? "UNKNOWN" : "UNKNOWN (AWC down)"}</span></div>
                  <div className="text-slate-400">TAF at H: {!cons.airfield.tafLive ? <span className="text-slate-500">UNKNOWN (AWC down)</span> : cons.airfield.taf ? <><span className={CAT_CLS[cons.airfield.taf.cat]}>{cons.airfield.taf.cat}</span> <span className="text-slate-300">{cons.airfield.taf.summary}</span>{cons.airfield.taf.tempo && <span className="text-amber-200"> · {cons.airfield.taf.tempo.changeType} {cons.airfield.taf.tempo.cat}</span>}</> : <span className="text-slate-500">not covered{cons.airfield.tafValidToMs ? ` — TAF ends ${hhmmZ(cons.airfield.tafValidToMs)}` : ""}</span>}</div>
                  <div className="text-slate-400">NOTAMs: {!cons.airfield.notamsConfigured ? <span className="text-slate-500">not configured</span> : !cons.airfield.notamsLive ? <span className="text-slate-500">UNKNOWN (DAIP down)</span> : cons.airfield.fieldClosed ? <span className="text-red-300">field CLOSED at H</span> : cons.airfield.windows.length ? <span className="text-amber-200">{cons.airfield.windows.map((w) => `${w.label} ${w.indeterminate ? "(sched?)" : w.kind}`).join(" · ")}</span> : <span className="text-emerald-300">no window at H</span>}</div>
                </>
              )}
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 space-y-0.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Host nation · space</div>
              <div className="text-slate-400">posture: {!cons.postureKnown ? <span className="text-slate-500">UNKNOWN (watch list unreadable)</span> : cons.posture ? <span className={cons.posture.composite === "red" ? "text-red-300" : cons.posture.composite === "amber" ? "text-amber-200" : cons.posture.composite === "green" ? "text-emerald-300" : "text-slate-400"}>{cons.posture.composite.toUpperCase()} · {cons.posture.country}</span> : <span className="text-slate-500">not in the posture watch</span>}</div>
              <div className="text-slate-400">holidays: {!cons.holidaysKnown ? <span className="text-slate-500">UNKNOWN</span> : cons.holidays.length ? cons.holidays.map((h) => `${h.date} ${h.label}`).join(" · ") : "none on H day ±1"}</div>
              <div className="text-slate-400">space wx: {!cons.scalesLive ? <span className="text-slate-500">UNKNOWN</span> : cons.scaleDay ? `G${cons.scaleDay.G ?? "—"} R${cons.scaleDay.R ?? "—"} S${cons.scaleDay.S ?? "—"}${cons.scaleDay.probs ? ` · R-major ${cons.scaleDay.probs.rMajor ?? 0}%` : ""}` : "beyond the 3-day outlook"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Day arithmetic ──────────────────────────────────────────────────────────

function DaysCard({ zone }: { zone: string }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [base, setBase] = useState("");
  const [n, setN] = useState("");
  useEffect(() => { const t = todayYmd(zone); setA((v) => v || t); setBase((v) => v || t); }, [zone]);
  const diff = a && b ? daysBetween(a, b) : null;
  const ja = a ? ymdToJulian(a) : null, jb = b ? ymdToJulian(b) : null;
  const plus = base && n.trim() && parseYmd(base) && /^[+-]?\d+$/.test(n.trim()) ? ymdToJulian(new Date(Date.UTC(parseYmd(base)!.y, parseYmd(base)!.m - 1, parseYmd(base)!.d + Number(n))).toISOString().slice(0, 10)) : null;
  return (
    <Card title="Days" sub="calendar days — whole dates, no clock">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>Between two dates</Label>
          <div className="flex gap-2 items-center">
            <input type="date" value={a} onChange={(e) => setA(e.target.value)} className={`${inputCls} flex-1 min-w-0`} aria-label="From date" />
            <span className="text-slate-600 text-xs">→</span>
            <input type="date" value={b} onChange={(e) => setB(e.target.value)} className={`${inputCls} flex-1 min-w-0`} aria-label="To date" />
          </div>
          <p className="mt-1.5 text-[12px] font-mono">
            {diff != null
              ? <><span className="text-emerald-300 font-bold text-base">{Math.abs(diff)} day{Math.abs(diff) === 1 ? "" : "s"}</span> <span className="text-slate-400">{diff < 0 ? "earlier" : "later"} · JD {ja?.label} → JD {jb?.label} · {ja?.weekday} → {jb?.weekday}</span></>
              : <span className="text-slate-600">pick both dates</span>}
          </p>
        </div>
        <div>
          <Label>A date plus N days</Label>
          <div className="flex gap-2 items-center">
            <input type="date" value={base} onChange={(e) => setBase(e.target.value)} className={`${inputCls} flex-1 min-w-0`} aria-label="Base date" />
            <span className="text-slate-600 text-xs">+</span>
            <input value={n} onChange={(e) => setN(e.target.value)} placeholder="days" className={`${inputCls} w-20`} aria-label="Days to add" />
          </div>
          <p className="mt-1.5 text-[12px] font-mono">
            {plus
              ? <><span className="text-emerald-300 font-bold text-base">{plus.weekday} {plus.ymd}</span> <span className="text-slate-400">· JD {plus.label}</span></>
              : <span className="text-slate-600">a negative count goes back</span>}
          </p>
        </div>
      </div>
    </Card>
  );
}

// ── The tab ─────────────────────────────────────────────────────────────────

interface ZoneInfo { zone: string; label: string; source: string }

function ToolsBody({ eff, priv, onPrivate }: { eff: ZoneInfo; priv: boolean; onPrivate: (on: boolean) => void }) {
  const [clocks, setClocks] = useState<ClockDef[] | null>(null);
  const [forgot, setForgot] = useState<string | null>(null);
  useEffect(() => {
    setClocks(loadClocks());
    const onStorage = (e: StorageEvent) => { if (e.key === CLOCKS_KEY) setClocks(loadClocks()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Zulu, the device, the effective zone (when it differs), then the Glance
  // clocks — deduplicated by zone, labels from the clock row where it has one.
  const cols = useMemo<ZoneCol[]>(() => {
    const dev = deviceZone();
    const list: ZoneCol[] = [{ zone: "UTC", label: "Zulu" }];
    const seen = new Set(["UTC"]);
    const push = (zone: string, label: string) => { if (!isValidTz(zone) || seen.has(zone)) return; seen.add(zone); list.push({ zone, label }); };
    const byZone = new Map((clocks ?? []).map((c) => [c.tz, c.label] as const));
    push(dev, byZone.get(dev) ?? "This device");
    push(eff.zone, byZone.get(eff.zone) ?? eff.label);
    for (const c of clocks ?? []) push(c.tz, c.label);
    return list;
  }, [clocks, eff.zone, eff.label]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-sky-500/10 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
            <Wrench size={15} strokeWidth={2.25} className="text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">Tools</h2>
            <p className="text-[10px] text-slate-600 font-mono">planner date-time tools · the arithmetic is in this browser · zone {eff.label} ({eff.source})</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {priv && <button type="button" onClick={() => { setForgot(forgetStoredH() ? "stored H-hour forgotten" : "nothing was stored"); }} className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-red-300" title="remove the H-hour and place an earlier, non-private session saved in this browser">{forgot ?? "forget stored H-hour"}</button>}
          <button type="button" onClick={() => onPrivate(!priv)} aria-pressed={priv}
            className={`px-2.5 py-1.5 rounded-md border text-[11px] font-bold uppercase tracking-wider ${priv ? "border-violet-400/60 text-violet-200 bg-violet-500/10" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
            title={PRIVATE_BLOCKS.join(" · ")}>
            {priv ? "🔒 Private — on" : "Private"}
          </button>
        </div>
      </div>
      {priv && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/[0.06] px-3 py-2 text-[10.5px] text-violet-100/90">
          <span className="font-bold uppercase tracking-wider text-[9px] text-violet-300 mr-2">Private mode</span>
          {PRIVATE_BLOCKS.join(" · ")}. <span className="text-violet-200/70">Scope: this tab only — the rest of the dashboard keeps its own polling. The switch lives in this tab's session and ends when it closes.</span>
        </div>
      )}
      <JulianCard zone={eff.zone} zoneLabel={eff.label} />
      {clocks && <HHourCard cols={cols} effective={{ zone: eff.zone, label: eff.label }} priv={priv} />}
      <DaysCard zone={eff.zone} />
    </div>
  );
}

/** Not private: the effective-zone hook (one /api/zone read, cached 10 min). */
function LiveTools({ priv, onPrivate }: { priv: boolean; onPrivate: (on: boolean) => void }) {
  const eff = useEffectiveZone();
  return <ToolsBody eff={{ zone: eff.zone, label: eff.label, source: eff.source }} priv={priv} onPrivate={onPrivate} />;
}

/** Private: the device's own zone, no hook, no request. */
function PrivateTools({ priv, onPrivate }: { priv: boolean; onPrivate: (on: boolean) => void }) {
  const dev = deviceZone();
  return <ToolsBody eff={{ zone: dev, label: dev, source: "device · private" }} priv={priv} onPrivate={onPrivate} />;
}

export default function ToolsTab() {
  // Read after mount (sessionStorage is the browser's) so the server render
  // and the first client render agree; until then nothing fetches.
  const [priv, setPriv] = useState<boolean | null>(null);
  useEffect(() => { setPriv(readPrivate()); }, []);
  const onPrivate = (on: boolean) => { writePrivate(on); setPriv(on); toast.info(on ? "Tools: private mode on" : "Tools: private mode off", on ? "no requests, nothing written, from this tab" : "places and the At-H read are back"); };
  if (priv == null) return <div className="px-4 py-6 text-[11px] font-mono uppercase tracking-wider text-slate-500">Tools…</div>;
  return priv ? <PrivateTools priv={priv} onPrivate={onPrivate} /> : <LiveTools priv={priv} onPrivate={onPrivate} />;
}
