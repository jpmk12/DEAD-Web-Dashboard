"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wrench } from "@/lib/icons";
import { useEffectiveZone, deviceZone } from "@/lib/zoneClient";
import { DEFAULT_CLOCKS, isValidTz, formatUtcOffset, type ClockDef } from "@/lib/worldClocks";
import { toast } from "@/lib/feedback";
import {
  ymdToJulian, parseJulianInput, daysBetween, isoWeek, parseYmd,
  wallToMs, inZone, dtgZulu, parseDtg, DEFAULT_H_OFFSETS, hLabel, parseOffsetInput, hHourTable, hTableText, hCountdown,
} from "@/lib/plannerTools";

// The Tools tab — planner date-time arithmetic, ALL of it in the browser
// (lib/plannerTools, PURE, tested): no route, no model, nothing stored but
// this browser's own H-hour (localStorage). Three cards: the Julian
// converter (date ↔ ordinal day), the H-hour planner (one anchor, every
// offset in every clock the operator keeps, as DTGs), and day arithmetic.
// The zones offered are the ones the Glance clock row already shows plus
// Zulu, this device and the effective zone — one list, no second editor.

const H_KEY = "tools.hhour";
const CLOCKS_KEY = "glance.clocks";

interface ZoneCol { zone: string; label: string }
interface HState { hMs: number | null; offsets: number[]; hidden: string[] }

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

function loadH(): HState {
  try {
    const raw = localStorage.getItem(H_KEY);
    if (!raw) return { hMs: null, offsets: DEFAULT_H_OFFSETS, hidden: [] };
    const j = JSON.parse(raw);
    const hMs = typeof j.hMs === "number" && Number.isFinite(j.hMs) ? j.hMs : null;
    const offsets = Array.isArray(j.offsets) ? j.offsets.filter((o: unknown): o is number => typeof o === "number" && Number.isFinite(o)) : DEFAULT_H_OFFSETS;
    const hidden = Array.isArray(j.hidden) ? j.hidden.filter((z: unknown): z is string => typeof z === "string") : [];
    return { hMs, offsets: offsets.length ? offsets : DEFAULT_H_OFFSETS, hidden };
  } catch { return { hMs: null, offsets: DEFAULT_H_OFFSETS, hidden: [] }; }
}

function saveH(s: HState): void {
  try { localStorage.setItem(H_KEY, JSON.stringify(s)); } catch { /* per-browser convenience only */ }
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

function HHourCard({ cols, effective }: { cols: ZoneCol[]; effective: ZoneCol }) {
  const [st, setSt] = useState<HState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [inZoneId, setInZoneId] = useState("UTC");
  const [dateIn, setDateIn] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [dtgIn, setDtgIn] = useState("");
  const [offIn, setOffIn] = useState("");
  const [copied, setCopied] = useState(false);
  // When the clipboard is refused (a locked-down browser), the text is shown
  // selected in a box instead — the planner copies it by hand.
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  useEffect(() => {
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

  const update = useCallback((patch: Partial<HState>) => {
    setSt((prev) => { const next = { ...(prev ?? { hMs: null, offsets: DEFAULT_H_OFFSETS, hidden: [] }), ...patch }; saveH(next); return next; });
  }, []);

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

  return (
    <Card title="H-hour" sub={hZone ? `H = ${hZone.dtg} · ${countdown?.text}` : "set an anchor — every offset below follows it"}>
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
        <span className="text-[10px] text-slate-600 ml-1">from the Glance clock row — edit them there · ◦ = your effective zone</span>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="min-w-full text-[11px] font-mono tabular-nums">
            <thead>
              <tr className="text-[9px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="text-left py-1 pr-3">Offset</th>
                <th className="text-left py-1 pr-3">Zulu DTG</th>
                {shown.map((c) => <th key={c.zone} className="text-left py-1 pr-3 whitespace-nowrap">{c.label} <span className="font-normal normal-case tracking-normal text-slate-600">{formatUtcOffset(inZone(st!.hMs!, c.zone).offsetMin)}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const past = r.ms < now;
                const isH = r.offsetH === 0;
                return (
                  <tr key={r.offsetH} className={`border-b border-slate-800/60 ${isH ? "bg-emerald-500/[0.07]" : ""} ${past && !isH ? "text-slate-500" : "text-slate-200"}`}>
                    <td className={`py-1 pr-3 font-bold ${isH ? "text-emerald-300" : ""}`}>{r.label}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{r.dtg}</td>
                    {shown.map((c) => {
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
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 pt-2 text-[10px] text-slate-600">
            <span>amber date = that clock is on a different calendar day from the Zulu DTG · dimmed = already past · letter = that zone's military designator (none for a half-hour zone)</span>
            <button type="button" onClick={copy} className="ml-auto text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300">{copied ? "✓ copied" : "⧉ copy table"}</button>
            <button type="button" onClick={() => update({ hMs: null })} className="text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:text-red-400">clear H</button>
          </div>
          {copyFallback && (
            <textarea readOnly value={copyFallback} rows={Math.min(20, copyFallback.split("\n").length + 1)} onFocus={(e) => e.currentTarget.select()} autoFocus
              className="mt-2 w-full bg-slate-950/60 border border-amber-500/40 rounded-md p-2 text-[10px] font-mono text-slate-200 whitespace-pre overflow-x-auto" aria-label="H-hour table as text" />
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 font-mono">No H-hour set. Type a date and time in a zone, paste a DTG, or press H = now. Remembered in this browser only.</p>
      )}
    </Card>
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

export default function ToolsTab() {
  const eff = useEffectiveZone();
  const [clocks, setClocks] = useState<ClockDef[] | null>(null);
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
            <p className="text-[10px] text-slate-600 font-mono">planner date-time tools · all arithmetic in this browser · effective zone {eff.label} ({eff.source})</p>
          </div>
        </div>
      </div>
      <JulianCard zone={eff.zone} zoneLabel={eff.label} />
      {clocks && <HHourCard cols={cols} effective={{ zone: eff.zone, label: eff.label }} />}
      <DaysCard zone={eff.zone} />
    </div>
  );
}
