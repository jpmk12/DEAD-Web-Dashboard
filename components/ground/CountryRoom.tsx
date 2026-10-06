"use client";

import { useEffect, useState } from "react";
import { openTrackPicker } from "@/lib/trackClient";
import dynamic from "next/dynamic";
import type { ForceAssessment, CategoryAssessment } from "@/lib/forceProtection";
import type { CountryDossier } from "@/lib/groundTruth";
import { SEVERITY_DOT as SEV_DOT, SEVERITY_TEXT as SEV_TEXT, type Severity } from "@/lib/severity";
import { COCOM_LABEL } from "@/lib/aor";
import { noteOpen } from "@/lib/noteOpenClient";

const IncidentMiniMap = dynamic(() => import("./IncidentMiniMap"), { ssr: false });

// The country SITUATION ROOM — the per-country dossier (posture, conflict
// reporting, incidents + mini-map, news, civil, health, digital) rendered
// INSIDE a command-board country row (REVIEW-2026-10 §6 O3: Regional was the
// country level of the same hierarchy on another pane; its rail is gone and
// this is what the rail opened). Fetches its dossier + AI SITREP lazily on
// mount — nothing assembles until the row is opened.
//
// Type-only imports keep the server scoring/dossier modules out of this
// client bundle; runtime data comes from the APIs.

type Sev = Severity;
const ADV_LABEL: Record<number, string> = { 1: "Exercise Normal Precautions", 2: "Exercise Increased Caution", 3: "Reconsider Travel", 4: "Do Not Travel" };
const ADV_COLOR: Record<number, string> = { 1: "text-emerald-400", 2: "text-amber-400", 3: "text-orange-400", 4: "text-red-400" };
const ADV_DOT: Record<number, string> = { 1: "#10b981", 2: "#fbbf24", 3: "#fb923c", 4: "#ef4444" };
const DISASTER_DOT: Record<string, string> = { red: "#ef4444", orange: "#fb923c", green: "#10b981", unknown: "#94a3b8" };
const POSTURE_DOT: Record<string, string> = { red: "#ef4444", amber: "#fbbf24", green: "#10b981", unknown: "#64748b" };
const POSTURE_TEXT: Record<string, string> = { red: "text-red-400", amber: "text-amber-400", green: "text-emerald-400", unknown: "text-slate-500" };

function fmtMonthYear(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", year: "numeric" });
}
function fmtAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

const cat = (a: ForceAssessment | null | undefined, name: CategoryAssessment["category"]) => a?.categories.find((c) => c.category === name);

function Card({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-800 rounded-xl bg-slate-900/40 overflow-hidden">
      <div className="px-3.5 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400">{title}</span>
        {meta && <span className="text-[9px] font-mono text-slate-600">{meta}</span>}
      </div>
      <div className="px-3.5 py-3">{children}</div>
    </div>
  );
}

function CatLines({ c }: { c?: CategoryAssessment }) {
  if (!c || (c.signals.length === 0 && c.severity === "green")) return <p className="text-[11px] text-slate-600">Nothing notable.</p>;
  if (c.signals.length === 0) return <p className="text-[11px] text-slate-500">{c.severity === "unknown" ? "Feed unavailable — UNKNOWN." : "Nothing notable."}</p>;
  return (
    <ul className="space-y-1">
      {c.signals.map((s, i) => (
        <li key={i} className="text-[12px] text-slate-300 flex items-start gap-1.5">
          <span style={{ color: SEV_DOT[c.severity as Sev] }} className="mt-0.5 text-[8px]">●</span>
          <span>{s}{i === 0 && c.links?.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-[10px] text-violet-300/80 hover:text-violet-200">{l.label} ↗</a>)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CountryRoom({ country, sel, base, active = true }: {
  country: string;
  /** The country watch, else the worst base standing in; null when unwatched. */
  sel: ForceAssessment | null;
  /** The pinned base in this country, when one exists. */
  base: ForceAssessment | null;
  active?: boolean;
}) {
  const [dossier, setDossier] = useState<CountryDossier | null>(null);
  const [dLoading, setDLoading] = useState(false);
  const [sitrep, setSitrep] = useState<string | null>(null);
  const [sLoading, setSLoading] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancel = false;
    noteOpen("country", country);
    setDLoading(true); setDossier(null); setSitrep(null); setSLoading(true);
    const empty: CountryDossier = { country, center: null, incidents: [], disasters: [], news: [], conflictNews: { count: 0, escalation: false }, civil: { advisoryLevel: null, departure: null, events: [], holidays: [] }, health: { outbreaks: [], indicators: [] }, digital: null };
    fetch(`/api/ground-truth?country=${encodeURIComponent(country)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancel) { setDossier(d ?? empty); setDLoading(false); } })
      .catch(() => { if (!cancel) { setDossier(empty); setDLoading(false); } });

    const drivers = (sel?.categories ?? []).filter((c) => c.severity !== "green").flatMap((c) => c.signals).slice(0, 8);
    fetch("/api/ground-truth/sitrep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country, composite: sel?.composite ?? "unknown", cocom: sel?.cocom ?? "UNKNOWN", drivers }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancel) setSitrep(d?.disabled ? "AI is off — turn it on in Preferences → AI Controls to generate a SITREP." : d?.text || "Couldn't generate a SITREP."); })
      .catch(() => { if (!cancel) setSitrep("SITREP unavailable — a feed may be down."); })
      .finally(() => { if (!cancel) setSLoading(false); });
    return () => { cancel = true; };
  }, [country, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseForSel = base;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-lg">🌐</span>
        <h3 className="text-base font-bold text-slate-100">{country}</h3>
        {sel ? (
          <>
            <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">{COCOM_LABEL[sel.cocom] ?? sel.cocom}</span>
            <span style={{ color: SEV_DOT[sel.composite as Sev] }} className="text-[13px]">●</span>
            <span className={`text-[11px] font-mono font-bold ${SEV_TEXT[sel.composite as Sev]}`}>{sel.composite.toUpperCase()}</span>
            {sel.previousComposite && sel.previousComposite !== sel.composite && <span className="text-[9px] text-slate-500">(was {sel.previousComposite.toUpperCase()})</span>}
            {sel.chronicity?.label && (
              <span className={`text-[9px] font-mono ${sel.chronicity.state === "new" ? "text-red-300" : sel.chronicity.state === "improving" ? "text-emerald-400/80" : "text-slate-400"}`}>
                · {sel.chronicity.label}
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] text-amber-300/90 flex items-center gap-1.5 flex-wrap">not in the posture watch — posture UNKNOWN, not clear
            <button type="button" onClick={() => openTrackPicker({ kind: "country", country })} className="text-[9px] font-bold uppercase tracking-wider text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded px-1.5 py-px">Track {country}</button>
          </span>
        )}
        {baseForSel && <span className="text-[10px] font-mono text-slate-500 ml-auto">pinned base: {baseForSel.label}{baseForSel.icao ? ` (${baseForSel.icao})` : ""}</span>}
      </div>

      {/* Active conflict reporting — the timeliest kinetic read (same signal
          that sets the posture dot). Leads the dossier; hidden when quiet. */}
      {!dLoading && dossier && dossier.conflictNews.count > 0 && (() => {
        const cn = dossier.conflictNews;
        const esc = cn.escalation;
        return (
          <div className={`rounded-xl border px-3 py-2.5 flex items-start gap-2.5 ${esc ? "border-red-500/40 bg-red-500/[0.09]" : "border-amber-500/35 bg-amber-500/[0.08]"}`}>
            <span className={`text-[13px] leading-tight flex-shrink-0 ${esc ? "text-red-400" : "text-amber-400"}`}>⚠</span>
            <div className="min-w-0">
              <p className={`text-[9px] font-bold uppercase tracking-[0.1em] ${esc ? "text-red-300" : "text-amber-300"}`}>Active conflict reporting ({cn.count})</p>
              {cn.latest ? (
                <a href={cn.latest.link} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-slate-200 hover:text-sky-200 leading-snug block mt-0.5">{cn.latest.title}</a>
              ) : (
                <p className="text-[12.5px] text-slate-300 mt-0.5">{cn.count} conflict-related report{cn.count === 1 ? "" : "s"} in recent news</p>
              )}
              {cn.latest && (
                <p className="text-[9px] font-mono text-slate-500 mt-1">
                  {cn.latest.source.replace(" · local", "")}{cn.latest.pubDate ? ` · ${fmtAgo(cn.latest.pubDate)}` : ""}{cn.count > 1 ? ` · ${cn.count} corroborating reports` : ""}
                </p>
              )}
            </div>
          </div>
        );
      })()}

      <Card title="✦ AI SITREP" meta={sLoading ? "reading…" : undefined}>
        {sLoading && <p className="text-[12px] text-slate-500">Generating ground situation read…</p>}
        {!sLoading && sitrep && <pre className="text-[12.5px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{sitrep}</pre>}
      </Card>

      <Card title="◆ Security incidents" meta="ACLED · UCDP · in-country + ~500km">
        {dLoading && <p className="text-[12px] text-slate-500">Loading incidents…</p>}
        {!dLoading && dossier && (
          <div className="flex flex-col md:flex-row gap-3">
            {(dossier.center || dossier.incidents.length > 0) && (
              <div className="md:w-[44%] flex-shrink-0">
                <IncidentMiniMap
                  center={dossier.center}
                  base={baseForSel ? { lat: baseForSel.lat, lon: baseForSel.lon, label: baseForSel.label } : null}
                  incidents={dossier.incidents}
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              {dossier.incidents.length === 0 ? (
                <p className="text-[11px] text-slate-600">No recent in-country or nearby incidents in window.</p>
              ) : (
                <ul className="space-y-1.5">
                  {dossier.incidents.map((i, n) => (
                    <li key={n} className="text-[12px] flex items-start gap-2">
                      <span className={i.km == null ? "text-red-400" : "text-amber-400"}>◆</span>
                      <span className="text-slate-300 flex-1 min-w-0">{i.type} <span className="text-slate-500">@ {i.location}</span>{i.fatalities > 0 && <span className="text-red-400/90"> · {i.fatalities} killed</span>}{i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-[10px] text-violet-300/80">↗</a>}</span>
                      <span className="text-[10px] font-mono text-slate-600 flex-shrink-0">{i.date ? `${i.date} · ` : ""}{i.km == null ? "in-country" : `~${i.km}km`} · {i.src.toUpperCase()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      {!dLoading && dossier && dossier.disasters.length > 0 && (
        <Card title="🌪 Natural disasters" meta="GDACS · USGS · ReliefWeb — in-country + ~500km">
          <ul className="space-y-1.5">
            {dossier.disasters.map((d, n) => (
              <li key={n} className="text-[12px] flex items-start gap-2">
                <span style={{ color: DISASTER_DOT[d.severity] ?? "#94a3b8" }} className="mt-0.5 text-[8px]">●</span>
                <span className="text-slate-300 flex-1 min-w-0"><span className="uppercase text-[9px] text-slate-500">{d.type}</span> {d.title}{d.link && <a href={d.link} target="_blank" rel="noopener noreferrer" className="ml-1 text-[10px] text-violet-300/80">↗</a>}</span>
                <span className="text-[10px] font-mono text-slate-600 flex-shrink-0">{d.km == null ? "in-country" : `~${d.km}km`}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="📰 Local news & media" meta="GDELT + your OSINT feeds">
        {dLoading && <p className="text-[12px] text-slate-500">Loading news…</p>}
        {!dLoading && dossier && dossier.news.length === 0 && <p className="text-[11px] text-slate-600">No recent headlines found.</p>}
        {!dLoading && dossier && dossier.news.length > 0 && (
          <ul className="space-y-2">
            {dossier.news.map((n) => (
              <li key={n.id} className="flex items-start gap-2.5">
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-sky-200/90 hover:text-sky-100 leading-snug flex-1 min-w-0">{n.title}</a>
                <span className="text-[9px] font-mono text-slate-600 flex-shrink-0 mt-0.5">{n.source.replace(" · local", "")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-3">
        <Card title="⚖ Civil / political">
          {dLoading && <p className="text-[12px] text-slate-500">Loading…</p>}
          {!dLoading && dossier && (() => {
            const cv = dossier.civil;
            const hasAny = cv.advisoryLevel != null || cv.departure || cv.events.length > 0 || cv.holidays.length > 0;
            if (!hasAny) return <CatLines c={cat(sel, "civil")} />;
            return (
              <ul className="space-y-1.5">
                {cv.advisoryLevel != null && (
                  <li className="text-[12px] flex items-start gap-1.5">
                    <span style={{ color: ADV_DOT[cv.advisoryLevel] ?? "#94a3b8" }} className="mt-0.5 text-[8px]">●</span>
                    <span className="text-slate-300"><b className="text-slate-200">State advisory:</b> Level {cv.advisoryLevel}{ADV_LABEL[cv.advisoryLevel] ? <> — <span className={ADV_COLOR[cv.advisoryLevel]}>{ADV_LABEL[cv.advisoryLevel]}</span></> : null}{cv.worstAreaLevel != null && cv.worstAreaLevel > cv.advisoryLevel && <span className="ml-1 text-[10px] text-red-400/90">(areas to Level {cv.worstAreaLevel})</span>}{cv.advisoryIssued && <span className="ml-1 text-[10px] text-slate-500">· {cv.advisoryIssued}</span>}{cv.advisoryLink && <a href={cv.advisoryLink} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-[10px] text-violet-300/80 hover:text-violet-200">State ↗</a>}</span>
                  </li>
                )}
                {cv.guidance && <li className="text-[11.5px] text-slate-400 flex items-start gap-1.5"><span className="text-slate-600 text-[8px] mt-0.5">›</span><span className="leading-snug">{cv.guidance}</span></li>}
                {cv.indicators && cv.indicators.length > 0 && (
                  <li className="flex flex-wrap gap-1 pl-3">
                    {cv.indicators.map((ind, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-300 border border-slate-700/60">{ind}</span>
                    ))}
                  </li>
                )}
                {cv.riskAreas && cv.riskAreas.filter((a) => (a.level ?? 0) >= 4).slice(0, 4).map((a, i) => (
                  <li key={`ra-${i}`} className="text-[11.5px] text-red-300/90 flex items-start gap-1.5"><span className="text-red-400 text-[8px] mt-0.5">⚑</span><span className="leading-snug"><b className="text-red-300">Do not travel:</b> {a.name}</span></li>
                ))}
                {cv.departure && <li className="text-[12px] text-red-400 flex items-start gap-1.5"><span className="text-[8px] mt-0.5">◆</span><span>{cv.departure === "ordered" ? "Ordered" : "Authorized"} departure in effect</span></li>}
                {cv.events.map((e, i) => (
                  <li key={i} className="text-[12px] text-slate-300 flex items-start gap-1.5"><span className="text-amber-400 text-[8px] mt-0.5">●</span><span>{e.label} — {e.when}</span></li>
                ))}
                {cv.holidays.map((h, i) => (
                  <li key={`h-${i}`} className="text-[12px] text-slate-300 flex items-start gap-1.5"><span className="text-sky-400 text-[8px] mt-0.5">🏛</span><span><span className="text-slate-400">Public holiday:</span> {h.label} — {h.active ? "today" : `in ${h.daysUntil}d`}</span></li>
                ))}
              </ul>
            );
          })()}
        </Card>
        <Card title="✚ Health · ✈ Access">
          <div className="space-y-2">
            <div><span className="text-[9px] uppercase tracking-wider text-slate-600">Health / hazard</span><CatLines c={cat(sel, "hazard")} /></div>
            {baseForSel ? (
              <div className="pt-1.5 border-t border-slate-800/60">
                <span className="text-[9px] uppercase tracking-wider text-slate-600">Access — {baseForSel.icao ?? baseForSel.label}</span>
                <CatLines c={cat(baseForSel, "weather")} />
                <CatLines c={cat(baseForSel, "airspace")} />
                <CatLines c={cat(baseForSel, "gps")} />
              </div>
            ) : (
              <p className="text-[10px] text-slate-600 pt-1.5 border-t border-slate-800/60">Pin a base (with ICAO) in this country for aviation weather, NOTAMs &amp; GPS.</p>
            )}
          </div>
        </Card>
      </div>

      {!dLoading && dossier && (dossier.health.outbreaks.length > 0 || dossier.health.indicators.length > 0) && (
        <Card title="✚ Host-nation health" meta="WHO GHO · DON">
          {dossier.health.outbreaks.length > 0 ? (
            <ul className="space-y-1 mb-2">
              {dossier.health.outbreaks.map((o, i) => (
                <li key={i} className="text-[12px] flex items-baseline gap-1.5">
                  <span className="text-orange-400 text-[8px] mt-0.5">●</span>
                  <a href={o.link} target="_blank" rel="noopener noreferrer" className="text-orange-300/90 hover:text-orange-200">{o.disease}</a>
                  {o.date && <span className="text-slate-600 text-[9px] font-mono">{fmtMonthYear(o.date)}</span>}
                  <span className="text-slate-600 text-[9px] font-mono">DON ↗</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-600 mb-2">No active WHO outbreaks reported.</p>
          )}
          {dossier.health.indicators.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 border-t border-slate-800/60">
              {dossier.health.indicators.map((ind) => (
                <div key={ind.key}>
                  <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                    <span style={{ color: POSTURE_DOT[ind.posture] }} className="text-[7px]">●</span>{ind.label}
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-[13px] font-bold font-mono ${POSTURE_TEXT[ind.posture]}`}>{ind.display}</span>
                    {ind.year && <span className="text-[8px] text-slate-700 font-mono">{ind.year}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[8px] text-slate-700 mt-2">WHO Global Health Observatory (latest year) + Disease Outbreak News — planning baseline, not medical guidance.</p>
        </Card>
      )}

      {!dLoading && dossier && dossier.digital && (() => {
        const dg = dossier.digital;
        const worstAlert = dg.internet.alerts.find((a) => a.level === "critical") ?? dg.internet.alerts[0];
        const led = (ok: boolean, level: "g" | "a" | "r") => (ok ? level : "u");
        const dot = (l: string) => (l === "r" ? "#ef4444" : l === "a" ? "#fbbf24" : l === "g" ? "#10b981" : "#64748b");
        const rows: { led: string; text: React.ReactNode; src: string }[] = [
          { led: led(dg.internet.live, worstAlert ? (worstAlert.level === "critical" ? "r" : "a") : "g"), src: "IODA",
            text: dg.internet.live ? (worstAlert ? `Connectivity outage alert — ${worstAlert.level} (${worstAlert.sources} source${worstAlert.sources === 1 ? "" : "s"}, 24 h)` : "No national connectivity outage alert (24 h)") : "IODA unreachable — connectivity UNKNOWN" },
          { led: led(dg.gps.live, dg.gps.cells >= 10 ? "a" : "g"), src: "GPSJam",
            text: dg.gps.live ? `${dg.gps.cells} elevated GPS-interference cell${dg.gps.cells === 1 ? "" : "s"} within 500 km${dg.gps.date ? ` (${dg.gps.date})` : ""}` : "GPSJam unreachable — interference UNKNOWN" },
          { led: led(dg.ransomware.live, dg.ransomware.victims30 >= 5 ? "a" : "g"), src: "ransomware.live",
            text: dg.ransomware.live ? `${dg.ransomware.victims30} ransomware victim${dg.ransomware.victims30 === 1 ? "" : "s"} in-country (30 d)` : "ransomware.live unreachable — UNKNOWN" },
        ];
        return (
          <Card title="⌁ Digital & spectrum" meta="IODA · GPSJam · CISA · ransomware.live">
            <ul className="space-y-1">
              {rows.map((r, i) => (
                <li key={i} className="text-[11.5px] text-slate-300 flex items-start gap-1.5">
                  <span style={{ color: dot(r.led) }} className="text-[8px] mt-1">●</span>
                  <span className="flex-1">{r.text}</span>
                  <span className="text-[8px] text-slate-600 font-mono mt-0.5">{r.src}</span>
                </li>
              ))}
              {dg.advisories.map((a, i) => (
                <li key={`adv${i}`} className="text-[11.5px] flex items-start gap-1.5">
                  <span className="text-red-400 text-[8px] mt-1">●</span>
                  <span className="flex-1">
                    {a.link ? <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-red-300/90 hover:text-red-200">{a.title}</a> : <span className="text-red-300/90">{a.title}</span>}
                    <span className="text-slate-600 text-[9px]"> · names {a.actors.join("/")}</span>
                  </span>
                  <span className="text-[8px] text-slate-600 font-mono mt-0.5">CISA</span>
                </li>
              ))}
              {dg.cyberNews.map((n, i) => (
                <li key={`cn${i}`} className="text-[11.5px] flex items-start gap-1.5">
                  <span className={`text-[8px] mt-1 ${n.modality === "act" ? "text-amber-400" : "text-slate-500"}`}>●</span>
                  <span className="flex-1">
                    <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-emerald-300">{n.title}</a>
                    <span className="text-slate-600 text-[9px]"> · {n.cls} · {n.modality}</span>
                  </span>
                  <span className="text-[8px] text-slate-600 font-mono mt-0.5">{n.source.slice(0, 14)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[8px] text-slate-700 mt-2">Passive published feeds only — nothing probes a network. Graded text: act › threat › analysis; a bare mention earns nothing. UNKNOWN ≠ clear.</p>
          </Card>
        );
      })()}

      <p className="text-[9px] text-slate-600 px-1">Coarse open-source SA — not authoritative tasking.</p>
    </div>
  );
}
