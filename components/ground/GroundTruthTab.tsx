"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getForceProtectionData } from "@/lib/forceProtectionClient";
import type { ForceAssessment, CategoryAssessment } from "@/lib/forceProtection";
import type { CountryDossier } from "@/lib/groundTruth";

const IncidentMiniMap = dynamic(() => import("./IncidentMiniMap"), { ssr: false });

// Type-only imports above keep the server scoring/dossier modules out of this
// client bundle; runtime data comes from the APIs.

type Sev = "red" | "amber" | "green" | "unknown";
const SEV_DOT: Record<Sev, string> = { red: "#ef4444", amber: "#fbbf24", green: "#10b981", unknown: "#94a3b8" };
const SEV_TEXT: Record<Sev, string> = { red: "text-red-400", amber: "text-amber-400", green: "text-emerald-400", unknown: "text-slate-400" };
const SEV_RANK: Record<Sev, number> = { red: 0, amber: 1, unknown: 2, green: 3 };
const COCOM_LABEL: Record<string, string> = { NORTHCOM: "USNORTHCOM", SOUTHCOM: "USSOUTHCOM", EUCOM: "USEUCOM", CENTCOM: "USCENTCOM", AFRICOM: "USAFRICOM", INDOPACOM: "USINDOPACOM", UNKNOWN: "—" };
const ADV_LABEL: Record<number, string> = { 1: "Exercise Normal Precautions", 2: "Exercise Increased Caution", 3: "Reconsider Travel", 4: "Do Not Travel" };
const ADV_COLOR: Record<number, string> = { 1: "text-emerald-400", 2: "text-amber-400", 3: "text-orange-400", 4: "text-red-400" };
const ADV_DOT: Record<number, string> = { 1: "#10b981", 2: "#fbbf24", 3: "#fb923c", 4: "#ef4444" };

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

// Signals + source links from a category (civil / hazard / access).
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

export default function GroundTruthTab({ active }: { active: boolean }) {
  const [assessments, setAssessments] = useState<ForceAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [dossier, setDossier] = useState<CountryDossier | null>(null);
  const [dLoading, setDLoading] = useState(false);
  const [sitrep, setSitrep] = useState<string | null>(null);
  const [sLoading, setSLoading] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancel = false;
    setLoading(true);
    getForceProtectionData().then((d) => { if (!cancel) { setAssessments(d.assessments ?? []); setLoading(false); } });
    const onChange = () => getForceProtectionData(true).then((d) => { if (!cancel) setAssessments(d.assessments ?? []); });
    window.addEventListener("force-locations:changed", onChange);
    return () => { cancel = true; window.removeEventListener("force-locations:changed", onChange); };
  }, [active]);

  // One row per country, drawn from BOTH watched countries AND the countries of
  // watched airports (bases) in the Force Protection watch list. So entering just
  // an airport still surfaces its country here. A country watch (if present) is
  // the primary posture; otherwise the worst base in that country stands in.
  const rows = useMemo(() => {
    const groups = new Map<string, ForceAssessment[]>();
    for (const a of assessments) {
      if (a.kind !== "country" && a.kind !== "base") continue;
      const key = a.country.trim().toLowerCase();
      if (!key) continue;
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(a);
    }
    const bySeverity = (a: ForceAssessment, b: ForceAssessment) => SEV_RANK[a.composite as Sev] - SEV_RANK[b.composite as Sev] || b.score - a.score;
    const out = Array.from(groups.values()).map((list) => {
      const primary = list.find((a) => a.kind === "country") ?? list.slice().sort(bySeverity)[0];
      const base = list.filter((a) => a.kind === "base").sort((a, b) => (b.icao ? 1 : 0) - (a.icao ? 1 : 0) || bySeverity(a, b))[0] ?? null;
      return { country: primary.country, primary, base };
    });
    return out.sort((a, b) => bySeverity(a.primary, b.primary));
  }, [assessments]);

  useEffect(() => { if (rows.length && (!selected || !rows.some((r) => r.country === selected))) setSelected(rows[0].country); }, [rows, selected]);

  const row = rows.find((r) => r.country === selected) ?? null;
  const sel = row?.primary ?? null;
  const baseForSel = row?.base ?? null;

  // Load dossier + SITREP when the selected country changes.
  useEffect(() => {
    if (!sel) return;
    let cancel = false;
    setDLoading(true); setDossier(null); setSitrep(null); setSLoading(true);
    const empty: CountryDossier = { country: sel.country, center: null, incidents: [], news: [], civil: { advisoryLevel: null, departure: null, events: [] } };
    fetch(`/api/ground-truth?country=${encodeURIComponent(sel.country)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancel) { setDossier(d ?? empty); setDLoading(false); } })
      .catch(() => { if (!cancel) { setDossier(empty); setDLoading(false); } });

    const drivers = sel.categories.filter((c) => c.severity !== "green").flatMap((c) => c.signals).slice(0, 8);
    fetch("/api/ground-truth/sitrep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country: sel.country, composite: sel.composite, cocom: sel.cocom, drivers }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancel) setSitrep(d?.disabled ? "AI is off — turn it on in Preferences → AI Controls to generate a SITREP." : d?.text || "Couldn't generate a SITREP."); })
      .catch(() => { if (!cancel) setSitrep("SITREP unavailable — a feed may be down."); })
      .finally(() => { if (!cancel) setSLoading(false); });
    return () => { cancel = true; };
  }, [sel?.country]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loading && rows.length === 0) {
    return (
      <div className="border border-slate-800 rounded-xl bg-slate-900/40 px-4 py-8 text-center">
        <p className="text-sm text-slate-300 font-semibold mb-1">No locations watched yet</p>
        <p className="text-[12px] text-slate-500">Add countries or airfields to your <span className="text-slate-300">Mobility Watch</span> (Preferences → Content sources, or the Crisis map) to see the country-level picture for each.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Regional</h2>
        <span className="text-[11px] text-slate-600">country-level picture for your crews — incidents, news, advisories, holidays &amp; anniversaries</span>
      </div>
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Country rail */}
        <div className="lg:w-56 flex-shrink-0 border border-slate-800 rounded-xl bg-slate-900/40 overflow-hidden self-start w-full">
          <div className="px-3 py-2 border-b border-slate-800 text-[10px] font-bold uppercase tracking-widest text-slate-500">Watched · {rows.length}</div>
          <ul className="lg:block flex overflow-x-auto lg:overflow-visible">
            {rows.map((r) => {
              const c = r.primary;
              const isSel = r.country === selected;
              return (
                <li key={r.country}>
                  <button onClick={() => setSelected(r.country)} className={`w-full text-left flex items-center gap-2 px-3 py-2.5 border-l-2 transition-colors whitespace-nowrap ${isSel ? "bg-slate-800/70 border-l-amber-400" : "border-l-transparent hover:bg-slate-800/40"}`}>
                    <span style={{ color: SEV_DOT[c.composite as Sev] }} className="text-[11px]">●</span>
                    <span className="text-[13px] font-medium text-slate-200 flex-1 min-w-0 truncate">{r.country}</span>
                    {r.base && <span className="text-[9px]" title={`pinned airfield: ${r.base.label}${r.base.icao ? ` (${r.base.icao})` : ""}`}>🛡</span>}
                    {c.previousComposite && c.previousComposite !== c.composite && (
                      <span className={`text-[8px] font-bold ${SEV_RANK[c.composite as Sev] < SEV_RANK[c.previousComposite as Sev] ? "text-red-400" : "text-emerald-400"}`}>{SEV_RANK[c.composite as Sev] < SEV_RANK[c.previousComposite as Sev] ? "▲" : "▼"}</span>
                    )}
                    <span className="text-[8px] font-bold tracking-wider text-slate-500">{(COCOM_LABEL[c.cocom] ?? c.cocom).replace("US", "")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0 space-y-3">
          {!sel && <p className="text-[12px] text-slate-500 px-1">{loading ? "Loading…" : "Select a country."}</p>}
          {sel && (
            <>
              {/* Header */}
              <div className="border border-slate-800 rounded-xl bg-slate-900/40 px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
                <span className="text-lg">🌐</span>
                <h3 className="text-base font-bold text-slate-100">{sel.country}</h3>
                <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">{COCOM_LABEL[sel.cocom] ?? sel.cocom}</span>
                <span style={{ color: SEV_DOT[sel.composite as Sev] }} className="text-[13px]">●</span>
                <span className={`text-[11px] font-mono font-bold ${SEV_TEXT[sel.composite as Sev]}`}>{sel.composite.toUpperCase()}</span>
                {sel.previousComposite && sel.previousComposite !== sel.composite && <span className="text-[9px] text-slate-500">(was {sel.previousComposite.toUpperCase()})</span>}
                {baseForSel && <span className="text-[10px] font-mono text-slate-500 ml-auto">pinned base: {baseForSel.label}{baseForSel.icao ? ` (${baseForSel.icao})` : ""}</span>}
              </div>

              {/* AI SITREP */}
              <Card title="✦ AI SITREP" meta={sLoading ? "reading…" : undefined}>
                {sLoading && <p className="text-[12px] text-slate-500">Generating ground situation read…</p>}
                {!sLoading && sitrep && <pre className="text-[12.5px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{sitrep}</pre>}
              </Card>

              {/* Security incidents — list + mini-map */}
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
                              <span className="text-[10px] font-mono text-slate-600 flex-shrink-0">{i.km == null ? "in-country" : `~${i.km}km`} · {i.src.toUpperCase()}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </Card>

              {/* Local news */}
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

              {/* Civil + Health/Access */}
              <div className="grid md:grid-cols-2 gap-3">
                <Card title="⚖ Civil / political">
                  {dLoading && <p className="text-[12px] text-slate-500">Loading…</p>}
                  {!dLoading && dossier && (() => {
                    const cv = dossier.civil;
                    const hasAny = cv.advisoryLevel != null || cv.departure || cv.events.length > 0;
                    if (!hasAny) return <CatLines c={cat(sel, "civil")} />;
                    return (
                      <ul className="space-y-1.5">
                        {cv.advisoryLevel != null && (
                          <li className="text-[12px] flex items-start gap-1.5">
                            <span style={{ color: ADV_DOT[cv.advisoryLevel] ?? "#94a3b8" }} className="mt-0.5 text-[8px]">●</span>
                            <span className="text-slate-300"><b className="text-slate-200">State advisory:</b> Level {cv.advisoryLevel}{ADV_LABEL[cv.advisoryLevel] ? <> — <span className={ADV_COLOR[cv.advisoryLevel]}>{ADV_LABEL[cv.advisoryLevel]}</span></> : null}{cv.advisoryLink && <a href={cv.advisoryLink} target="_blank" rel="noopener noreferrer" className="ml-1.5 text-[10px] text-violet-300/80 hover:text-violet-200">State ↗</a>}</span>
                          </li>
                        )}
                        {cv.departure && <li className="text-[12px] text-red-400 flex items-start gap-1.5"><span className="text-[8px] mt-0.5">◆</span><span>{cv.departure === "ordered" ? "Ordered" : "Authorized"} departure in effect</span></li>}
                        {cv.events.map((e, i) => (
                          <li key={i} className="text-[12px] text-slate-300 flex items-start gap-1.5"><span className="text-amber-400 text-[8px] mt-0.5">●</span><span>{e.label} — {e.when}</span></li>
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

              <p className="text-[9px] text-slate-600 px-1">Coarse open-source SA — not authoritative tasking.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
