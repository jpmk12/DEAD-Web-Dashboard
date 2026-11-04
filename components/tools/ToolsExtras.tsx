"use client";

import { useEffect, useMemo, useState } from "react";
import { wallToMs, inZone, parseDtg, resolveWall } from "@/lib/plannerTools";
import { formatUtcOffset } from "@/lib/worldClocks";
import { allZones, changeTable, changeWindowLine, cityOf, dstInfo, dstWord, nextZoneChange, offsetGapPeriods, resolveZoneInput, zoneAbbrev, zoneChangeLine, CHANGE_RANGE_MAX_DAYS } from "@/lib/zoneConvert";
import {
  parseDuration, durationLabel, eteFromDistance, enRoute,
  UNIT_FAMILIES, unitsOf, convertUnit, fmtUnit, DEFAULT_FUEL_LB_PER_GAL, type UnitFamily,
} from "@/lib/plannerExtras";
import { Card, Label, inputCls, type ZoneCol } from "./toolsUi";

// Three Tools cards, all arithmetic in the browser — no request, nothing
// stored (tests/toolsPrivacy.test.ts scans this file and fails on a fetch or
// a storage write). They work the same in private mode.

// ── Time zones ─────────────────────────────────────────────────────────────

/** Zulu ↔ any zone, both ways, DST-aware. A row's ↺ makes that zone the
 *  source with its wall time filled in — convert back from there. Added zones
 *  live in this card's state only (nothing stored). */
export function TimeZoneCard({ cols }: { cols: ZoneCol[] }) {
  const zones = useMemo(() => allZones(), []);
  const [fromZone, setFromZone] = useState("UTC");
  const [dateIn, setDateIn] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [dtgIn, setDtgIn] = useState("");
  const [second, setSecond] = useState(false);
  const [extra, setExtra] = useState<ZoneCol[]>([]);
  const [addIn, setAddIn] = useState("");
  const [addNote, setAddNote] = useState<string | null>(null);

  const setNow = (zone = fromZone) => { const z = inZone(Date.now(), zone); setDateIn(z.ymd); setTimeIn(z.hhmm); setDtgIn(""); setSecond(false); };
  // Start on "now" in Zulu; client-only (no hydration of a clock).
  useEffect(() => { setNow("UTC"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const targets = useMemo<ZoneCol[]>(() => {
    const seen = new Set<string>(); const out: ZoneCol[] = [];
    for (const c of [...cols, ...extra]) if (!seen.has(c.zone)) { seen.add(c.zone); out.push(c); }
    return out;
  }, [cols, extra]);
  const sources = useMemo<ZoneCol[]>(() => (targets.some((t) => t.zone === fromZone) ? targets : [...targets, { zone: fromZone, label: cityOf(fromZone) }]), [targets, fromZone]);

  const wall = !dtgIn.trim() && dateIn && timeIn ? resolveWall(dateIn, timeIn, fromZone) : null;
  const ms = dtgIn.trim() ? parseDtg(dtgIn) : wall ? (wall.kind === "doubled" && second && wall.laterMs != null ? wall.laterMs : wall.ms) : null;
  const srcLabel = sources.find((s) => s.zone === fromZone)?.label ?? cityOf(fromZone);

  const add = () => {
    const r = resolveZoneInput(addIn, zones);
    if (!r) { setAddNote(`“${addIn.trim()}” is not a zone this browser knows — try a city (“Tehran”), an IANA id (“Asia/Tehran”) or a letter (“C”).`); return; }
    const shown = targets.find((c) => c.zone === r.zone);
    if (!shown) setExtra((x) => [...x, { zone: r.zone, label: r.label }]);
    setAddNote([r.note, shown ? `${r.zone} is already in the table as ${shown.label}.` : null].filter(Boolean).join(" ") || null);
    setAddIn("");
  };
  const fromHere = (zone: string) => {
    if (ms == null) { setFromZone(zone); return; }
    const z = inZone(ms, zone);
    setFromZone(zone); setDateIn(z.ymd); setTimeIn(z.hhmm); setDtgIn(""); setSecond(false);
  };

  const srcDst = ms != null ? dstInfo(ms, fromZone) : null;
  const zulu = ms != null ? inZone(ms, "UTC") : null;

  return (
    <Card title="Time zones" sub="Zulu ↔ any zone · both ways · DST from this browser's zone database">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label>date</Label><input type="date" value={dateIn} onChange={(e) => { setDateIn(e.target.value); setDtgIn(""); setSecond(false); }} className={inputCls} aria-label="Date to convert" /></div>
        <div><Label>time</Label><input type="time" value={timeIn} onChange={(e) => { setTimeIn(e.target.value); setDtgIn(""); setSecond(false); }} className={`${inputCls} w-28`} aria-label="Time to convert" /></div>
        <div>
          <Label>in</Label>
          <select value={fromZone} onChange={(e) => { setFromZone(e.target.value); setSecond(false); }} className={`${inputCls} max-w-[170px]`} aria-label="Zone the time is in">
            {sources.map((z) => <option key={z.zone} value={z.zone}>{z.label}</option>)}
          </select>
        </div>
        <div><Label>or DTG</Label><input value={dtgIn} onChange={(e) => setDtgIn(e.target.value)} placeholder="271930ZOCT26" className={`${inputCls} w-36`} aria-label="Time as a DTG" /></div>
        <button type="button" onClick={() => setNow()} className="px-2 py-1.5 rounded-md border border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300">now</button>
      </div>

      {srcDst && !dtgIn.trim() && (
        <p className="text-[10.5px] font-mono text-slate-500">
          {srcLabel}: {formatUtcOffset(srcDst.offset)}{zoneAbbrev(ms!, fromZone) ? ` ${zoneAbbrev(ms!, fromZone)}` : ""} · {dstWord(srcDst)}
          {srcDst.observes && <> · standard {formatUtcOffset(srcDst.stdOffset)}, summer {formatUtcOffset(srcDst.dstOffset!)}</>}
        </p>
      )}
      {dtgIn.trim() && ms == null && <p className="text-[11px] font-mono text-amber-300">not a DTG — e.g. 271930ZOCT26 · 272130BOCT26 · 272300+0330OCT26 (J, local, is refused)</p>}
      {wall?.kind === "gap" && (
        <p className="text-[11px] text-amber-200/90 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5">
          {timeIn} does not exist in {srcLabel} on {dateIn} — the clock jumps {formatUtcOffset(wall.before)} → {formatUtcOffset(wall.after)} ({wall.shiftMin > 0 ? "+" : ""}{wall.shiftMin} min). Read as {inZone(wall.ms, fromZone).hhmm} local, the instant after the gap.
        </p>
      )}
      {wall?.kind === "doubled" && wall.laterMs != null && (
        <div className="text-[11px] text-amber-200/90 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 flex flex-wrap items-center gap-2">
          <span>{timeIn} happens twice in {srcLabel} on {dateIn} — clocks fall back {formatUtcOffset(wall.before)} → {formatUtcOffset(wall.after)}. Showing the {second ? "second" : "first"}:</span>
          <span className="flex rounded-md border border-amber-500/40 overflow-hidden" role="group" aria-label="Which occurrence">
            {([false, true] as const).map((s) => (
              <button key={String(s)} type="button" onClick={() => setSecond(s)} aria-pressed={second === s}
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${second === s ? "bg-amber-500/20 text-amber-100" : "text-amber-300/70 hover:text-amber-100"}`}>
                {s ? `2nd · ${inZone(wall.laterMs!, "UTC").hhmm}Z` : `1st · ${inZone(wall.ms, "UTC").hhmm}Z`}
              </button>
            ))}
          </span>
        </div>
      )}

      {ms != null && zulu ? (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="min-w-full text-[11px] font-mono tabular-nums">
            <thead>
              <tr className="text-[9px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="text-left py-1 pr-3">Zone</th>
                <th className="text-left py-1 pr-3">Date</th>
                <th className="text-left py-1 pr-3">Time</th>
                <th className="text-left py-1 pr-3">Offset</th>
                <th className="text-left py-1 pr-3">DST</th>
                <th className="text-left py-1 pr-3">Next clock change</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {targets.map((c) => {
                const t = inZone(ms, c.zone);
                const d = dstInfo(ms, c.zone);
                const ab = zoneAbbrev(ms, c.zone);
                const nx = d?.observes ? nextZoneChange(ms, c.zone) : null;
                const src = c.zone === fromZone && !dtgIn.trim();
                return (
                  <tr key={c.zone} className={`border-b border-slate-800/60 ${src ? "text-sky-200" : "text-slate-200"}`}>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <span className="font-bold">{c.label}</span>
                      {c.zone !== "UTC" && <span className="text-slate-600"> {c.zone}</span>}
                      {extra.some((x) => x.zone === c.zone) && <button type="button" onClick={() => setExtra((x) => x.filter((z) => z.zone !== c.zone))} className="ml-1.5 text-slate-600 hover:text-red-300" aria-label={`Remove ${c.label}`}>✕</button>}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap"><span className={t.ymd !== zulu.ymd ? "text-amber-200/80" : "text-slate-500"}>{t.weekday} {t.dayShort}</span></td>
                    <td className="py-1 pr-3 whitespace-nowrap"><span className="font-bold">{t.hhmm}</span>{t.letter && <span className="text-slate-500"> {t.letter}</span>}{ab && ab !== "UTC" && <span className="text-slate-500"> {ab}</span>}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{formatUtcOffset(t.offsetMin)}</td>
                    <td className={`py-1 pr-3 whitespace-nowrap ${d?.isDst ? "text-amber-200" : "text-slate-500"}`}>{dstWord(d)}</td>
                    <td className="py-1 pr-3 whitespace-nowrap text-slate-500">{d?.observes ? (nx ? zoneChangeLine(nx) : "none within 400 days") : "—"}</td>
                    <td className="py-1 whitespace-nowrap">{!src && <button type="button" onClick={() => fromHere(c.zone)} className="text-slate-500 hover:text-sky-300" title={`convert from ${c.label}`}>↺ from here</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="pt-1.5 text-[10px] text-slate-600">Zulu DTG {zulu.dtg} · amber date = a different calendar day from Zulu · ↺ makes that zone the source, to convert back · letter zones and Zulu never change for DST</p>
        </div>
      ) : (
        !(dtgIn.trim() && ms == null) && <p className="text-[11px] font-mono text-slate-500">Give a date and time (or a DTG) to convert.</p>
      )}

      <ClockChanges targets={targets} />

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label>add a zone</Label>
          <input value={addIn} onChange={(e) => setAddIn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} list="tz-zone-list" placeholder="Tehran · Asia/Tehran · EST · C" className={`${inputCls} w-56`} aria-label="Add a zone" />
          <datalist id="tz-zone-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
        </div>
        <button type="button" onClick={add} disabled={!addIn.trim()} className="px-2 py-1.5 rounded-md border border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-sky-300 disabled:opacity-40">＋ add</button>
        {addNote && <span className="text-[10px] text-slate-500 pb-2">{addNote}</span>}
      </div>
    </Card>
  );
}


// ── Clock changes across a range (inside the Time zones card) ──────────────

const fmtGap = (min: number): string => {
  const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""} h`;
};

/** Every clock change for the shown zones (or one) between two dates, with
 *  what each does to the local clock, and — against a second zone — how the
 *  gap between the two clocks moves. Folded by default; nothing stored. */
function ClockChanges({ targets }: { targets: ZoneCol[] }) {
  const [open, setOpen] = useState(false);
  const [which, setWhich] = useState("all");
  const [vs, setVs] = useState("");
  const [fromIn, setFromIn] = useState("");
  const [toIn, setToIn] = useState("");
  useEffect(() => {
    const t = inZone(Date.now(), "UTC").ymd;
    const y = Number(t.slice(0, 4));
    setFromIn(t); setToIn(`${y + 1}${t.slice(4)}`);
  }, []);
  const fromMs = fromIn ? Date.parse(`${fromIn}T00:00:00Z`) - 14 * 3_600_000 : NaN;   // the earliest zone's midnight
  const toMs = toIn ? Date.parse(`${toIn}T23:59:59Z`) + 14 * 3_600_000 : NaN;
  const days = (toMs - fromMs) / 86_400_000;
  const bad = !Number.isFinite(fromMs) || !Number.isFinite(toMs) ? "pick both dates" : days <= 0 ? "the end is before the start" : days > CHANGE_RANGE_MAX_DAYS ? "five years at most" : null;
  const zones = useMemo(() => (which === "all" ? targets.filter((t) => t.zone !== "UTC") : targets.filter((t) => t.zone === which)), [which, targets]);
  const rows = useMemo(() => (open && !bad ? changeTable(zones, fromMs, toMs) : []), [open, bad, zones, fromMs, toMs]);
  const noDst = zones.filter((z) => !dstInfo(Number.isFinite(fromMs) ? fromMs : Date.now(), z.zone)?.observes && !rows.some((r) => r.zone === z.zone));
  const vsZone = targets.find((t) => t.zone === vs);
  const gap = open && !bad && which !== "all" && vsZone && vsZone.zone !== which ? offsetGapPeriods(which, vsZone.zone, fromMs, toMs) : [];
  const whichLabel = targets.find((t) => t.zone === which)?.label ?? which;

  return (
    <div className="rounded-md border border-slate-800">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-200">
        <span>Clock changes across a range</span><span>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div><Label>from</Label><input type="date" value={fromIn} onChange={(e) => setFromIn(e.target.value)} className={inputCls} aria-label="Range start" /></div>
            <div><Label>to</Label><input type="date" value={toIn} onChange={(e) => setToIn(e.target.value)} className={inputCls} aria-label="Range end" /></div>
            <div>
              <Label>zones</Label>
              <select value={which} onChange={(e) => { setWhich(e.target.value); setVs(""); }} className={`${inputCls} max-w-[170px]`} aria-label="Zones to list">
                <option value="all">all in the table</option>
                {targets.filter((t) => t.zone !== "UTC").map((t) => <option key={t.zone} value={t.zone}>{t.label}</option>)}
              </select>
            </div>
            {which !== "all" && (
              <div>
                <Label>gap against</Label>
                <select value={vs} onChange={(e) => setVs(e.target.value)} className={`${inputCls} max-w-[170px]`} aria-label="Compare the gap against">
                  <option value="">—</option>
                  {targets.filter((t) => t.zone !== which).map((t) => <option key={t.zone} value={t.zone}>{t.label}</option>)}
                </select>
              </div>
            )}
          </div>
          {bad ? <p className="text-[11px] font-mono text-amber-300">{bad}</p> : (
            <>
              {rows.length > 0 ? (
                <div className="overflow-x-auto -mx-3 px-3">
                  <table className="min-w-full text-[11px] font-mono tabular-nums">
                    <thead>
                      <tr className="text-[9px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-800">
                        <th className="text-left py-1 pr-3">Zone</th><th className="text-left py-1 pr-3">Local date</th><th className="text-left py-1 pr-3">Clock</th>
                        <th className="text-left py-1 pr-3">Offset</th><th className="text-left py-1 pr-3">Zulu</th><th className="text-left py-1 pr-3">What it does</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const d = new Date(`${r.ymd}T12:00:00Z`);
                        return (
                          <tr key={`${r.zone}-${r.ms}`} className="border-b border-slate-800/60 text-slate-200">
                            <td className="py-1 pr-3 whitespace-nowrap font-bold">{r.label}</td>
                            <td className="py-1 pr-3 whitespace-nowrap">{d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} {r.ymd}</td>
                            <td className="py-1 pr-3 whitespace-nowrap">{r.wallFrom} → <span className="font-bold">{r.wallTo}</span> <span className={r.shiftMin > 0 ? "text-amber-200" : "text-sky-300"}>{r.shiftMin > 0 ? "+" : "−"}{fmtGap(r.shiftMin)}</span></td>
                            <td className="py-1 pr-3 whitespace-nowrap">{formatUtcOffset(r.fromOffset)}{r.abbrFrom ? ` ${r.abbrFrom}` : ""} → {formatUtcOffset(r.toOffset)}{r.abbrTo ? ` ${r.abbrTo}` : ""}</td>
                            <td className="py-1 pr-3 whitespace-nowrap text-slate-400">{inZone(r.ms, "UTC").dtg}</td>
                            <td className="py-1 pr-3 text-slate-500">{changeWindowLine(r)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-[11px] font-mono text-slate-500">No clock change in this range for {which === "all" ? "the zones in the table" : whichLabel}.</p>}
              {noDst.length > 0 && <p className="text-[10px] text-slate-600">No DST: {noDst.map((z) => z.label).join(" · ")} — the offset holds all year.</p>}
              {gap.length > 1 && vsZone && (
                <div className="text-[11px] font-mono text-slate-300 space-y-0.5">
                  {gap.map((g, i) => (
                    <div key={g.fromMs}>
                      <span className="text-slate-500">{i === 0 ? "from the start" : `from ${inZone(g.fromMs, "UTC").ymd} ${inZone(g.fromMs, "UTC").hhmm}Z`}:</span>{" "}
                      {whichLabel} is {g.diffMin === 0 ? `level with ${vsZone.label}` : `${fmtGap(g.diffMin)} ${g.diffMin > 0 ? "behind" : "ahead of"} ${vsZone.label}`}
                    </div>
                  ))}
                </div>
              )}
              {gap.length === 1 && vsZone && <p className="text-[11px] font-mono text-slate-400">{whichLabel} stays {gap[0].diffMin === 0 ? "level with" : `${fmtGap(gap[0].diffMin)} ${gap[0].diffMin > 0 ? "behind" : "ahead of"}`} {vsZone.label} across the range.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── En route ───────────────────────────────────────────────────────────────

export function EnRouteCard({ cols, hMs }: { cols: ZoneCol[]; hMs: number | null }) {
  const [mode, setMode] = useState<"depart" | "arrive">("depart");
  const [zone, setZone] = useState("UTC");
  const [dateIn, setDateIn] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [dtgIn, setDtgIn] = useState("");
  const [eteIn, setEteIn] = useState("");
  const [nmIn, setNmIn] = useState("");
  const [ktsIn, setKtsIn] = useState("");

  const anchorMs = useMemo(() => {
    if (dtgIn.trim()) return parseDtg(dtgIn);
    return dateIn && timeIn ? wallToMs(dateIn, timeIn, zone) : null;
  }, [dtgIn, dateIn, timeIn, zone]);
  const fromDist = eteFromDistance(Number(nmIn), Number(ktsIn));
  const ete = eteIn.trim() ? parseDuration(eteIn) : fromDist;
  const leg = anchorMs != null && ete != null ? enRoute(anchorMs, ete, mode === "arrive") : null;
  const zoneOptions: ZoneCol[] = [{ zone: "UTC", label: "Zulu" }, ...cols.filter((c) => c.zone !== "UTC")];

  const useH = () => { if (!hMs) return; const z = inZone(hMs, zone); setDateIn(z.ymd); setTimeIn(z.hhmm); setDtgIn(""); };

  return (
    <Card title="En route" sub="departure + ETE → arrival in every clock · or arrive-by → departure">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex rounded-md border border-slate-700 overflow-hidden" role="group" aria-label="Depart at or arrive by">
          {(["depart", "arrive"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              className={`px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider ${mode === m ? "bg-sky-500/15 text-sky-200" : "text-slate-500 hover:text-slate-300"}`}>
              {m === "depart" ? "Depart at" : "Arrive by"}
            </button>
          ))}
        </div>
        <div><Label>date</Label><input type="date" value={dateIn} onChange={(e) => { setDateIn(e.target.value); setDtgIn(""); }} className={inputCls} aria-label="Date" /></div>
        <div><Label>time</Label><input type="time" value={timeIn} onChange={(e) => { setTimeIn(e.target.value); setDtgIn(""); }} className={`${inputCls} w-28`} aria-label="Time" /></div>
        <div>
          <Label>in</Label>
          <select value={zone} onChange={(e) => setZone(e.target.value)} className={`${inputCls} max-w-[140px]`} aria-label="Zone the time is typed in">
            {zoneOptions.map((z) => <option key={z.zone} value={z.zone}>{z.label}</option>)}
          </select>
        </div>
        <div><Label>or DTG</Label><input value={dtgIn} onChange={(e) => setDtgIn(e.target.value)} placeholder="271930ZOCT26" className={`${inputCls} w-36`} aria-label="Time as a DTG" /></div>
        {hMs != null && <button type="button" onClick={useH} className="px-2 py-1.5 rounded-md border border-slate-700 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-300" title="use the H-hour anchor">= H</button>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div><Label>ETE</Label><input value={eteIn} onChange={(e) => setEteIn(e.target.value)} placeholder="7:45 · 7.75 · 465m" className={`${inputCls} w-36`} aria-label="Time en route" /></div>
        <span className="text-[10px] font-mono text-slate-600 pb-2">or</span>
        <div><Label>distance NM</Label><input value={nmIn} onChange={(e) => setNmIn(e.target.value)} inputMode="decimal" placeholder="3450" className={`${inputCls} w-24`} aria-label="Distance in nautical miles" /></div>
        <div><Label>ground speed kt</Label><input value={ktsIn} onChange={(e) => setKtsIn(e.target.value)} inputMode="decimal" placeholder="450" className={`${inputCls} w-24`} aria-label="Ground speed in knots" /></div>
        <span className="text-[11px] font-mono text-slate-400 pb-2">
          {eteIn.trim() ? (ete == null ? <span className="text-amber-300">not a duration</span> : `ETE ${durationLabel(ete)}`) : fromDist != null ? `ETE ${durationLabel(fromDist)} (${nmIn} NM ÷ ${ktsIn} kt, no wind)` : ""}
        </span>
      </div>
      {leg ? (
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="min-w-full text-[11px] font-mono tabular-nums">
            <thead>
              <tr className="text-[9px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="text-left py-1 pr-3"></th>
                <th className="text-left py-1 pr-3">Zulu DTG</th>
                {cols.filter((c) => c.zone !== "UTC").map((c) => <th key={c.zone} className="text-left py-1 pr-3 whitespace-nowrap">{c.label} <span className="font-normal normal-case tracking-normal text-slate-600">{formatUtcOffset(inZone(leg.depMs, c.zone).offsetMin)}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {([["Depart", leg.depMs], ["Arrive", leg.arrMs]] as const).map(([lab, ms]) => {
                const z = inZone(ms, "UTC");
                return (
                  <tr key={lab} className="border-b border-slate-800/60 text-slate-200">
                    <td className="py-1 pr-3 font-bold text-sky-200">{lab}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{z.dtg}</td>
                    {cols.filter((c) => c.zone !== "UTC").map((c) => {
                      const t = inZone(ms, c.zone);
                      return <td key={c.zone} className="py-1 pr-3 whitespace-nowrap"><span className={t.ymd !== z.ymd ? "text-amber-200/80" : "text-slate-500"}>{t.weekday} {t.dayShort}</span> <span className="font-bold">{t.hhmm}</span></td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="pt-1.5 text-[10px] text-slate-600">ETE {durationLabel(leg.eteMin)} · amber date = a different calendar day from Zulu · distance ÷ ground speed is still-air arithmetic — wind, climb and routing are yours</p>
        </div>
      ) : (
        <p className="text-[11px] font-mono text-slate-500">Give a time (or a DTG) and an ETE — or a distance and a ground speed.</p>
      )}
    </Card>
  );
}

// ── Units ──────────────────────────────────────────────────────────────────

const FAMILY_LABEL: Record<UnitFamily, string> = { distance: "Distance", speed: "Speed", temperature: "Temperature", weight: "Weight", fuel: "Fuel", pressure: "Pressure" };

function UnitRow({ family, density }: { family: UnitFamily; density: number }) {
  const units = unitsOf(family);
  const [from, setFrom] = useState(units[0].id);
  const [val, setVal] = useState("");
  const n = val.trim() === "" ? null : Number(val.replace(/,/g, ""));
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] sm:grid-cols-[92px_auto_minmax(0,1fr)] gap-2 items-center">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{FAMILY_LABEL[family]}</span>
      <div className="flex gap-1.5">
        <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" placeholder="0" className={`${inputCls} w-28`} aria-label={`${FAMILY_LABEL[family]} value`} />
        <select value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} aria-label={`${FAMILY_LABEL[family]} unit`}>
          {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
      <div className="col-span-2 sm:col-span-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono tabular-nums min-w-0">
        {n == null || !Number.isFinite(n)
          ? <span className="text-slate-600">{n == null ? "type a value" : "not a number"}</span>
          : units.filter((u) => u.id !== from).map((u) => <span key={u.id} className="text-slate-200">{fmtUnit(convertUnit(n, from, u.id, density))} <span className="text-slate-500">{u.label}</span></span>)}
      </div>
    </div>
  );
}

export function UnitsCard() {
  const [densIn, setDensIn] = useState(String(DEFAULT_FUEL_LB_PER_GAL));
  const d = Number(densIn);
  const density = d > 0 ? d : DEFAULT_FUEL_LB_PER_GAL;
  return (
    <Card title="Units" sub="exact factors · fuel by the density below">
      <div className="space-y-2">
        {UNIT_FAMILIES.map((f) => <UnitRow key={f} family={f} density={density} />)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <span className="font-bold uppercase tracking-widest text-slate-400">Fuel density</span>
        <input value={densIn} onChange={(e) => setDensIn(e.target.value)} inputMode="decimal" className={`${inputCls} w-20 py-0.5 text-[11px]`} aria-label="Fuel density in pounds per US gallon" />
        <span>lb / US gal{d > 0 ? "" : " — not a positive number, using 6.7"} · JP-8 / Jet A ≈ 6.7 at 15 °C, lighter warm, heavier cold — planning-grade, the fuel slip governs</span>
      </div>
    </Card>
  );
}
