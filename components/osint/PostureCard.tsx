"use client";

import { useEffect, useState } from "react";
import { clientCache } from "@/lib/clientCache";
import { LED_HEX } from "@/lib/levelTokens";
import { ASSET_CLASS_LABEL, FLEET_AS_OF } from "@/lib/counterspace";
import { relTime } from "@/lib/relTime";
import { AssetsOfInterestInline } from "@/components/preferences/SpectrumInline";

// The Posture card — one actor's standing in space and cyber, for the
// country room (Russia, China) and, compacted, the SITREP Spectrum card
// (docs/PLAN-SPACE-CYBER-ASK.md §2.4, §3). Reads the Spectrum summary's
// `postures` (deterministic, server-cached) — no fetch of its own beyond
// /api/spectrum, no model call.
//
// Order on the card is the doctrine: the STANDING PROGRAMME first (the fleet
// table — this is posture, it is old), then WHAT CHANGED (the board's read:
// manoeuvres, a plane match, an approach), then the distance trend, then
// cyber posture. UNKNOWN is stated: an unconfigured catalogue says so and
// the read runs on reporting alone.

type Led = "g" | "a" | "r" | "u";
interface Read { state: string; confidence: number; led: Led; board: string; problemId: string; why: string; live: boolean }
interface Manoeuvre { noradId: number; name: string; atISO: string; dAKm: number; dIncDeg: number; dRaanResidualDeg: number; kind: string }
interface FleetRow { name: string; noradId: number; programme: string; note: string; epoch: string | null; altitudeKm: number | null; inclination: number | null; lastManoeuvre: Manoeuvre | null; nearest: { asset: string; assetClass: keyof typeof ASSET_CLASS_LABEL; minRangeKm: number; atISO: string } | null; coPlanarWith: string[] }
interface Posture {
  actor: "RUS" | "CHN"; country: string;
  board: { problemId: string; label: string } | null;
  counterspace: Read | null;
  catalogue: {
    live: boolean; configured: boolean; reason: string | null; fleet: FleetRow[]; unresolvedFleet: string[];
    assets: { declared: number; resolvedObjects: number; unresolved: string[] };
    manoeuvres14: number; cadencePer14: number | null; cadenceSamples: number;
    coPlanar: { inspector: string; asset: string; assetClass: keyof typeof ASSET_CLASS_LABEL; declared: boolean }[];
    proximity: { inspector: string; asset: string; assetClass: keyof typeof ASSET_CLASS_LABEL; declared: boolean; minRangeKm: number; hoursWithin50: number; atISO: string }[];
    closestKm: number | null; proxSeries: { day: string; value: number }[]; generatedAt: string;
  } | null;
  cyber: { posture: string; why: string; counts: { preparation: number; espionage: number; disruptive: number; ddos: number; ransom: number; elsewhere: number } } | null;
}
interface Summary { pending?: boolean; postures?: Posture[]; counterspace?: Read | null }

const KEY = "spectrum:summary";

/** The Spectrum summary, shared through the client cache (5 min); a
 *  `pending` body is re-asked once after 10 s. */
export function useSpectrumSummary(): Summary | null {
  const [sum, setSum] = useState<Summary | null>(() => clientCache.peek<Summary>(KEY));
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = () => fetch("/api/spectrum").then((r) => (r.ok ? r.json() : null)).then((d: Summary | null) => {
      if (!alive || !d) return;
      setSum(d);
      if (d.pending) retry = setTimeout(load, 10_000);
      else clientCache.set(KEY, d, 5 * 60 * 1000);
    }).catch(() => {});
    if (!clientCache.peek<Summary>(KEY)) load();
    return () => { alive = false; if (retry) clearTimeout(retry); };
  }, []);
  return sum;
}

const STATE_CLS: Record<string, string> = {
  confirmed: "text-red-200 border-red-500/55 bg-red-500/15",
  active: "text-amber-200 border-amber-500/50 bg-amber-500/10",
  watching: "text-amber-200/80 border-amber-500/30 bg-amber-500/5",
  dormant: "text-slate-400 border-slate-700",
};
const POSTURE_CLS: Record<string, string> = {
  preparation: "text-red-200 border-red-500/55 bg-red-500/15",
  "sustained pressure": "text-amber-200 border-amber-500/50 bg-amber-500/10",
  demonstration: "text-sky-200 border-sky-500/40 bg-sky-500/10",
  quiet: "text-slate-400 border-slate-700",
  unknown: "text-slate-500 border-slate-800",
};

const km = (v: number) => (v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(v < 10 ? 1 : 0)} km`);

function Spark({ series }: { series: { day: string; value: number }[] }) {
  if (series.length < 3) return null;
  const max = Math.max(...series.map((p) => p.value), 1);
  return (
    <span className="inline-flex items-end gap-px h-3 align-middle" title={`closest range to a declared asset, ${series.length} observed days (log scale)`}>
      {series.map((p) => {
        const h = Math.max(2, Math.round((Math.log10(1 + p.value) / Math.log10(1 + max)) * 12));
        return <span key={p.day} className={`w-[3px] rounded-[1px] ${p.value <= 50 ? "bg-red-400" : p.value <= 500 ? "bg-amber-400/80" : "bg-slate-600"}`} style={{ height: `${h}px` }} />;
      })}
    </span>
  );
}

export function openBoard(problemId: string) {
  window.dispatchEvent(new CustomEvent("app:navigate", { detail: "osint" }));
  window.dispatchEvent(new CustomEvent("osint:set-pane", { detail: "commands" }));
  setTimeout(() => window.dispatchEvent(new CustomEvent("watch:focus", { detail: { kind: "iw", id: problemId } })), 80);
}

/** Full card for the country room. Renders nothing when the summary carries
 *  no posture for the country (no board watches the actor). */
export default function PostureCard({ country, compact = false }: { country: string; compact?: boolean }) {
  const sum = useSpectrumSummary();
  const [fleetOpen, setFleetOpen] = useState(false);
  const p = sum?.postures?.find((x) => x.country.toLowerCase() === country.toLowerCase());
  if (!sum) return <p className="text-[10.5px] text-slate-600 px-1">Loading the space &amp; cyber posture…</p>;
  if (!p) return null;
  const cat = p.catalogue;
  const read = p.counterspace;
  const led: Led = read && read.live ? read.led : "u";
  const generated = cat?.generatedAt ? relTime(cat.generatedAt) : null;

  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 bg-slate-800/30 flex-wrap">
        <span className="text-[8px]" style={{ color: LED_HEX[led] }}>●</span>
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Posture — space &amp; cyber · {p.country}</span>
        {read && <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${STATE_CLS[read.state] ?? STATE_CLS.dormant}`}>{read.live ? `counterspace ${read.state}` : "counterspace UNKNOWN"}</span>}
        {p.cyber && <span className={`text-[8px] font-bold uppercase tracking-wider px-1 rounded border ${POSTURE_CLS[p.cyber.posture] ?? POSTURE_CLS.unknown}`}>cyber {p.cyber.posture}</span>}
        {p.board && <button type="button" onClick={() => openBoard(p.board!.problemId)} className="ml-auto text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-sky-300" title={`Open the I&W board — ${p.board.label}`}>board →</button>}
      </div>

      <div className="px-3 py-2 space-y-2 text-[11px] text-slate-300">
        {/* The standing programme — posture, old by design. */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Standing programme <span className="font-normal normal-case tracking-normal text-slate-600">— posture, not warning</span></p>
          {!cat && <p className="text-slate-500">Catalogue read unavailable this pass.</p>}
          {cat && !cat.configured && <p className="text-slate-400">Space-Track not configured — the inspector fleet is read from reporting only. Set <span className="font-mono">SPACETRACK_USER</span> / <span className="font-mono">SPACETRACK_PASS</span> (free account) to read the catalogue; <span className="font-mono">/api/spectrum?diag=1</span> tests it.</p>}
          {cat && cat.configured && !cat.live && <p className="text-amber-200/80">Catalogue UNREACHABLE — {cat.reason ?? "no element sets"}. Reporting only; the fleet's positions are UNKNOWN, not quiet.</p>}
          {cat && (
            <p className="text-slate-400">
              {cat.fleet.length} tracked inspector{cat.fleet.length === 1 ? "" : "s"}{cat.unresolvedFleet.length ? ` (${cat.unresolvedFleet.length} unresolved in the catalogue: ${cat.unresolvedFleet.slice(0, 3).join(", ")}${cat.unresolvedFleet.length > 3 ? "…" : ""})` : ""}
              {" · "}{cat.assets.declared} declared asset{cat.assets.declared === 1 ? "" : "s"} → {cat.assets.resolvedObjects} catalogue object{cat.assets.resolvedObjects === 1 ? "" : "s"}
              {cat.cadencePer14 != null ? ` · ~${cat.cadencePer14.toFixed(1)} fleet manoeuvres per 14 d over ${cat.cadenceSamples} observed days` : ` · manoeuvre cadence forming (${cat.cadenceSamples}/14 days)`}
              {generated ? ` · catalogue read ${generated}` : ""}
            </p>
          )}
          {cat && cat.fleet.length > 0 && !compact && (
            <>
              <button type="button" onClick={() => setFleetOpen((v) => !v)} aria-expanded={fleetOpen} className="text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 mt-0.5">fleet {fleetOpen ? "▴" : "▾"}</button>
              {fleetOpen && (
                <div className="mt-1 overflow-x-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead><tr className="text-slate-600 text-left"><th className="pr-2 font-normal">object</th><th className="pr-2 font-normal">prog.</th><th className="pr-2 font-normal">orbit</th><th className="pr-2 font-normal">last manoeuvre</th><th className="pr-2 font-normal">nearest declared asset</th></tr></thead>
                    <tbody>
                      {cat.fleet.map((f) => (
                        <tr key={f.noradId} className="border-t border-slate-800/60 align-top" title={f.note}>
                          <td className="pr-2 py-0.5 text-slate-200 whitespace-nowrap">{f.name}<span className="text-slate-600"> {f.noradId}</span></td>
                          <td className="pr-2 py-0.5 text-slate-500 whitespace-nowrap">{f.programme}</td>
                          <td className="pr-2 py-0.5 text-slate-400 whitespace-nowrap">{f.altitudeKm != null ? `${f.altitudeKm} km · ${f.inclination}°` : "no element set"}</td>
                          <td className="pr-2 py-0.5 text-slate-400 whitespace-nowrap">{f.lastManoeuvre ? `${f.lastManoeuvre.kind} · ${relTime(f.lastManoeuvre.atISO)}${f.lastManoeuvre.dAKm ? ` · Δa ${f.lastManoeuvre.dAKm > 0 ? "+" : ""}${f.lastManoeuvre.dAKm} km` : ""}${Math.abs(f.lastManoeuvre.dIncDeg) >= 0.05 ? ` · Δi ${f.lastManoeuvre.dIncDeg}°` : ""}` : "none in 35 d"}</td>
                          <td className="pr-2 py-0.5 whitespace-nowrap">
                            {f.nearest ? <span className={f.nearest.minRangeKm <= 50 ? "text-red-300" : f.nearest.minRangeKm <= 500 ? "text-amber-200" : "text-slate-400"}>{f.nearest.asset} · {km(f.nearest.minRangeKm)}</span> : <span className="text-slate-600">no pair swept</span>}
                            {f.coPlanarWith.length > 0 && <span className="text-amber-200/80"> · co-planar: {f.coPlanarWith.slice(0, 2).join(", ")}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* What changed — the board's read. */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">What changed <span className="font-normal normal-case tracking-normal text-slate-600">— the board&apos;s read</span></p>
          {read ? (
            <p className={read.live ? "text-slate-200" : "text-slate-500"}>{read.live ? read.why.replace(/^.*? — /, "") : "counterspace indicator UNKNOWN — catalogue and reporting both dead this pass"}</p>
          ) : <p className="text-slate-500">No board carries the counterspace indicator for {p.country} this pass.</p>}
          {cat && cat.proximity.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {cat.proximity.slice(0, compact ? 2 : 5).map((x, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className={`text-[8px] mt-1 ${x.minRangeKm <= 5 ? "text-red-400" : "text-amber-400"}`}>●</span>
                  <span className="flex-1"><b>{x.inspector}</b> within {km(x.minRangeKm)} of {x.asset} ({ASSET_CLASS_LABEL[x.assetClass]}{x.declared ? "" : " — not declared, caps at watching"}){x.hoursWithin50 >= 24 ? ` · ${x.hoursWithin50.toFixed(0)} h inside 50 km — shadowing` : ""} · closest {relTime(x.atISO)}</span>
                </li>
              ))}
            </ul>
          )}
          {cat && cat.coPlanar.length > 0 && cat.proximity.length === 0 && (
            <p className="text-amber-200/80 mt-0.5">{cat.coPlanar.slice(0, 3).map((c) => `${c.inspector} co-planar with ${c.asset}${c.declared ? "" : " (undeclared)"}`).join(" · ")} — positioning, the May step of the Kosmos 2612 case.</p>
          )}
          {cat && cat.proxSeries.length >= 3 && (
            <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5"><span className="text-[8px] font-bold uppercase tracking-wider text-slate-600">Range trend</span> <Spark series={cat.proxSeries} /> <span>closest {cat.closestKm != null ? km(cat.closestKm) : "—"} today · {cat.proxSeries.length} observed days</span></p>
          )}
        </div>

        {/* Cyber posture. */}
        {p.cyber && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Cyber posture <span className="font-normal normal-case tracking-normal text-slate-600">— demonstration · preparation · sustained pressure</span></p>
            <p className={p.cyber.posture === "unknown" ? "text-slate-500" : "text-slate-200"}>{p.cyber.why}</p>
            <p className="text-[9.5px] text-slate-600 mt-0.5">pre-positioning {p.cyber.counts.preparation} · espionage {p.cyber.counts.espionage} · disruptive {p.cyber.counts.disruptive} · DDoS {p.cyber.counts.ddos} · ransom {p.cyber.counts.ransom}{p.cyber.counts.elsewhere ? ` · elsewhere ${p.cyber.counts.elsewhere} (named, not ranked)` : ""} · 30 d, acts and advisories only</p>
          </div>
        )}

        {!compact && (
          <details className="text-[10px]">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-300 select-none">⚙ assets of interest ({cat?.assets.declared ?? "?"})</summary>
            <div className="mt-1"><AssetsOfInterestInline /></div>
          </details>
        )}
        <p className="text-[9px] text-slate-600">Posture is the standing programme; warning is the change — a manoeuvre, a plane match with a declared asset, a closing range, a corroborated report. Intent is never inferred here. Fleet catalogue as of {FLEET_AS_OF} (open reporting; refreshed quarterly). Space-Track element sets · SGP4 · GDELT + own sources · USSF statements. UNKNOWN ≠ clear.</p>
      </div>
    </section>
  );
}
