"use client";

import { useEffect, useState, useMemo } from "react";
// Type-only import: keeps the server-side scoring module (which pulls disasters/
// acled/etc.) OUT of this client bundle. Runtime data comes from the API.
import type { ForceAssessment, Severity, ForceCategory } from "@/lib/forceProtection";
import { getForceProtectionData, type FpResponse } from "@/lib/forceProtectionClient";

// Local label/colour vocab (not imported from the server lib, to avoid bundling
// it). COCOM labels mirror lib/aor's AOR_LABELS.
const CAT_LABEL: Record<ForceCategory, string> = {
  conflict: "Conflict", weather: "Aviation Wx", gps: "GPS / Comms", airspace: "Airspace / NOTAM", civil: "Civil / Diplomatic", hazard: "Hazard",
};
const COCOM_LABEL: Record<string, string> = {
  NORTHCOM: "USNORTHCOM", SOUTHCOM: "USSOUTHCOM", EUCOM: "USEUCOM",
  CENTCOM: "USCENTCOM", AFRICOM: "USAFRICOM", INDOPACOM: "USINDOPACOM", UNKNOWN: "—",
};

const SEV_DOT: Record<Severity, string> = { red: "#ef4444", amber: "#fbbf24", green: "#10b981", unknown: "#64748b" };
const SEV_TEXT: Record<Severity, string> = { red: "text-red-400", amber: "text-amber-400", green: "text-emerald-400", unknown: "text-slate-400" };
const SEV_BORDER: Record<Severity, string> = { red: "border-l-red-500/70", amber: "border-l-amber-500/70", green: "border-l-emerald-500/40", unknown: "border-l-slate-500/50" };
// Sort order for the board: red first, then amber, then UNKNOWN blind spots,
// then green.
const SEV_RANK: Record<Severity, number> = { red: 0, amber: 1, unknown: 2, green: 3 };

function Card({ a }: { a: ForceAssessment }) {
  const [open, setOpen] = useState(false);
  const elevated = a.categories.filter((c) => c.severity !== "green");
  // Clicking a card expands its signals AND flies the Crisis map to the entry
  // (the map listens for crisis-map:flyto). Skip the fly when we have no real
  // coords (e.g. a country whose centroid isn't known → lat/lon 0,0).
  const onClick = () => {
    setOpen((v) => !v);
    if (!(a.lat === 0 && a.lon === 0)) {
      window.dispatchEvent(new CustomEvent("crisis-map:flyto", { detail: { id: a.id, lat: a.lat, lon: a.lon } }));
    }
  };
  return (
    <li className={`border-l-2 ${SEV_BORDER[a.composite]} bg-slate-800/40 rounded-r-md`}>
      <button onClick={onClick} className="w-full text-left px-3 py-2 flex items-start gap-2.5">
        <span className="mt-1 flex-shrink-0" style={{ color: SEV_DOT[a.composite] }}>●</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="flex-shrink-0" title={a.kind === "country" ? "Country of interest" : "Pinned base"}>{a.kind === "country" ? "🌐" : "🛡"}</span>
            <span className="text-sm font-semibold text-slate-100">{a.label}</span>
            {a.icao && <span className="text-[9px] font-mono text-slate-400 bg-slate-900/60 px-1 rounded">{a.icao}</span>}
            <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">{COCOM_LABEL[a.cocom] ?? a.cocom}</span>
            {a.transient && <span className="text-[8px] uppercase tracking-wider text-amber-400/80" title="Transient presence window">◷ transient</span>}
            {a.previousComposite && a.previousComposite !== a.composite && (() => {
              const worse = SEV_RANK[a.composite] < SEV_RANK[a.previousComposite]; // lower rank index = more severe
              return <span className={`text-[8px] font-bold ${worse ? "text-red-400" : "text-emerald-400"}`} title={`Changed from ${a.previousComposite.toUpperCase()} since yesterday`}>{worse ? "▲" : "▼"} from {a.previousComposite.toUpperCase()}</span>;
            })()}
            {/* Per-category severity dots */}
            <span className="ml-auto flex items-center gap-0.5">
              {a.categories.map((c) => (
                <span key={c.category} title={`${CAT_LABEL[c.category]}: ${c.severity}${c.signals.length ? ` — ${c.signals.join("; ")}` : ""}`} style={{ color: SEV_DOT[c.severity] }} className="text-[8px]">●</span>
              ))}
            </span>
          </div>
          <p className={`text-[11px] mt-0.5 ${SEV_TEXT[a.composite]}`}>{a.topDriver}</p>
          <p className="text-[10px] text-slate-500 truncate">{a.country || "—"}{a.note ? ` · ${a.note}` : ""}</p>
        </div>
        {elevated.length > 0 && <span className="text-slate-600 text-[10px] mt-0.5">{open ? "▲" : "▼"}</span>}
      </button>
      {open && elevated.length > 0 && (
        <div className="px-3 pb-2.5 pt-0 ml-5 space-y-1">
          {elevated.map((c) => (
            <div key={c.category} className="text-[11px]">
              <span style={{ color: SEV_DOT[c.severity] }} className="mr-1">●</span>
              <span className="text-slate-300 font-semibold">{CAT_LABEL[c.category]}</span>
              <span className="text-slate-500"> — {c.signals.join("; ") || c.severity}</span>
              {c.links?.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1.5 text-[10px] text-violet-300/80 hover:text-violet-200 whitespace-nowrap" title={`Open ${l.label}`}>{l.label} ↗</a>
              ))}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

// `cocomFilter` (optional) lets a parent — the Crisis map's AOR dropdown — drive
// the filter so the two surfaces share one control; when omitted the board shows
// its own COCOM selector (standalone use).
// Source-health dot: green=live, red=unavailable (UNKNOWN, never "clear"),
// grey=not configured / no data.
function SrcDot({ label, state }: { label: string; state: "live" | "down" | "off" }) {
  const color = state === "live" ? "#10b981" : state === "down" ? "#ef4444" : "#64748b";
  const title = state === "live" ? "live" : state === "down" ? "unavailable — status UNKNOWN, not 'all clear'" : "not configured / no data";
  return <span className="flex items-center gap-0.5 text-slate-500" title={`${label}: ${title}`}><span style={{ color }}>●</span>{label}</span>;
}

export default function ForceWatchBoard({ cocomFilter: controlledFilter }: { cocomFilter?: string } = {}) {
  const [data, setData] = useState<FpResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [internalFilter, setInternalFilter] = useState<string>("ALL");
  const cocomFilter = controlledFilter ?? internalFilter;
  // AI read
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const load = (force = false) => {
    setLoading(true);
    getForceProtectionData(force)
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    // The shared client invalidates its cache on this event, so a plain reload
    // refetches fresh.
    const onChange = () => load();
    window.addEventListener("force-locations:changed", onChange);
    return () => window.removeEventListener("force-locations:changed", onChange);
  }, []);

  const runRead = () => {
    setAiLoading(true); setAiText(null);
    fetch("/api/force-read")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { text?: string; disabled?: boolean; empty?: boolean } | null) =>
        setAiText(d?.disabled ? "AI features are off (no API key configured)." : d?.text || "Couldn't generate a read."))
      .catch(() => setAiText("Read failed — a data feed may be unavailable."))
      .finally(() => setAiLoading(false));
  };

  const all = data?.assessments ?? [];
  const cocoms = useMemo(() => Array.from(new Set(all.map((a) => a.cocom))).sort(), [all]);
  const shown = useMemo(
    () => (cocomFilter === "ALL" ? all : all.filter((a) => a.cocom === cocomFilter))
      .slice().sort((a, b) => SEV_RANK[a.composite] - SEV_RANK[b.composite] || b.score - a.score),
    [all, cocomFilter],
  );
  const counts = useMemo(() => ({
    red: all.filter((a) => a.composite === "red").length,
    amber: all.filter((a) => a.composite === "amber").length,
    // Locations with any blind-spot (unknown) category — including those green
    // overall but missing a feed.
    blind: all.filter((a) => a.categories.some((c) => c.severity === "unknown")).length,
  }), [all]);

  const empty = !loading && all.length === 0;

  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 flex-wrap sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-300">Force Protection Watch</span>
        {!empty && !loading && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1.5">
            {counts.red > 0 && <span className="text-red-400">{counts.red} red</span>}
            {counts.amber > 0 && <span className="text-amber-400">{counts.amber} amber</span>}
            {counts.red === 0 && counts.amber === 0 && counts.blind === 0 && <span className="text-emerald-400">all clear</span>}
            {counts.blind > 0 && <span className="text-slate-400" title="Locations with a feed unavailable — status unknown, not confirmed clear">{counts.blind} blind</span>}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {/* Internal COCOM selector only when not parent-controlled. */}
          {controlledFilter === undefined && cocoms.length > 1 && (
            <select
              value={internalFilter}
              onChange={(e) => setInternalFilter(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-300 px-1.5 py-1 outline-none"
              title="Filter by combatant command"
            >
              <option value="ALL">All COCOMs</option>
              {cocoms.map((c) => <option key={c} value={c}>{COCOM_LABEL[c] ?? c}</option>)}
            </select>
          )}
          {!empty && (
            <button onClick={runRead} disabled={aiLoading} title="AI force-protection read — where to focus to protect your forces (distinct from the map's mobility Demand read)" className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-violet-500/40 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 disabled:opacity-40">
              {aiLoading ? "Reading…" : "✦ Force read"}
            </button>
          )}
          <button onClick={() => load(true)} title="Refresh" className="text-[10px] text-slate-500 hover:text-slate-300 px-1">↻</button>
        </div>
      </div>

      {aiText && (
        <div className="px-3 py-2 border-b border-slate-800 bg-violet-500/5">
          <pre className="text-[11px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{aiText}</pre>
        </div>
      )}

      {loading && <p className="px-3 py-4 text-[11px] text-slate-500">Assessing watched locations…</p>}

      {empty && (
        <p className="px-3 py-4 text-[11px] text-slate-500">
          No countries watched yet. Add <span className="text-slate-400">Countries of Interest</span> (and optional pinned bases) in
          Preferences → Content sources to monitor conflict, civil/diplomatic posture, health, and risk where your forces operate.
        </p>
      )}

      {!loading && shown.length > 0 && (
        <ul className="divide-y divide-slate-800/60">
          {shown.map((a) => <Card key={a.id} a={a} />)}
        </ul>
      )}

      {data?.sources && all.length > 0 && (
        <div className="px-3 py-1.5 text-[9px] border-t border-slate-800 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="uppercase tracking-wider text-slate-500 font-bold">Feeds</span>
          <SrcDot label={`Conflict${data.sources.conflict !== "none" ? ` (${data.sources.conflict.toUpperCase()})` : ""}`} state={data.sources.conflict === "none" ? "off" : "live"} />
          <SrcDot label="ACLED" state={data.sources.acled ? "live" : "off"} />
          <SrcDot label="Aviation Wx" state={data.sources.aviationWx ? "live" : "off"} />
          <SrcDot label="GPS (GPSJam)" state={data.sources.gps ? "live" : "down"} />
          <SrcDot label="NOTAMs (DAIP)" state={data.sources.notams === "live" ? "live" : data.sources.notams === "down" ? "down" : "off"} />
          <span className="text-slate-600">+ keyless: INFORM · State advisories · civil calendar · WHO health · weather</span>
          <span className="text-slate-600 w-full">Coarse open-source SA — not authoritative tasking.</span>
        </div>
      )}
    </div>
  );
}
