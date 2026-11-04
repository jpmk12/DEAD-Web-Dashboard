"use client";

import { useMemo, useState } from "react";
import { wallToMs, inZone, parseDtg } from "@/lib/plannerTools";
import { formatUtcOffset } from "@/lib/worldClocks";
import {
  parseDuration, durationLabel, eteFromDistance, enRoute,
  UNIT_FAMILIES, unitsOf, convertUnit, fmtUnit, DEFAULT_FUEL_LB_PER_GAL, type UnitFamily,
} from "@/lib/plannerExtras";
import { Card, Label, inputCls, type ZoneCol } from "./toolsUi";

// Two Tools cards, both arithmetic in the browser — no request, nothing
// stored (tests/toolsPrivacy.test.ts scans this file and fails on a fetch or
// a storage write). They work the same in private mode.

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
