"use client";

import { useEffect, useMemo, useState } from "react";
import type { WeatherThreats, SevereThreat, DisasterEvent, TropicalSystem, LocationHazard } from "@/lib/types";
import { aorFromCoords, COCOM_LABEL, type Aor } from "@/lib/aor";
import { LED_CLASS } from "@/lib/levelTokens";

// Threats & disasters BY COMBATANT COMMAND (REVIEW-2026-10 W5, W10): one
// header per COCOM, worst first, with NWS alerts, tropical systems, the 30-h
// model hazards and the disaster feed as rows — each carrying its source and
// a "near …" tag. The summary banner stays. A command with nothing reported
// is named at the bottom ("absence of signal, not evidence of calm").
//
// Alerts carry only location LABELS; the tab passes its points so a label
// resolves to coordinates and therefore to a command. Disasters carry their
// own `aor`; tropical systems and hazards carry lat/lon.

const DISASTER_ICON: Record<DisasterEvent["type"], string> = {
  earthquake: "⊕", cyclone: "🌀", flood: "≈", volcano: "⛰", drought: "☼",
  tsunami: "≋", epidemic: "✚", wildfire: "🔥", other: "•",
};
const DISASTER_LABEL: Record<DisasterEvent["type"], string> = {
  earthquake: "Earthquake", cyclone: "Cyclone / typhoon / hurricane", flood: "Flood",
  volcano: "Volcano", drought: "Drought", tsunami: "Tsunami",
  epidemic: "Epidemic / pandemic", wildfire: "Wildfire", other: "Other hazard",
};
const DISASTER_SEV: Record<DisasterEvent["severity"], string> = { red: "text-red-400", orange: "text-orange-400", green: "text-emerald-500", unknown: "text-slate-400" };
const SEV_TEXT: Record<SevereThreat["severity"], string> = { Extreme: "text-red-300", Severe: "text-orange-300", Moderate: "text-amber-300", Minor: "text-yellow-300", Unknown: "text-slate-400" };

const EMPTY: WeatherThreats = { threats: [], tropical: [], disasters: [], hazards: [], summary: { extreme: 0, severe: 0, lifeThreatening: 0, total: 0, topEvent: null, disasters: 0, disastersRed: 0, hazardLocations: 0 } };
const AOR_ORDER: Aor[] = ["CENTCOM", "EUCOM", "INDOPACOM", "AFRICOM", "SOUTHCOM", "NORTHCOM", "UNKNOWN"];

type Tone = "r" | "a" | "g";
const TONE_RANK: Record<Tone, number> = { r: 0, a: 1, g: 2 };
const LED_DOT: Record<Tone | "u", string> = LED_CLASS;

interface Row { key: string; aor: Aor; tone: Tone; icon: string; iconCls: string; kind: string; text: string; sub: string; near: string | null; source: string; link?: string; expand?: string }

export interface ThreatPoint { label: string; lat: number; lon: number }

export default function ThreatBoard({ refreshKey = 0, points = [], onLoaded }: { refreshKey?: number; points?: ThreatPoint[]; onLoaded?: (r: { ok: boolean; data: WeatherThreats }) => void }) {
  const [data, setData] = useState<WeatherThreats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [aorFilter, setAorFilter] = useState<Aor | "ALL">("ALL");

  useEffect(() => {
    setLoading(true);
    const controller = new AbortController();
    fetch("/api/weather/threats", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: WeatherThreats | null) => {
        const ok = !!(d && Array.isArray(d.disasters));
        const body = ok ? (d as WeatherThreats) : EMPTY;
        setData(body);
        onLoaded?.({ ok, data: body });
      })
      .catch(() => { onLoaded?.({ ok: false, data: EMPTY }); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const threats = Array.isArray(data.threats) ? data.threats : [];
  const tropical = Array.isArray(data.tropical) ? data.tropical : [];
  const disasters = Array.isArray(data.disasters) ? data.disasters : [];
  const hazards = Array.isArray(data.hazards) ? data.hazards : [];
  const summary = data.summary ?? EMPTY.summary;

  const rows = useMemo<Row[]>(() => {
    const byLabel = new Map(points.map((p) => [p.label.toLowerCase(), p]));
    const aorOfLabels = (labels: string[]): Aor => {
      for (const l of labels) { const p = byLabel.get(l.toLowerCase()); if (p) return aorFromCoords(p.lat, p.lon); }
      return "UNKNOWN";
    };
    const out: Row[] = [];
    for (const a of threats) {
      out.push({
        key: `al-${a.id}`, aor: aorOfLabels(a.locations), tone: a.lifeThreatening || a.severity === "Extreme" || a.severity === "Severe" ? "r" : "a",
        icon: "▲", iconCls: SEV_TEXT[a.severity], kind: `alert · ${a.severity}`,
        text: a.event, sub: a.headline, near: a.locations.join(", ") || null, source: "NWS",
        expand: `${a.headline}\nArea: ${a.areaDesc}${a.expires ? `\nExpires: ${new Date(a.expires).toLocaleString()}` : ""}`,
      });
    }
    for (const s of tropical as TropicalSystem[]) {
      const near = points.filter((p) => s.lat != null && s.lon != null && Math.hypot((p.lat - s.lat) * 111, (p.lon - s.lon) * 111 * Math.cos((p.lat * Math.PI) / 180)) <= 500).map((p) => p.label);
      out.push({
        key: `tr-${s.id}`, aor: s.lat != null && s.lon != null ? aorFromCoords(s.lat, s.lon) : "UNKNOWN", tone: near.length ? "r" : "a",
        icon: "🌀", iconCls: "text-sky-300", kind: "tropical",
        text: `${s.category} ${s.name}`, sub: [s.intensityKt != null ? `${s.intensityKt} kt` : "", s.pressureMb != null ? `${s.pressureMb} mb` : "", s.movement ? `moving ${s.movement}` : ""].filter(Boolean).join(" · "),
        near: near.length ? near.join(", ") : null, source: "NHC", link: s.link,
      });
    }
    for (const h of hazards as LocationHazard[]) {
      out.push({
        key: `hz-${h.label}`, aor: aorFromCoords(h.lat, h.lon), tone: h.severity === "severe" ? "r" : "a",
        icon: "●", iconCls: h.severity === "severe" ? "text-red-400" : "text-amber-400", kind: "hazard · model",
        text: `${h.label} — ${h.flags.join(" · ")}`, sub: "next 30 h · Open-Meteo model guidance, not an official warning", near: h.label, source: "Open-Meteo",
      });
    }
    for (const d of disasters) {
      out.push({
        key: `ds-${d.id}`, aor: d.aor, tone: d.severity === "red" || d.nearLocations.length > 0 ? "r" : d.severity === "orange" ? "a" : "g",
        icon: DISASTER_ICON[d.type], iconCls: DISASTER_SEV[d.severity], kind: `disaster · ${d.severity}`,
        text: d.title, sub: [d.country, (d.hadrScore ?? 0) >= 55 ? "HADR-relevant" : "", DISASTER_LABEL[d.type]].filter(Boolean).join(" · "),
        near: d.nearLocations.length ? d.nearLocations.join(", ") : null, source: d.source, link: d.link,
      });
    }
    return out;
  }, [threats, tropical, hazards, disasters, points]);

  const groups = useMemo(() => {
    const by = new Map<Aor, Row[]>();
    for (const r of rows) { if (!by.has(r.aor)) by.set(r.aor, []); by.get(r.aor)!.push(r); }
    return AOR_ORDER.filter((a) => by.has(a)).map((aor) => {
      const items = by.get(aor)!.sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone] || (y.near ? 1 : 0) - (x.near ? 1 : 0));
      const tone = items[0]?.tone ?? "g";
      return { aor, items, tone, worst: items[0] };
    }).sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.items.length - a.items.length);
  }, [rows]);

  if (loading && rows.length === 0) return null;
  const allClear = rows.length === 0;
  const shown = aorFilter === "ALL" ? groups : groups.filter((g) => g.aor === aorFilter);
  const quiet = AOR_ORDER.filter((a) => a !== "UNKNOWN" && !groups.some((g) => g.aor === a));

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className={`flex items-center gap-2 flex-wrap px-4 py-2.5 border-b ${summary.lifeThreatening > 0 ? "border-red-500/40 bg-red-500/5" : threats.length > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-slate-800"}`}>
        <span className={summary.lifeThreatening > 0 ? "text-red-400" : threats.length > 0 ? "text-amber-400" : "text-emerald-500"}>{allClear ? "✓" : "⚠"}</span>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Threats &amp; disasters</h3>
        <span className="text-[10px] text-slate-600">alerts · tropical · 30-h hazards · disasters — by combatant command, worst first</span>
        {allClear ? <span className="ml-auto text-[10px] text-slate-500 font-mono">nothing reported at your points</span> : (
          <span className="ml-auto text-[10px] font-mono text-slate-400">
            {summary.lifeThreatening > 0 && <span className="text-red-400 font-bold">{summary.lifeThreatening} life-threatening · </span>}
            {summary.total} alert{summary.total === 1 ? "" : "s"}
            {tropical.length > 0 && <span className="text-sky-400"> · {tropical.length} tropical</span>}
            {disasters.length > 0 && <span className={summary.disastersRed > 0 ? "text-red-400" : "text-orange-400"}> · {disasters.length} disaster{disasters.length === 1 ? "" : "s"}</span>}
            {hazards.length > 0 && <span className="text-amber-400"> · {hazards.length} wx-hazard</span>}
          </span>
        )}
        {groups.length > 1 && (
          <span className="w-full sm:w-auto flex flex-wrap gap-1">
            {(["ALL", ...groups.map((g) => g.aor)] as const).map((a) => (
              <button key={a} onClick={() => setAorFilter(a)} className={`text-[8px] font-mono uppercase tracking-wider rounded px-1.5 py-0.5 border transition-colors ${aorFilter === a ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
                {a === "ALL" ? "All" : `${a} ${groups.find((g) => g.aor === a)?.items.length ?? ""}`}
              </button>
            ))}
          </span>
        )}
      </div>

      {shown.map((g) => (
        <div key={g.aor} className="border-t border-slate-800/70">
          <div className="flex items-center gap-2.5 px-4 py-1.5 bg-slate-950/40 text-[11px]">
            <span className={`w-2 h-2 rounded-full ${LED_DOT[g.tone]}`} />
            <b className="text-slate-100 tracking-wide">{COCOM_LABEL[g.aor]}</b>
            <span className="text-[9.5px] font-mono text-slate-500">{g.items.length} item{g.items.length === 1 ? "" : "s"}</span>
            {g.worst && <span className="ml-auto text-[10px] text-slate-400 truncate">{g.worst.text}</span>}
          </div>
          {g.items.map((r) => {
            const open = expanded.has(r.key);
            return (
              <div key={r.key} className="border-t border-slate-800/50">
                <div className="grid grid-cols-[18px_1fr_auto] sm:grid-cols-[18px_110px_1fr_auto] gap-2 items-center px-4 py-1.5 text-[11.5px]">
                  <span className={`text-center ${r.iconCls}`} title={r.kind}>{r.icon}</span>
                  <span className="hidden sm:block text-[9px] font-bold uppercase tracking-wider text-slate-500">{r.kind}</span>
                  <span className="min-w-0">
                    {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-emerald-400">{r.text}</a>
                      : r.expand ? <button onClick={() => setExpanded((p) => { const n = new Set(p); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n; })} className="text-left text-slate-200 hover:text-emerald-400">{r.text} <span className="text-[9px] text-slate-600">{open ? "▴" : "▾"}</span></button>
                      : <span className="text-slate-200">{r.text}</span>}
                    {r.sub && <span className="ml-2 text-[10px] text-slate-500">{r.sub}</span>}
                    {r.near && <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-red-300 border border-red-500/40 rounded px-1">near {r.near}</span>}
                  </span>
                  <span className="text-[8.5px] font-mono text-slate-600 whitespace-nowrap" title={`Source: ${r.source}`}>{r.source}</span>
                </div>
                {open && r.expand && <pre className="px-4 pb-2 pl-10 text-[10.5px] text-slate-400 whitespace-pre-wrap font-sans">{r.expand}</pre>}
              </div>
            );
          })}
        </div>
      ))}
      {quiet.length > 0 && <p className="px-4 py-2 border-t border-slate-800/70 text-[10.5px] text-slate-600">{quiet.map((a) => COCOM_LABEL[a]).join(" · ")} — nothing reported at your points · absence of signal, not evidence of calm.</p>}
    </div>
  );
}
