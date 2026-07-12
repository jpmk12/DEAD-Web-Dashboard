"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SitrepPayload, SitrepSummary } from "@/lib/sitrep";
import type { SitrepBase, FlightCategory } from "@/lib/types";
import { closureWindows, windowConflicts, type Led, type ClosureWindow } from "@/lib/sitrepSignals";
import { renderSitrepHtml } from "@/lib/sitrepExport";
import SitrepMissionImpact from "@/components/osint/SitrepMissionImpact";

const LED_CLASS: Record<Led, string> = {
  g: "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70",
  a: "bg-amber-400 shadow-[0_0_8px] shadow-amber-400/70",
  r: "bg-red-500 shadow-[0_0_8px] shadow-red-500/70",
  u: "bg-slate-600",
};

const CAT_COLOR: Record<FlightCategory, string> = {
  VFR: "border-emerald-400 text-emerald-300",
  MVFR: "border-sky-400 text-sky-300",
  IFR: "border-red-400 text-red-300",
  LIFR: "border-fuchsia-400 text-fuchsia-300",
  UNKNOWN: "border-slate-600 text-slate-500",
};

const SEG_BG: Record<FlightCategory, string> = {
  VFR: "bg-emerald-500 text-slate-950",
  MVFR: "bg-sky-500 text-slate-950",
  IFR: "bg-red-500 text-white",
  LIFR: "bg-fuchsia-500 text-white",
  UNKNOWN: "bg-slate-700 text-slate-400",
};

const LAST_BASE_KEY = "sitrep-last-base";

// Inline ARTCC setter shown in the Ops card when a base has no center
// configured. Saves via the bases route ("artcc" op).
function CenterInput({ icao, onSaved }: { icao: string; onSaved: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const code = v.trim().toUpperCase();
    if (!/^[A-Z]{3,4}$/.test(code) || busy) return;
    setBusy(true);
    try {
      await fetch("/api/sitrep/bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "artcc", icao, artcc: code }),
      });
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={v}
        onChange={(e) => setV(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        maxLength={4}
        placeholder="ZNY"
        className="w-14 bg-slate-950 border border-slate-800 focus:border-emerald-500/40 rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-200 placeholder-slate-700 outline-none uppercase"
      />
      <button onClick={save} disabled={busy || !/^[A-Za-z]{3,4}$/.test(v.trim())} className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-500/40 rounded px-1.5 py-0.5 disabled:opacity-30">
        {busy ? "…" : "Set"}
      </button>
    </span>
  );
}

// One-line driver text for the Infrastructure status tile.
function infraSummary(p: SitrepPayload): string {
  const inf = p.infra;
  if (!inf.internet.live && !inf.nas?.live) return "sensors unreachable — UNKNOWN";
  if (inf.internet.led === "r" || inf.internet.led === "a") return "internet degradation detected";
  const hot = inf.nas?.nearby.find((x) => x.kind === "closure" || x.kind === "groundStop");
  if (hot) return `NAS: ${hot.kind === "closure" ? "closure" : "ground stop"} at ${hot.airport}`;
  if (inf.powerNews.length > 0) return "power reporting in local news";
  return "no degradation detected";
}

function SectionCard({ led, title, sources, children }: { led: Led; title: string; sources: string; children: React.ReactNode }) {
  const [folded, setFolded] = useState(false);
  return (
    <div className="border border-slate-800 bg-slate-900/40 rounded-xl overflow-hidden">
      <button onClick={() => setFolded((v) => !v)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800/70 text-left">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${LED_CLASS[led]}`} />
        <h3 className="text-[10.5px] font-bold uppercase tracking-widest text-slate-300">{title}</h3>
        <span className="text-[9px] text-slate-600 font-mono truncate">{sources}</span>
        <span className="ml-auto text-[9px] text-slate-600">{folded ? "▸" : "▾"}</span>
      </button>
      {!folded && <div className="px-3.5 py-3">{children}</div>}
    </div>
  );
}

function Row({ sev, children, src }: { sev: "g" | "a" | "r" | "u" | "b"; children: React.ReactNode; src: string }) {
  const dot = sev === "b" ? "bg-sky-400" : sev === "g" ? "bg-emerald-400" : sev === "a" ? "bg-amber-400" : sev === "r" ? "bg-red-500" : "bg-slate-600";
  return (
    <div className="flex items-start gap-2.5 py-1.5 border-b border-slate-800/40 last:border-b-0">
      <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${dot}`} />
      <div className="flex-1 min-w-0 text-xs text-slate-300 leading-relaxed">{children}</div>
      <span className="text-[8.5px] text-slate-600 font-mono flex-shrink-0 mt-0.5">{src}</span>
    </div>
  );
}

// The OSINT SITREP pane: a squadron commander's situation report for 1-4
// configured bases — weather, airfield ops, threats, and an AI BLUF, every
// row source-attributed and every gap an explicit UNKNOWN.
export default function SitrepPanel({ active }: { active: boolean }) {
  const [bases, setBases] = useState<SitrepBase[] | null>(null);
  const [icao, setIcao] = useState<string | null>(null);
  const [payload, setPayload] = useState<SitrepPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<{ bluf: string[]; watch: string[]; asks?: string[]; disabled?: boolean; ai?: boolean; reason?: string; detail?: string } | null>(null);
  const [readLoading, setReadLoading] = useState(false);
  const [readError, setReadError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // Multi-base LED strip: compact status for every configured base.
  const [summaries, setSummaries] = useState<Record<string, SitrepSummary>>({});
  // Closure-timeline row the user tapped open (reveals the NOTAM text — the only
  // way to see the cause on mobile, where the bar's hover tooltip doesn't exist).
  const [tlOpenLabel, setTlOpenLabel] = useState<string | null>(null);

  const loadSummaries = useCallback(() => {
    fetch("/api/sitrep/summary")
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d?.bases)) return;
        const map: Record<string, SitrepSummary> = {};
        for (const s of d.bases as SitrepSummary[]) map[s.icao] = s;
        setSummaries(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (active && bases !== null && bases.length > 0) loadSummaries();
  }, [active, bases, loadSummaries]);

  // Load configured bases once the pane is active.
  useEffect(() => {
    if (!active || bases !== null) return;
    fetch("/api/sitrep/bases")
      .then((r) => r.json())
      .then((d) => {
        const list: SitrepBase[] = Array.isArray(d.bases) ? d.bases : [];
        setBases(list);
        const last = localStorage.getItem(LAST_BASE_KEY);
        setIcao(list.some((b) => b.icao === last) ? last : list[0]?.icao ?? null);
      })
      .catch(() => setBases([]));
  }, [active, bases]);

  // Kick the Commander's Read for a base. A transient AI/JSON failure returns an
  // error → keep the block visible in an error state (Retry) instead of letting
  // it silently vanish, which reads as "it loaded then disappeared".
  const loadRead = useCallback((target: string) => {
    setReadLoading(true);
    setReadError(false);
    fetch("/api/sitrep/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icao: target }),
    })
      .then((r) => r.json())
      .then((rd) => {
        if (rd && !rd.error) { setRead(rd); setReadError(false); }
        else { setRead(null); setReadError(true); }
      })
      .catch(() => { setRead(null); setReadError(true); })
      .finally(() => setReadLoading(false));
  }, []);

  const loadSitrep = useCallback((target: string) => {
    setLoading(true);
    setError(null);
    setRead(null);
    setReadError(false);
    fetch(`/api/sitrep?icao=${target}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setPayload(d);
        // Kick the Commander's Read once the picture exists; server caches it.
        loadRead(target);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "SITREP failed"))
      .finally(() => setLoading(false));
    // The freshly assembled payload may have moved this base's LEDs — keep the
    // tile strip in step (server-side cache makes this cheap).
    loadSummaries();
  }, [loadSummaries, loadRead]);

  useEffect(() => {
    if (!active || !icao) return;
    try { localStorage.setItem(LAST_BASE_KEY, icao); } catch {}
    loadSitrep(icao);
  }, [active, icao, loadSitrep]);

  const addBase = async () => {
    const v = addInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(v)) { setAddError("4-char ICAO"); return; }
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch("/api/sitrep/bases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "add", icao: v }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setBases(d.bases);
      setIcao(v);
      setAddOpen(false);
      setAddInput("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setAddBusy(false);
    }
  };

  const removeBase = async (target: string) => {
    if (!confirm(`Remove ${target} from SITREP?`)) return;
    const res = await fetch("/api/sitrep/bases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "remove", icao: target }),
    }).then((r) => r.json()).catch(() => null);
    if (res?.bases) {
      setBases(res.bases);
      if (icao === target) setIcao(res.bases[0]?.icao ?? null);
    }
  };

  // Save the current SITREP as a dated doc (tags: sitrep + icao) so it feeds
  // the Docs Compose/collections workflow.
  const saveToDocs = async () => {
    if (!payload || saveState === "saving") return;
    setSaveState("saving");
    const p = payload;
    const led = (l: Led) => (l === "g" ? "GREEN" : l === "a" ? "AMBER" : l === "r" ? "RED" : "UNKNOWN");
    const md: string[] = [];
    md.push(`*Generated ${p.generatedAt.slice(0, 16).replace("T", " ")}Z · WX ${led(p.status.wx)} · OPS ${led(p.status.ops)} · THREAT ${led(p.status.threat)} · INFRA ${led(p.status.infra)}*`);
    if (read && read.bluf.length > 0) {
      md.push(`\n## BLUF\n`);
      for (const b of read.bluf) md.push(`- ${b}`);
      if (read.watch.length > 0) { md.push(`\n**Watch:**`); for (const w of read.watch) md.push(`- ${w}`); }
    }
    md.push(`\n## Weather`);
    if (p.weather.metarRaw) md.push(`\`${p.weather.metarRaw}\``);
    if (p.weather.tafWorst) md.push(`- TAF worst (24h): **${p.weather.tafWorst.worst}**`);
    for (const a of p.weather.alerts) md.push(`- [${a.severity}] ${a.event} — ${a.headline}`);
    for (const d of p.weather.outlook) md.push(`- ${d.date}: ${d.hiF ?? "?"}/${d.loF ?? "?"}°F, precip ${d.precipPct ?? "?"}%, wind ${d.windMph ?? "?"} mph`);
    md.push(`\n## Ops`);
    md.push(`- Field: ${p.ops.fieldClosed ? "CLOSED" : p.ops.limiting ? "LIMITED" : p.ops.configured && p.ops.live ? "OPEN" : "UNKNOWN"} · ${p.ops.notamCount} active NOTAMs${p.ops.capability ? ` · ${p.ops.capability.lengthFt} ft ${p.ops.capability.surface} (${p.ops.capability.cls})` : ""}`);
    for (const g of p.ops.groups) for (const n of g.items) md.push(`- ${n.amber ? "**" : ""}[${g.label}] ${n.text.slice(0, 200)}${n.amber ? "**" : ""}`);
    md.push(`\n## Infrastructure`);
    md.push(`- Internet (${p.infra.internet.entity ?? "region"}): ${p.infra.internet.live ? (p.infra.internet.led === "g" ? "no macro degradation" : p.infra.internet.series.filter((sr) => (sr.dropPct ?? 0) >= 50).map((sr) => `${sr.label} −${sr.dropPct}%`).join(", ") || "insufficient data") : "IODA UNREACHABLE — UNKNOWN"}`);
    if (p.infra.nas) md.push(`- FAA NAS: ${p.infra.nas.live ? `${p.infra.nas.counts.groundStops} GS / ${p.infra.nas.counts.groundDelays} GD / ${p.infra.nas.counts.closures} closures nationally` : "UNREACHABLE — UNKNOWN"}`);
    for (const pr of p.infra.nas?.nearby ?? []) md.push(`- ${pr.kind === "groundStop" ? "**GROUND STOP**" : pr.kind === "closure" ? "**CLOSURE**" : pr.kind} ${pr.airport} · ${pr.km} km — ${pr.reason}${pr.detail ? ` · ${pr.detail}` : ""}`);
    for (const n of p.infra.powerNews) md.push(`- Power (news-derived): ${n.title}`);
    for (const n of p.infra.commsNews) md.push(`- Comms (news-derived): ${n.title}`);
    md.push(`\n## Threats`);
    if (p.threats.fp) md.push(`- FP: **${p.threats.fp.composite.toUpperCase()}** — ${p.threats.fp.topDriver}`);
    for (const d of p.threats.disasters) md.push(`- [${d.severity}] ${d.type} ${d.km} km — ${d.title}`);
    for (const n of p.threats.news) md.push(`- ${n.title} *(matched: ${n.matched.join(", ")})*`);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `SITREP — ${p.base.icao} — ${p.generatedAt.slice(0, 10)}`,
          content: md.join("\n") + "\n",
          tags: ["sitrep", p.base.icao.toLowerCase()],
        }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("idle");
    }
  };

  // Download a self-contained HTML snapshot (zero scripts, zero external
  // resources) for sharing with people who have no dashboard access — opens
  // offline from a desktop / share drive / email attachment.
  const exportHtml = () => {
    if (!payload) return;
    const html = renderSitrepHtml(payload, read && read.bluf.length > 0 ? { bluf: read.bluf, watch: read.watch, asks: read.asks } : null);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SITREP-${payload.base.icao}-${payload.generatedAt.slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}Z.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Closure-window timeline (pure math over the payload the pane already has):
  // NOTAM B)/C) times → bars over the next 48 h, TAF categories on the same
  // axis, runway-closure × IFR overlaps called out.
  const tlNowMs = payload ? Date.parse(payload.generatedAt) : 0;
  const tlWindows = useMemo(
    () => (payload ? closureWindows(payload.ops.groups.flatMap((g) => g.items), tlNowMs, 48) : []),
    [payload, tlNowMs],
  );
  const tlConflicts = useMemo(
    () => (payload ? windowConflicts(tlWindows, payload.weather.tafSegments) : []),
    [payload, tlWindows],
  );
  const tlRows = useMemo(() => {
    const map = new Map<string, ClosureWindow[]>();
    for (const w of tlWindows) {
      const arr = map.get(w.label) ?? [];
      arr.push(w);
      map.set(w.label, arr);
    }
    return [...map.entries()];
  }, [tlWindows]);

  if (bases === null) {
    return <div className="p-6 text-xs text-slate-500">Loading SITREP config…</div>;
  }

  const currentBase = bases.find((b) => b.icao === icao) ?? null;

  return (
    <div className="space-y-3">
      {/* Multi-base LED strip — every configured base at a glance; click to
          open, double-click to remove. Tiles with a problem announce it. */}
      <div className="flex items-stretch gap-2 flex-wrap">
        {bases.map((b) => {
          const s = summaries[b.icao] ?? null;
          const worstLed: Led = s
            ? ((["r", "a", "g", "u"] as Led[]).find((l) => Object.values(s.status).includes(l)) ?? "u")
            : "u";
          return (
            <button
              key={b.icao}
              onClick={() => setIcao(b.icao)}
              onDoubleClick={() => removeBase(b.icao)}
              title={`${b.label} — double-click to remove`}
              className={`text-left flex-1 min-w-[150px] max-w-[230px] rounded-xl border px-3 py-2 transition-all ${
                icao === b.icao
                  ? "border-violet-400 bg-violet-500/15 ring-2 ring-violet-400/60 shadow-[0_0_14px_rgba(167,139,250,0.35)]"
                : worstLed === "r" ? "border-red-500/45 bg-slate-900/70 opacity-80 hover:opacity-100 hover:border-red-400/60"
                : worstLed === "a" ? "border-amber-500/45 bg-slate-900/70 opacity-80 hover:opacity-100 hover:border-amber-400/60"
                : "border-slate-800 bg-slate-900/70 opacity-80 hover:opacity-100 hover:border-slate-600"
              }`}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-[12px] font-extrabold tracking-wide text-slate-100">{b.icao}</span>
                {icao === b.icao && (
                  <span className="text-[7.5px] font-extrabold uppercase tracking-widest text-violet-300 border border-violet-400/50 bg-violet-500/20 rounded px-1 py-[1px]">Viewing</span>
                )}
                <span className="text-[8.5px] uppercase tracking-wider text-slate-600 truncate">{b.label.length > 18 ? b.label.slice(0, 17) + "…" : b.label}</span>
              </div>
              <div className="flex gap-2.5 mt-1.5">
                {(["wx", "ops", "threat", "infra"] as const).map((k) => (
                  <span key={k} className="flex flex-col items-center gap-0.5">
                    <span className={`w-2 h-2 rounded-full ${LED_CLASS[s?.status[k] ?? "u"]}`} />
                    <span className="text-[7px] font-bold tracking-widest text-slate-600">{k === "threat" ? "THR" : k === "infra" ? "INF" : k.toUpperCase()}</span>
                  </span>
                ))}
              </div>
              <p className={`text-[9.5px] mt-1 truncate ${worstLed === "r" ? "text-red-300" : worstLed === "a" ? "text-amber-300" : "text-slate-500"}`} title={s?.driver}>
                {s ? s.driver : "loading…"}
              </p>
              {s && s.worse.length > 0 && (
                <p className="text-[8.5px] text-amber-400 font-bold uppercase tracking-wider mt-0.5">↑ {s.worse.join(" · ")} worse than yesterday</p>
              )}
            </button>
          );
        })}
        {bases.length < 4 && (
          <div className="flex items-center gap-1.5">
            {addOpen ? (
              <>
                <input
                  value={addInput}
                  onChange={(e) => { setAddInput(e.target.value.toUpperCase()); setAddError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") addBase(); if (e.key === "Escape") { setAddOpen(false); setAddError(null); } }}
                  autoFocus
                  maxLength={4}
                  placeholder="ICAO"
                  className="w-20 bg-slate-900 border border-slate-700 focus:border-emerald-500/50 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-200 placeholder-slate-600 outline-none uppercase"
                />
                <button onClick={addBase} disabled={addBusy} className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-slate-950 px-2.5 py-1.5 rounded-lg disabled:opacity-40">
                  {addBusy ? "…" : "Add"}
                </button>
                {addError && <span className="text-[10px] text-red-400">{addError}</span>}
              </>
            ) : (
              <button onClick={() => setAddOpen(true)} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-dashed border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-all">
                ＋ Add base
              </button>
            )}
          </div>
        )}
        {payload && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[9px] text-slate-600 font-mono">as of {payload.generatedAt.slice(11, 16)}Z · 10 min cache</span>
            <button onClick={() => icao && loadSitrep(icao)} title="Refresh" className="text-[11px] text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 rounded-lg px-2 py-1 transition-all">↻</button>
            <button onClick={saveToDocs} disabled={saveState !== "idle"} title="Save this SITREP as a dated doc" className="text-[10px] font-bold uppercase tracking-wider border border-violet-500/40 text-violet-300 hover:text-violet-200 rounded-lg px-2.5 py-1 transition-all disabled:opacity-50">
              {saveState === "saved" ? "✓ Saved" : saveState === "saving" ? "Saving…" : "⧉ Save to Docs"}
            </button>
            <button onClick={exportHtml} title="Download a self-contained HTML snapshot to share — opens offline in any browser, no login needed" className="text-[10px] font-bold uppercase tracking-wider border border-sky-500/40 text-sky-300 hover:text-sky-200 rounded-lg px-2.5 py-1 transition-all">
              ⇩ Export HTML
            </button>
          </div>
        )}
      </div>

      {bases.length === 0 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center">
          <p className="text-sm font-bold text-slate-300 mb-1">No SITREP bases configured</p>
          <p className="text-xs text-slate-500">Add an ICAO above (hubs, gateways, and any OurAirports field resolve automatically).</p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 px-1">{error}</p>}
      {loading && !payload && (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-28 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse" />)}</div>
      )}

      {payload && currentBase && (
        <>
          <SitrepMissionImpact payload={payload} read={read} readLoading={readLoading} readError={readError} onRetryRead={() => icao && loadRead(icao)} onChanged={() => icao && loadSitrep(icao)} />

          {/* Status strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {([
              ["Weather", payload.status.wx, payload.weather.now ? `${payload.weather.now.flightCategory} now${payload.weather.tafWorst && payload.weather.tafWorst.worst !== payload.weather.now.flightCategory ? ` → ${payload.weather.tafWorst.worst} fcst` : ""}` : "no METAR"],
              ["Ops / Airfield", payload.status.ops, payload.ops.fieldClosed ? "FIELD CLOSED (NOTAM)" : payload.ops.limiting ? "limiting NOTAM active" : payload.ops.configured && payload.ops.live ? `${payload.ops.notamCount} NOTAMs, none limiting` : "DAIP unavailable — UNKNOWN"],
              ["Threat", payload.status.threat, payload.threats.fp ? payload.threats.fp.topDriver : "assessment unavailable"],
              ["Infrastructure", payload.status.infra, infraSummary(payload)],
            ] as [string, Led, string][]).map(([k, l, v]) => (
              <div key={k} className="flex items-center gap-2.5 bg-slate-900/50 border border-slate-800 rounded-xl px-3 py-2.5">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${LED_CLASS[l]}`} />
                <div className="min-w-0">
                  <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-500">{k}</p>
                  <p className="text-[11px] text-slate-200 font-medium truncate" title={v}>{v}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Last-7-days trend strip: one LED cluster per day (WX/OPS/THREAT). */}
          {payload.history.length > 1 && (
            <div className="flex items-center gap-2 px-1">
              <span className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600">Last {payload.history.length} days</span>
              <div className="flex gap-1.5">
                {payload.history.map((h) => (
                  <div key={h.day} title={`${h.day} — WX/OPS/THREAT`} className="flex flex-col items-center gap-0.5">
                    <div className="flex gap-0.5">
                      {([h.wx, h.ops, h.threat] as Led[]).map((l, i) => (
                        <span key={i} className={`w-1.5 h-1.5 rounded-full ${LED_CLASS[l]}`} />
                      ))}
                    </div>
                    <span className="text-[7px] text-slate-700 font-mono">{h.day.slice(8)}</span>
                  </div>
                ))}
              </div>
              {(() => {
                const RANK: Record<Led, number> = { u: 0, g: 1, a: 2, r: 3 };
                const prev = payload.history[payload.history.length - 2];
                const worseAxes = prev
                  ? (["wx", "ops", "threat"] as const).filter((k) => RANK[payload.status[k]] > RANK[prev[k]] && prev[k] !== "u")
                  : [];
                return worseAxes.length > 0
                  ? <span className="text-[9px] text-amber-400 font-bold uppercase tracking-wider">↑ {worseAxes.join(" · ")} worse than yesterday</span>
                  : null;
              })()}
            </div>
          )}

          {/* Supporting detail — the raw signal cards the mission-impact
              layer is derived from. Kept in full below the leadership picture. */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600">Supporting detail</span>
            <div className="flex-1 h-px bg-slate-800/70" />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            {/* WEATHER */}
            <SectionCard led={payload.status.wx} title="Weather Brief" sources="AWC METAR/TAF · NWS · Open-Meteo">
              <div className="flex items-center gap-3.5 mb-2.5">
                <div className={`w-12 h-12 rounded-full border-[3px] flex flex-col items-center justify-center flex-shrink-0 ${CAT_COLOR[payload.weather.now?.flightCategory ?? "UNKNOWN"]}`}>
                  <span className="text-[10px] font-bold">{payload.weather.now?.flightCategory ?? "—"}</span>
                  <span className="text-[6.5px] text-slate-500 tracking-widest">NOW</span>
                </div>
                <div className="min-w-0">
                  {payload.weather.current ? (
                    <>
                      <p className="text-[13px] font-bold text-slate-100">
                        {payload.weather.current.tempF ?? "—"}°F
                        {payload.weather.now?.windKt != null && <span className="font-normal text-slate-300"> · wind {payload.weather.now.windKt}kt{payload.weather.now.gustKt ? `G${payload.weather.now.gustKt}` : ""}</span>}
                      </p>
                      <p className="text-[10.5px] text-slate-500">
                        feels {payload.weather.current.feelsLikeF ?? "—"}° · vis {payload.weather.now?.visMi ?? "—"}mi · ceiling {payload.weather.now?.ceilingFt ? `${payload.weather.now.ceilingFt}ft` : "none"} · humidity {payload.weather.current.humidityPct ?? "—"}%
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-slate-500">Surface conditions unavailable</p>
                  )}
                </div>
              </div>
              {payload.weather.metarRaw && (
                <p className="text-[9.5px] font-mono text-slate-500 bg-slate-950/70 border border-slate-800/60 rounded-lg px-2.5 py-1.5 mb-2.5 overflow-x-auto whitespace-nowrap">{payload.weather.metarRaw}</p>
              )}
              {payload.weather.tafSegments.length > 0 && (
                <div className="mb-2.5">
                  <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-1">TAF trend — next 24 hr</p>
                  <div className="flex gap-0.5">
                    {payload.weather.tafSegments.map((s, i) => (
                      <div key={i} className={`h-4 rounded-sm flex items-center justify-center text-[7.5px] font-bold ${SEG_BG[s.cat]}`}
                        style={{ flexGrow: Math.max(1, (s.toMs - s.fromMs) / 3600_000) }}>
                        {s.cat}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[7.5px] text-slate-600 font-mono mt-0.5">
                    {payload.weather.tafSegments.map((s, i) => <span key={i}>{s.label}</span>)}
                  </div>
                </div>
              )}
              {payload.weather.alerts.map((a, i) => (
                <Row key={i} sev={a.lifeThreatening || a.severity === "Extreme" ? "r" : "a"} src="NWS">
                  <b className="text-slate-100">{a.event}</b>{a.headline ? <span className="text-slate-400"> — {a.headline.slice(0, 120)}</span> : null}
                </Row>
              ))}
              {payload.weather.alerts.length === 0 && <Row sev="g" src="NWS">No active weather alerts for this point</Row>}
              {payload.weather.outlook.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5 mt-2.5">
                  {payload.weather.outlook.map((d) => (
                    <div key={d.date} className="border border-slate-800/60 rounded-lg px-2 py-1.5 text-[10px] text-slate-400">
                      <b className="text-slate-200">{d.date.slice(5)}</b> {d.hiF ?? "?"}/{d.loF ?? "?"}°
                      <br />{d.precipPct != null && d.precipPct >= 40 ? <span className="text-amber-300">precip {d.precipPct}%</span> : <>precip {d.precipPct ?? "?"}%</>} · {d.windMph ?? "?"}mph
                    </div>
                  ))}
                </div>
              )}
              {/* Astro / illumination — pure math, minute precision (planning-grade). */}
              <p className="text-[10px] text-slate-500 mt-2.5 pt-2 border-t border-slate-800/60 font-mono">
                ☉ {payload.astro.sunriseZ?.slice(11, 16) ?? "—"}–{payload.astro.sunsetZ?.slice(11, 16) ?? "—"}Z
                <span className="text-slate-600"> · civil {payload.astro.civilDawnZ?.slice(11, 16) ?? "—"}/{payload.astro.civilDuskZ?.slice(11, 16) ?? "—"}Z</span>
                <span className="text-slate-400"> · ☽ {payload.astro.moon.illumPct}% {payload.astro.moon.phaseName}</span>
              </p>
            </SectionCard>

            {/* OPS */}
            <SectionCard led={payload.status.ops} title="Ops Summary" sources="DAIP NOTAMs · OurAirports">
              <Row sev={payload.ops.fieldClosed ? "r" : payload.ops.limiting ? "a" : payload.ops.configured && payload.ops.live ? "g" : "u"} src="DAIP·OA">
                <b>Field: {payload.ops.fieldClosed ? "CLOSED (NOTAM)" : payload.ops.limiting ? "LIMITED" : payload.ops.configured && payload.ops.live ? "OPEN" : "UNKNOWN"}</b>
                {payload.ops.capability && <span className="text-slate-400"> · longest open rwy {payload.ops.capability.lengthFt.toLocaleString()} ft {payload.ops.capability.surface} · {payload.ops.capability.cls} capable</span>}
                {!payload.ops.configured && <span className="text-slate-500"> — DAIP CA not configured; NOTAM picture unavailable</span>}
                {payload.ops.configured && !payload.ops.live && <span className="text-slate-500"> — DAIP unreachable this cycle</span>}
              </Row>
              {payload.ops.groups.map((g) => (
                <div key={g.key} className="mt-2">
                  <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-0.5">{g.label} <span className="font-mono font-normal">({g.items.length})</span></p>
                  {g.items.slice(0, 4).map((n, i) => (
                    <Row key={i} sev={n.amber ? "a" : "u"} src="NOTAM">
                      <span className={n.amber ? "text-slate-100 font-medium" : undefined}>{n.text.length > 180 ? n.text.slice(0, 179) + "…" : n.text}</span>
                    </Row>
                  ))}
                  {g.items.length > 4 && <p className="text-[9.5px] text-slate-600 pl-4">+ {g.items.length - 4} more</p>}
                </div>
              ))}
              {payload.ops.configured && payload.ops.live && payload.ops.notamCount === 0 && <Row sev="g" src="DAIP">No active NOTAMs</Row>}

              {/* Runway wind components — advisory, from the current METAR. */}
              {payload.ops.runwayWinds.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-800/60">
                  <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-1">
                    Runway winds <span className="font-normal normal-case tracking-normal">— advisory, not flight guidance</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {payload.ops.runwayWinds.map((r) => (
                      <span
                        key={r.ident}
                        title={`heading ${Math.round(r.headingDegT)}°T · head ${r.headKt}kt · cross ${r.crossKt}kt${r.gustCrossKt ? ` (gust ${r.gustCrossKt})` : ""}`}
                        className={`text-[10px] font-mono px-2 py-1 rounded-md border ${
                          r.flag === "r" ? "border-red-500/50 text-red-300 bg-red-500/10"
                          : r.flag === "a" ? "border-amber-500/50 text-amber-300 bg-amber-500/10"
                          : "border-slate-700 text-slate-400"
                        }`}
                      >
                        RWY {r.ident} · {r.headKt >= 0 ? `head ${r.headKt}` : `TAIL ${-r.headKt}`} · x{r.crossKt}{r.gustCrossKt ? `G${r.gustCrossKt}` : ""}kt
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {payload.weather.windVariable && (
                <p className="text-[9.5px] text-slate-600 mt-1.5">Wind variable — crosswind components not computed.</p>
              )}

              {/* Closure-window timeline — NOTAM B)/C) times as bars over the
                  next 48 h with TAF categories on the same axis. Only NOTAMs
                  with parseable windows become bars; the rest stay text above. */}
              {tlWindows.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-800/60">
                  <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-1.5">
                    Closure windows <span className="font-normal normal-case tracking-normal">— next 48 h, all times Z</span>
                  </p>
                  {/* hour axis: 8 ticks × 6 h */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-24 flex-shrink-0" />
                    <div className="flex-1 grid grid-cols-8 text-[7.5px] text-slate-600 font-mono">
                      {Array.from({ length: 8 }, (_, i) => (
                        <span key={i} className="border-l border-slate-800 pl-0.5">
                          {String(new Date(tlNowMs + i * 6 * 3600_000).getUTCHours()).padStart(2, "0")}Z
                        </span>
                      ))}
                    </div>
                  </div>
                  {tlRows.map(([label, ws]) => {
                    const open = tlOpenLabel === label;
                    const zhm = (ms: number) => new Date(ms).toISOString().slice(11, 16) + "Z";
                    return (
                    <div key={label} className="mb-1">
                      <button
                        type="button"
                        onClick={() => setTlOpenLabel(open ? null : label)}
                        className="w-full flex items-center gap-2 text-left"
                        aria-expanded={open}
                        title="Tap to show the NOTAM(s) behind this row"
                      >
                        <span className="w-24 flex-shrink-0 text-right text-[9px] text-slate-400 truncate flex items-center justify-end gap-0.5">
                          <span className={`text-slate-600 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                          <span className="truncate" title={label}>{label}</span>
                        </span>
                        <div className="relative flex-1 h-4 bg-slate-800/30 rounded overflow-hidden">
                          <div className="absolute inset-0 grid grid-cols-8">
                            {Array.from({ length: 8 }, (_, i) => <i key={i} className="border-l border-slate-800/70" />)}
                          </div>
                          {ws.map((w, i) => {
                            const left = ((w.fromMs - tlNowMs) / (48 * 3600_000)) * 100;
                            const width = Math.max(1.5, ((w.toMs - w.fromMs) / (48 * 3600_000)) * 100);
                            return (
                              <span
                                key={i}
                                title={`${w.text} · ${zhm(w.fromMs)}–${w.openEnded ? "UFN" : zhm(w.toMs)}`}
                                className={`absolute top-[2px] bottom-[2px] rounded-[3px] border px-1 text-[7.5px] font-bold flex items-center overflow-hidden whitespace-nowrap ${
                                  w.kind === "closure" ? "bg-red-500/20 border-red-500/55 text-red-300"
                                  : w.kind === "unserviceable" ? "bg-amber-500/20 border-amber-500/55 text-amber-300"
                                  : "bg-sky-500/15 border-sky-500/45 text-sky-300"
                                }`}
                                style={{ left: `${left}%`, width: `${width}%` }}
                              >
                                {width > 12 ? `${zhm(w.fromMs)}–${w.openEnded ? "UFN" : zhm(w.toMs)}` : ""}
                              </span>
                            );
                          })}
                        </div>
                      </button>
                      {open && (
                        <div className="ml-[104px] mt-1 mb-1.5 space-y-1">
                          {ws.map((w, i) => (
                            <div key={i} className={`rounded-md border px-2 py-1 ${
                              w.kind === "closure" ? "border-red-500/40 bg-red-500/[.06]"
                              : w.kind === "unserviceable" ? "border-amber-500/40 bg-amber-500/[.06]"
                              : "border-sky-500/40 bg-sky-500/[.06]"
                            }`}>
                              <p className="text-[9px] font-mono text-slate-500">
                                {zhm(w.fromMs)}–{w.openEnded ? "UFN" : zhm(w.toMs)} · {w.kind === "closure" ? "CLOSED" : w.kind === "unserviceable" ? "U/S" : "LIMITED"}
                              </p>
                              <p className="text-[10.5px] text-slate-300 leading-snug break-words">{w.text}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                  {/* TAF categories on the same axis (24-h forecast → half the track) */}
                  {payload.weather.tafSegments.length > 0 && (
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-24 flex-shrink-0 text-right text-[9px] text-slate-400">TAF</span>
                      <div className="relative flex-1 h-3.5 rounded overflow-hidden bg-slate-800/30">
                        {payload.weather.tafSegments.map((s, i) => {
                          const left = Math.max(0, ((s.fromMs - tlNowMs) / (48 * 3600_000)) * 100);
                          const width = Math.max(0.5, ((s.toMs - s.fromMs) / (48 * 3600_000)) * 100);
                          return (
                            <span key={i} className={`absolute top-0 bottom-0 flex items-center justify-center text-[7px] font-extrabold tracking-wider ${SEG_BG[s.cat]}`} style={{ left: `${left}%`, width: `${width}%` }}>
                              {width > 6 ? s.cat : ""}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {tlConflicts.map((c, i) => (
                    <div key={i} className="mt-1.5 border border-red-500/35 bg-red-500/[.07] rounded-lg px-2.5 py-1.5 text-[10px] text-red-300">
                      ⚠ <b className="text-red-200">Window conflict:</b> {c}
                    </div>
                  ))}
                  <p className="text-[8.5px] text-slate-600 mt-1.5">
                    Tap a row to read the NOTAM behind it. Bars come only from NOTAMs with parseable B)/C) times — anything unparseable stays a text row above, never a guessed bar. Open-ended windows run to the edge (UFN).
                  </p>
                </div>
              )}

              {/* Fuel NOTAMs (system feed, filtered to this ICAO). */}
              {payload.ops.fuel && (
                <div className="mt-2 pt-2 border-t border-slate-800/60">
                  <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-0.5">Fuel NOTAMs</p>
                  {!payload.ops.fuel.live && <Row sev="u" src="DAIP">Fuel feed UNREACHABLE — UNKNOWN, not clear</Row>}
                  {payload.ops.fuel.live && payload.ops.fuel.items.length === 0 && <Row sev="g" src="DAIP">No fuel NOTAMs referencing {payload.base.icao}</Row>}
                  {payload.ops.fuel.items.map((t, i) => <Row key={i} sev="a" src="DAIP">{t}</Row>)}
                </div>
              )}

              {/* Bird/BASH advisory: elevated windows around civil dawn/dusk. */}
              <p className="text-[9.5px] text-slate-600 mt-2 pt-2 border-t border-slate-800/60">
                🐦 Elevated bird activity (±30 min of civil twilight):{" "}
                <span className="text-slate-400 font-mono">
                  {payload.astro.civilDawnZ ? `${payload.astro.civilDawnZ.slice(11, 16)}Z–${payload.astro.sunriseZ ? new Date(Date.parse(payload.astro.sunriseZ) + 30 * 60000).toISOString().slice(11, 16) : "—"}Z` : "—"}
                  {" · "}
                  {payload.astro.civilDuskZ ? `${payload.astro.sunsetZ ? new Date(Date.parse(payload.astro.sunsetZ) - 30 * 60000).toISOString().slice(11, 16) : "—"}Z–${payload.astro.civilDuskZ.slice(11, 16)}Z` : "—"}
                </span>
                {" "}— seasonal proxy; see Bird/wildlife NOTAMs above when present.
              </p>

              {/* Center (ARTCC) enroute picture — configured per base. */}
              <div className="mt-2 pt-2 border-t border-slate-800/60">
                <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-0.5">
                  Center NOTAMs {payload.ops.center ? `— ${payload.ops.center.code} ARTCC` : ""}
                  {payload.ops.center?.live && <span className="font-mono font-normal"> ({payload.ops.center.count})</span>}
                </p>
                {!payload.ops.center && (
                  <div className="flex items-center gap-2 py-1">
                    <span className="text-[10.5px] text-slate-600">No center set for this base — enter its ARTCC (e.g. ZNY):</span>
                    <CenterInput icao={payload.base.icao} onSaved={() => icao && loadSitrep(icao)} />
                  </div>
                )}
                {payload.ops.center && !payload.ops.center.live && (
                  <Row sev="u" src="DAIP">{payload.ops.center.code} enroute picture UNREACHABLE this cycle — UNKNOWN, not clear</Row>
                )}
                {payload.ops.center?.live && payload.ops.center.count === 0 && (
                  <Row sev="g" src="DAIP">No active enroute NOTAMs for {payload.ops.center.code}</Row>
                )}
                {payload.ops.center?.items.map((n, i) => (
                  <Row key={i} sev={n.amber ? "a" : "u"} src="DAIP">
                    <span className={n.amber ? "text-slate-100 font-medium" : undefined}>{n.text.length > 180 ? n.text.slice(0, 179) + "…" : n.text}</span>
                  </Row>
                ))}
              </div>
            </SectionCard>

            {/* THREATS */}
            <SectionCard led={payload.status.threat} title="Threats" sources="Force Protection · GDACS/USGS · GDELT">
              {payload.threats.fp ? (
                <Row sev={payload.threats.fp.composite === "red" ? "r" : payload.threats.fp.composite === "amber" ? "a" : "g"} src="FP">
                  <b>FP composite: {payload.threats.fp.composite.toUpperCase()}</b> — {payload.threats.fp.topDriver}
                  <span className="block text-[10px] text-slate-500 mt-0.5">
                    {payload.threats.fp.axes.map((ax) => `${ax.key} ${ax.severity === "green" ? "✓" : ax.severity === "unknown" ? "?" : "⚠"}`).join(" · ")}
                  </span>
                </Row>
              ) : (
                <Row sev="u" src="FP">Force Protection assessment unavailable this cycle</Row>
              )}
              {payload.threats.disasters.length === 0
                ? <Row sev="g" src="GDACS">No natural disasters within 500 km</Row>
                : payload.threats.disasters.map((d, i) => (
                    <Row key={i} sev={d.severity === "red" ? "r" : "a"} src="GDACS">
                      <b>{d.type}</b> {d.km} km — {d.title.slice(0, 120)}
                    </Row>
                  ))}
              <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mt-2 mb-0.5">
                Local reporting — impact-filtered <span className="font-mono font-normal">({payload.threats.news.length} of {payload.threats.newsScanned})</span>
              </p>
              {payload.threats.news.length === 0 && <Row sev="g" src="GDELT">Nothing impact-relevant in local reporting</Row>}
              {payload.threats.news.map((n, i) => (
                <Row key={i} sev="a" src="GDELT">
                  <a href={n.link} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-300">{n.title.slice(0, 140)}</a>
                  <span className="block text-[9px] text-slate-600">matched: {n.matched.join(", ")}</span>
                </Row>
              ))}
            </SectionCard>

            {/* INFRASTRUCTURE — IODA internet + FAA NAS + USGS water sensors,
                power/comms stay news-derived and say so. */}
            <SectionCard led={payload.status.infra} title="Infrastructure Watch" sources="IODA (Georgia Tech) · FAA NAS · USGS · news">
              {/* Internet — macro connectivity for the base's state/country */}
              {!payload.infra.internet.live && <Row sev="u" src="IODA"><b>Internet:</b> IODA UNREACHABLE this cycle — UNKNOWN, not clear</Row>}
              {payload.infra.internet.live && (
                <Row sev={payload.infra.internet.led === "u" ? "u" : payload.infra.internet.led} src="IODA">
                  <b>Internet ({payload.infra.internet.entity}):</b>{" "}
                  {payload.infra.internet.led === "g" ? "no macro degradation across measurement sources" : payload.infra.internet.led === "u" ? "insufficient signal data" : "degradation detected"}
                  {payload.infra.internet.series.length > 0 && (
                    <span className="flex flex-wrap gap-1.5 mt-1">
                      {payload.infra.internet.series.map((sr) => (
                        <span key={sr.datasource} className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded border ${
                          (sr.dropPct ?? 0) >= 80 ? "border-red-500/50 text-red-300 bg-red-500/10"
                          : (sr.dropPct ?? 0) >= 50 ? "border-amber-500/50 text-amber-300 bg-amber-500/10"
                          : "border-slate-700 text-slate-500"
                        }`}>
                          {sr.label} {sr.dropPct !== null ? `−${sr.dropPct}%` : "n/a"}
                        </span>
                      ))}
                    </span>
                  )}
                </Row>
              )}

              {/* FAA NAS — national ATC programs, nearby ones called out (US bases) */}
              {payload.infra.nas && !payload.infra.nas.live && <Row sev="u" src="FAA NAS"><b>NAS status:</b> UNREACHABLE — UNKNOWN</Row>}
              {payload.infra.nas?.live && (
                <>
                  <Row sev={payload.infra.nas.nearby.some((p) => p.kind === "closure" || p.kind === "groundStop") ? "a" : "g"} src="FAA NAS">
                    <b>NAS:</b> {payload.infra.nas.counts.groundStops} ground stops · {payload.infra.nas.counts.groundDelays} ground delays · {payload.infra.nas.counts.closures} closures nationally
                    {payload.infra.nas.nearby.length === 0 && <span className="text-slate-500"> — none within 250 km</span>}
                  </Row>
                  {payload.infra.nas.nearby.map((p, i) => (
                    <Row key={i} sev={p.kind === "closure" || p.kind === "groundStop" ? "a" : "u"} src="FAA NAS">
                      <b>{p.kind === "groundStop" ? "GROUND STOP" : p.kind === "closure" ? "CLOSURE" : p.kind === "groundDelay" ? "Ground delay" : "Delay"}</b>{" "}
                      {p.airport} · {p.km} km — {p.reason}{p.detail ? ` · ${p.detail}` : ""}
                    </Row>
                  ))}
                </>
              )}

              {/* Power / comms — news-derived only; no sensor exists, say so */}
              {payload.infra.powerNews.length > 0
                ? payload.infra.powerNews.map((n, i) => (
                    <Row key={`p${i}`} sev="a" src="news">
                      <b>Power:</b> <a href={n.link} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-300">{n.title.slice(0, 120)}</a>
                    </Row>
                  ))
                : <Row sev="u" src="news"><b>Power:</b> no outage reporting in local news — news-derived, absence ≠ verified clear</Row>}
              {payload.infra.commsNews.map((n, i) => (
                <Row key={`c${i}`} sev="a" src="news">
                  <b>Comms:</b> <a href={n.link} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-300">{n.title.slice(0, 120)}</a>
                </Row>
              ))}

              {/* Water — USGS gauge levels (informational; flood POSTURE comes
                  from the NWS alerts in the Weather card) */}
              {payload.infra.water && (
                <div className="mt-2 pt-2 border-t border-slate-800/60">
                  <p className="text-[8.5px] font-bold uppercase tracking-widest text-slate-600 mb-0.5">
                    Water gauges <span className="font-normal normal-case tracking-normal">— levels only; flood warnings appear under Weather</span>
                  </p>
                  {!payload.infra.water.live && <Row sev="u" src="USGS">Gauge feed UNREACHABLE — UNKNOWN</Row>}
                  {payload.infra.water.live && payload.infra.water.gauges.length === 0 && <Row sev="u" src="USGS">No active gauges reporting in the local box</Row>}
                  {payload.infra.water.gauges.map((g, i) => (
                    <Row key={i} sev="b" src="USGS">{g.site} — stage {g.stageFt} ft</Row>
                  ))}
                  {payload.infra.waterNews.map((n, i) => (
                    <Row key={`w${i}`} sev="a" src="news">
                      <a href={n.link} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-300">{n.title.slice(0, 120)}</a>
                    </Row>
                  ))}
                </div>
              )}
              <p className="text-[9.5px] text-slate-600 mt-2">Planning-grade heuristics: IODA measures state/country-level connectivity (not the base LAN); power has no direct sensor. UNKNOWN ≠ all clear.</p>
            </SectionCard>
          </div>

          <p className="text-[9px] text-slate-600 font-mono px-1">
            Sources: AWC {payload.weather.live ? "live" : "DOWN"} · DAIP {payload.ops.configured ? (payload.ops.live ? "live" : "DOWN") : "not configured"} · FP {payload.threats.fp ? "live" : "DOWN"} · IODA {payload.infra.internet.live ? "live" : "DOWN"} · NAS {payload.infra.nas ? (payload.infra.nas.live ? "live" : "DOWN") : "n/a"} · GDELT scanned {payload.threats.newsScanned} · every gap reads UNKNOWN, never implied-clear
          </p>
        </>
      )}
    </div>
  );
}
