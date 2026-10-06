"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openTrackPicker } from "@/lib/trackClient";
import dynamic from "next/dynamic";
import ErrorBoundary from "@/components/ErrorBoundary";
import WarningBoard from "@/components/osint/WarningBoard";
import SitrepPanel from "@/components/osint/SitrepPanel";
import ReactivationCard from "@/components/osint/ReactivationCard";
import CountryRoom from "@/components/ground/CountryRoom";
import { getForceProtectionData } from "@/lib/forceProtectionClient";
import type { ForceAssessment } from "@/lib/forceProtection";
import type { CommandsBody } from "@/lib/commandsAssemble";
import type { CommandRow, CountryRow, FieldRow, CbBoard, CbSitrep, Led } from "@/lib/commandBoard";
import type { PrimerDoor, PrimerItem } from "@/lib/primer";
import { toggleMustTrack, isStarCountry, type MustTrack } from "@/lib/missionProfile";
import { AOR_LABELS, type Aor } from "@/lib/aor";
import { SEVERITY_DOT, type Severity } from "@/lib/severity";
import { noteOpen } from "@/lib/noteOpenClient";
import { toast } from "@/lib/feedback";

// The OSINT command board — REVIEW-2026-10 §6, decisions 1–4 as recommended.
// One scrolling page: WHERE TO LOOK FIRST (the deterministic primer, AI read
// on tap) → MY AIRFIELDS (hub, spokes, ★ fields pinned) → COMBATANT COMMANDS
// (one row each, ★ first then worst; a row drills IN PLACE to its boards →
// countries → situation room → airfields → SITREP) → THE PICTURE (the Crisis
// map and its Significant-events list, which FOLLOW whatever is open).
//
// Mount contract: the parent keeps this hidden-mounted after first activation
// so the map does not re-fetch its ~15 sources on every pane hop; the board
// arms itself lazily on first activation (all tabs mount at app load).
//
// Every ★ is a Mission Profile write (owner) through PATCH /api/mission-profile
// — the board never keeps its own tracking state.

const CrisisMap = dynamic(() => import("@/components/osint/CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse flex items-center justify-center text-xs text-slate-600 font-mono uppercase tracking-wider">
      Loading crisis map…
    </div>
  ),
});

type Body = CommandsBody & { canEdit?: boolean };

interface OpenState { aor: Aor | null; board: string | null; country: string | null; icao: string | null }
const CLOSED: OpenState = { aor: null, board: null, country: null, icao: null };

const LED_CLASS: Record<Led, string> = { g: "bg-emerald-500", a: "bg-amber-400", r: "bg-red-500", u: "bg-slate-600" };
const LVL_CHIP: Record<string, string> = {
  alert: "text-red-200 border-red-500/60 bg-red-500/20",
  warning: "text-orange-300 border-orange-500/50 bg-orange-500/10",
  watch: "text-amber-300 border-amber-500/50 bg-amber-500/10",
  calm: "text-slate-400 border-slate-700 bg-transparent",
};
const TRAJ: Record<string, string> = { deteriorating: "↗", improving: "↘", stable: "→" };
const DEMAND_CLASS: Record<string, string> = { rise: "text-amber-300", hold: "text-slate-400", fall: "text-emerald-400" };
const TONE_RING: Record<string, string> = { red: "border-red-500/50 text-red-300", amber: "border-amber-500/50 text-amber-300", slate: "border-slate-700 text-slate-400" };
const short = (aor: Aor) => AOR_LABELS[aor].replace(/^US/, "");

const lc = (s: string) => s.trim().toLowerCase();

function Leds({ status, size = "w-1.5 h-1.5" }: { status: CbSitrep["status"]; size?: string }) {
  return (
    <span className="flex gap-0.5" title={`wx ${status.wx} · ops ${status.ops} · threat ${status.threat} · infra ${status.infra} · spectrum ${status.spectrum} (g green · a amber · r red · u unknown)`}>
      {(["wx", "ops", "threat", "infra", "spectrum"] as const).map((k) => <span key={k} className={`${size} rounded-full ${LED_CLASS[status[k]]}`} />)}
    </span>
  );
}

function Dot({ sev, title }: { sev: Severity | null; title?: string }) {
  return <span style={{ color: sev ? SEVERITY_DOT[sev] : "#334155" }} className="text-[11px]" title={title ?? (sev ?? "not watched")}>●</span>;
}

function Star({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title={on ? `★ must-track — click to clear (${label})` : `Make ${label} a must-track`}
      aria-label={on ? `Clear must-track ${label}` : `Make ${label} a must-track`}
      className={`text-[14px] leading-none px-1 rounded transition-colors disabled:opacity-40 ${on ? "text-amber-400 hover:text-amber-300" : "text-slate-700 hover:text-amber-400"}`}
    >{on ? "★" : "☆"}</button>
  );
}

export default function CommandBoard({ active }: { active: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  const [data, setData] = useState<Body | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const sinceRef = useRef<number | null>(null);
  const pollTries = useRef(0);
  const [open, setOpen] = useState<OpenState>(CLOSED);
  const [othersOpen, setOthersOpen] = useState(false);
  const [mtPanel, setMtPanel] = useState(false);
  const [primerOpen, setPrimerOpen] = useState(true);
  const [mineOpen, setMineOpen] = useState(true);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [forces, setForces] = useState<ForceAssessment[]>([]);
  const [mtBusy, setMtBusy] = useState(false);
  const parked = useRef<{ kind: "sitrep" | "iw" | "country"; id: string } | null>(null);

  useEffect(() => {
    try {
      setPrimerOpen(localStorage.getItem("commands.primerOpen") !== "0");
      setMineOpen(localStorage.getItem("commands.mineOpen") !== "0");
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { try { localStorage.setItem("commands.primerOpen", primerOpen ? "1" : "0"); } catch { /* ignore */ } }, [primerOpen]);
  useEffect(() => { try { localStorage.setItem("commands.mineOpen", mineOpen ? "1" : "0"); } catch { /* ignore */ } }, [mineOpen]);

  // ── Load (bounded; a 202 means the shared assembly is still cold → poll) ──
  const load = useCallback(() => {
    const qs = sinceRef.current ? `?since=${sinceRef.current}` : "";
    fetch(`/api/commands${qs}`)
      .then(async (r) => ({ status: r.status, body: (await r.json()) as Body & { error?: string } }))
      .then(({ status, body }) => {
        if (status === 401) { setError("signed out — sign in again"); return; }
        if (body.error && !body.board) { setError(body.error); return; }
        if (sinceRef.current == null && typeof body.sinceMs === "number") sinceRef.current = body.sinceMs;
        setData(body);
        setError(body.error ?? null);
        if (status === 202 || body.pending) {
          setPendingNote("assembling the command picture — first load takes a moment");
          if (pollTries.current < 12) { pollTries.current += 1; setTimeout(load, 8_000); }
        } else { setPendingNote(null); pollTries.current = 0; }
      })
      .catch(() => setError("could not reach /api/commands"));
  }, []);
  useEffect(() => {
    if (!armed) return;
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [armed, load]);

  // Force assessments (shared client cache — the map pulls the same) for the
  // country situation room, which needs the full category breakdown.
  useEffect(() => {
    if (!armed) return;
    let cancel = false;
    getForceProtectionData().then((d) => { if (!cancel) setForces(d.assessments ?? []); }).catch(() => {});
    const onChange = () => getForceProtectionData(true).then((d) => { if (!cancel) setForces(d.assessments ?? []); }).catch(() => {});
    window.addEventListener("force-locations:changed", onChange);
    return () => { cancel = true; window.removeEventListener("force-locations:changed", onChange); };
  }, [armed]);

  // ── Doors in: watch:focus {kind, id} · regional:select country ──
  // Registered regardless of `armed`; a request that arrives before the
  // board has data is parked and applied when it lands.
  const go = useCallback((door: PrimerDoor, scrollKey?: string) => {
    setOpen({ aor: door.aor, board: door.problemId ?? null, country: door.country ?? null, icao: door.icao ?? null });
    if (door.icao) noteOpen("base", door.icao);
    else if (door.problemId) noteOpen("board", door.problemId);
    const key = scrollKey ?? (door.icao ? `cb-field-${door.icao}` : door.problemId ? `cb-board-${door.problemId}` : door.country ? `cb-country-${lc(door.country).replace(/\s+/g, "-")}` : `cb-cmd-${door.aor}`);
    setFlash(key);
    setTimeout(() => document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    setTimeout(() => setFlash((f) => (f === key ? null : f)), 3_500);
  }, []);

  const resolveDoor = useCallback((req: { kind: "sitrep" | "iw" | "country"; id: string }, body: Body): PrimerDoor | null => {
    const details = Object.values(body.board.details);
    if (req.kind === "sitrep") {
      for (const d of details) for (const c of d.countries) for (const f of c.fields) if (f.icao === req.id) return { aor: d.aor, country: c.country, icao: f.icao };
      const mine = body.board.myFields.find((f) => f.icao === req.id);
      if (mine && mine.aor !== "UNKNOWN") return { aor: mine.aor, country: mine.country || undefined, icao: mine.icao };
      return null;
    }
    if (req.kind === "iw") {
      if (!req.id) { const worst = body.board.rows.find((r) => r.iw); return worst ? { aor: worst.aor } : null; }
      for (const d of details) for (const b of d.boards) if (b.problemId === req.id) return { aor: d.aor, problemId: b.problemId };
      return null;
    }
    for (const d of details) for (const c of d.countries) if (lc(c.country) === lc(req.id)) return { aor: d.aor, country: c.country };
    return null;
  }, []);

  useEffect(() => {
    const onFocus = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; id?: string }>).detail;
      if (!d || (d.kind !== "sitrep" && d.kind !== "iw")) return;
      parked.current = { kind: d.kind, id: typeof d.id === "string" ? d.id : "" };
      setArmed(true);
    };
    const onSel = (e: Event) => {
      const c = (e as CustomEvent<string>).detail;
      if (typeof c !== "string" || !c) return;
      parked.current = { kind: "country", id: c };
      setArmed(true);
    };
    window.addEventListener("watch:focus", onFocus);
    window.addEventListener("regional:select", onSel);
    return () => { window.removeEventListener("watch:focus", onFocus); window.removeEventListener("regional:select", onSel); };
  }, []);
  useEffect(() => {
    if (!data || !parked.current) return;
    const req = parked.current;
    const door = resolveDoor(req, data);
    if (door) { parked.current = null; go(door); }
    else if (!data.pending) { parked.current = null; toast.info(`${req.id || "that item"} is not on the board`); }
  }, [data, resolveDoor, go]);

  // ── Must-tracks: optimistic, owner-gated at the route ──
  const mustTrack: MustTrack = data?.mustTrack ?? { aors: [], countries: [], icaos: [] };
  const canEdit = !!data?.canEdit;
  const star = async (kind: "aor" | "country" | "icao", value: string) => {
    if (!data) return;
    if (!canEdit) { toast.info("Must-tracks are team config — the owner sets them"); return; }
    const next = toggleMustTrack(mustTrack, kind, value);
    setData({ ...data, mustTrack: next });
    setMtBusy(true);
    try {
      const r = await fetch("/api/mission-profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mustTrack: next }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      window.dispatchEvent(new CustomEvent("force-locations:changed"));
      load();
    } catch (e) {
      setData((d) => (d ? { ...d, mustTrack } : d));
      toast.error(`Could not save that ★ — ${e instanceof Error ? e.message : "try again"}`);
    } finally { setMtBusy(false); }
  };

  const runRead = () => {
    setAiBusy(true); setAiText(null);
    fetch("/api/commands/read", { method: "POST" })
      .then(async (r) => ({ ok: r.ok, status: r.status, d: (await r.json().catch(() => null)) as { text?: string; disabled?: boolean; error?: string } | null }))
      .then(({ ok, status, d }) => setAiText(d?.disabled ? "AI is off (no API key or the chat feature is disabled)." : ok && d?.text ? d.text : `Read failed (HTTP ${status}${d?.error ? ` — ${d.error}` : ""}).`))
      .catch(() => setAiText("Read failed — the board may be assembling."))
      .finally(() => setAiBusy(false));
  };

  // ── Derived ──
  const rows = data?.board.rows ?? [];
  const shownRows = rows.filter((r) => !r.quiet);
  const quietRows = rows.filter((r) => r.quiet);
  const starAors = mustTrack.aors;
  const myFieldsForMap = useMemo(() => (data?.board.myFields ?? []).flatMap((f) => {
    const p = f.posture; const o = data?.ownFields.find((x) => x.icao === f.icao);
    const lat = p?.lat ?? o?.lat; const lon = p?.lon ?? o?.lon;
    return lat != null && lon != null && !(lat === 0 && lon === 0) ? [{ icao: f.icao, label: f.label, lat, lon }] : [];
  }), [data]);
  const forceById = useMemo(() => new Map(forces.map((f) => [f.id, f])), [forces]);
  const countryForce = (c: CountryRow): { sel: ForceAssessment | null; base: ForceAssessment | null } => {
    const sel = c.posture ? forceById.get(c.posture.id) ?? null : null;
    const baseRow = c.fields.find((f) => f.posture)?.posture;
    const base = baseRow ? forceById.get(baseRow.id) ?? null : null;
    return { sel: sel ?? base, base };
  };

  if (!armed) return null;

  const crumb = open.aor ? [short(open.aor), open.country, open.icao ?? (open.board ? "board" : null)].filter(Boolean).join(" › ") : null;

  return (
    <div className="space-y-4">
      {error && <div className="text-[11px] text-red-300 font-mono border border-red-500/40 bg-red-500/10 rounded-lg px-3 py-2">Command board: {error}</div>}
      {pendingNote && !error && <div className="text-[10px] text-slate-500 font-mono px-1">{pendingNote}</div>}

      {/* ── Where to look first ── */}
      <section className="border border-emerald-500/30 rounded-xl bg-slate-900/40 overflow-hidden">
        <div className="px-3.5 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-300">⌖ Where to look first</span>
          <span className="text-[10px] text-slate-500">ranked from the posture, boards, bases, demand and your last look · nothing paid</span>
          <span className="flex-1" />
          <button onClick={runRead} disabled={aiBusy} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50" title="One model call, on tap, over the deterministic board + primer">{aiBusy ? "Reading…" : "✦ Read (AI)"}</button>
          <button onClick={() => setPrimerOpen((v) => !v)} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200">{primerOpen ? "fold ▴" : "unfold ▾"}</button>
        </div>
        {!data && !error && <p className="px-3.5 py-3 text-[11px] text-slate-500">Assembling…</p>}
        {data && !primerOpen && (
          <p className="px-3.5 py-2 text-[11px] text-slate-400 truncate">
            {data.primer.items.length ? `${data.primer.items.length} to look at — ${data.primer.items[0].subject} ${data.primer.items[0].text}` : data.primer.footer}
          </p>
        )}
        {data && primerOpen && (
          <>
            {data.primer.items.length === 0 && <p className="px-3.5 py-3 text-[11.5px] text-slate-400">Nothing to drill into first. {data.primer.footer}</p>}
            {data.primer.items.map((it: PrimerItem, i) => (
              <div key={it.key} className="grid grid-cols-[26px_1fr_auto] gap-3 items-start px-3.5 py-2 border-t border-slate-800/70 first:border-t-0">
                <span className={`w-[22px] h-[22px] rounded-md border flex items-center justify-center text-[11px] font-extrabold font-mono ${TONE_RING[it.tone]}`}>{i + 1}</span>
                <div className="min-w-0 text-[12.5px] text-slate-300 leading-snug">
                  <b className="text-slate-100">{it.subject}</b> {it.text}
                  <span className={`block text-[10px] mt-0.5 ${it.star ? "text-amber-300" : "text-slate-500"}`}>{it.note}</span>
                </div>
                <button onClick={() => go(it.door)} className="self-center text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 whitespace-nowrap" title="Open exactly this level on the board">{it.doorLabel}</button>
              </div>
            ))}
            {aiText !== null && (
              <div className="px-3.5 py-2.5 border-t border-emerald-500/20 bg-emerald-500/[0.04]">
                <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 mb-1">✦ AI read · one call, cached 15 min</p>
                <pre className="text-[12px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">{aiText}</pre>
              </div>
            )}
            <p className="px-3.5 py-1.5 border-t border-slate-800 text-[10px] text-slate-500">{data.primer.footer}</p>
          </>
        )}
      </section>

      <ReactivationCard active={armed} />

      {/* ── My airfields ── */}
      {data && data.board.myFields.length > 0 && (
        <section className="border border-slate-800 rounded-xl bg-slate-900/40 overflow-hidden">
          <div className="px-3.5 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-200">✈ My airfields</span>
            <span className="text-[10px] text-slate-500">hub · spokes · ★ must-track fields — a SITREP one click from anywhere</span>
            <span className="flex-1" />
            <button onClick={() => setMineOpen((v) => !v)} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200">{mineOpen ? "fold ▴" : "unfold ▾"}</button>
          </div>
          {!mineOpen && (
            <p className="px-3.5 py-2 text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
              {data.board.myFields.map((f) => <span key={f.icao} className="flex items-center gap-1.5"><span className="font-mono font-bold text-slate-200">{f.icao}</span>{f.sitrep ? <Leds status={f.sitrep.status} /> : <Dot sev={f.posture?.composite ?? null} />}</span>)}
            </p>
          )}
          {mineOpen && (
            <div className="px-3.5 py-2.5 flex flex-wrap gap-2">
              {data.board.myFields.map((f) => {
                const worst = f.sitrep ? (["r", "a", "u", "g"] as Led[]).find((l) => Object.values(f.sitrep!.status).includes(l)) ?? "g" : null;
                return (
                  <button key={f.icao} id={`cb-mine-${f.icao}`} onClick={() => f.aor !== "UNKNOWN" && go({ aor: f.aor, country: f.country || undefined, icao: f.icao })}
                    className={`text-left min-w-[200px] flex-1 max-w-[320px] rounded-xl border px-3 py-2 transition-colors hover:bg-slate-800/40 ${worst === "r" ? "border-red-500/50" : worst === "a" ? "border-amber-500/40" : "border-slate-800"}`}>
                    <div className="flex items-center gap-1.5">
                      <Star on={f.star} label={f.icao} onClick={() => star("icao", f.icao)} disabled={mtBusy} />
                      <span className="text-[13px] font-extrabold font-mono text-slate-100">{f.icao}</span>
                      {f.role && <span className="text-[8px] font-bold uppercase tracking-widest border border-slate-700 rounded px-1 py-px text-slate-400">{f.role}</span>}
                      <span className="ml-auto">{f.sitrep ? <Leds status={f.sitrep.status} size="w-2 h-2" /> : <Dot sev={f.posture?.composite ?? null} />}</span>
                      {f.sitrep && f.sitrep.worse.length > 0 && <span className="text-[9px] font-bold text-amber-400" title={`worse than yesterday: ${f.sitrep.worse.join(", ")}`}>↑</span>}
                    </div>
                    <p className={`text-[10.5px] mt-1 truncate ${worst === "r" ? "text-red-300" : worst === "a" ? "text-amber-300" : "text-slate-400"}`}>{f.sitrep ? f.sitrep.driver : f.posture ? f.posture.topDriver : "not watched — posture UNKNOWN"}</p>
                    <p className="text-[9px] font-mono text-slate-600 mt-0.5 truncate">{f.aor !== "UNKNOWN" ? short(f.aor) : "—"} · {f.country || "—"} · {f.hasSitrep ? "SITREP" : "★ to get a SITREP"}</p>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Combatant commands ── */}
      <section className="border border-slate-800 rounded-xl bg-slate-900/40 overflow-hidden">
        <div className="px-3.5 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-200">◆ Combatant commands</span>
          <span className="text-[10px] text-slate-500">{crumb ? <><span className="text-slate-600">open:</span> <b className="text-sky-200 font-mono">{crumb}</b></> : "★ must-tracks first, then worst · click a command to drill"}</span>
          <span className="flex-1" />
          {open.aor && <button onClick={() => setOpen(CLOSED)} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200">collapse all</button>}
          <button onClick={() => setMtPanel((v) => !v)} className={`text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border ${mtPanel ? "border-amber-500/50 text-amber-300 bg-amber-500/10" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>★ Must-tracks ▾</button>
        </div>

        {mtPanel && data && (
          <div className="px-3.5 py-2.5 border-b border-slate-800 bg-slate-950/40 text-[11px] space-y-1.5">
            <p className="text-[10px] text-slate-500">A ★ orders and pins — it never adds tracking. ★ commands sort first and always have a map chip; ★ countries lead their command; ★ airfields take the full-SITREP slots (6, hub first). {canEdit ? "Saved to the Mission Profile." : "Owner-set team config — read-only for crew."}</p>
            <div className="flex flex-wrap items-center gap-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 w-20">Commands</span>
              {rows.map((r) => <button key={r.aor} onClick={() => star("aor", r.aor)} disabled={mtBusy} className={`text-[10px] font-mono rounded px-1.5 py-0.5 border ${r.star ? "border-amber-500/50 text-amber-300 bg-amber-500/10" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>{r.star ? "★" : "☆"} {r.aor}</button>)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 w-20">Countries</span>
              {mustTrack.countries.length === 0 && <span className="text-slate-600">none — ★ a country row below</span>}
              {mustTrack.countries.map((c) => <button key={c} onClick={() => star("country", c)} disabled={mtBusy} className="text-[10px] rounded px-1.5 py-0.5 border border-amber-500/50 text-amber-300 bg-amber-500/10">★ {c}</button>)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5"><span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 w-20">Airfields</span>
              {mustTrack.icaos.length === 0 && <span className="text-slate-600">none — ★ an airfield row below</span>}
              {mustTrack.icaos.map((i) => <button key={i} onClick={() => star("icao", i)} disabled={mtBusy} className="text-[10px] font-mono rounded px-1.5 py-0.5 border border-amber-500/50 text-amber-300 bg-amber-500/10">★ {i}</button>)}
            </div>
          </div>
        )}

        {/* column header */}
        <div className="hidden lg:grid grid-cols-[22px_1.6fr_1fr_1.1fr_.9fr_.9fr_.9fr_.9fr_20px] gap-2.5 px-3.5 py-1.5 border-b border-slate-800 text-[8.5px] font-bold uppercase tracking-[0.12em] text-slate-600">
          <span /><span>command</span><span>I&amp;W</span><span>posture</span><span>bases</span><span>demand · 7d</span><span>events</span><span>Δ since look</span><span />
        </div>

        {!data && !error && <p className="px-3.5 py-4 text-[11px] text-slate-500">Assembling the command picture…</p>}
        {data && shownRows.length === 0 && quietRows.length === rows.length && (
          <p className="px-3.5 py-4 text-[11.5px] text-slate-400">Nothing is watched yet. Declare a hub, spokes and an AOI in <b>Preferences → Mission Profile</b>, or <button type="button" onClick={() => openTrackPicker()} className="text-emerald-400 hover:underline">track a country or airfield</button>, and the commands fill in. {quietRows.length} commands are quiet — absence of signal, not evidence of calm.</p>
        )}
        {data && shownRows.map((r) => (
          <CommandRowView key={r.aor} row={r} data={data} open={open} setOpen={setOpen} go={go} star={star} mtBusy={mtBusy} flash={flash} active={active} countryForce={countryForce} />
        ))}
        {data && quietRows.length > 0 && (
          <div className="border-t border-slate-800">
            <button onClick={() => setOthersOpen((v) => !v)} className="w-full text-left px-3.5 py-2 flex items-center gap-2 text-[11px] text-slate-400 hover:bg-slate-800/40">
              <span className="text-slate-600">{othersOpen ? "▾" : "▸"}</span>
              <b className="text-slate-300">{quietRows.length} other command{quietRows.length === 1 ? "" : "s"}</b>
              <span className="text-slate-500 truncate">{quietRows.map((q) => `${q.aor} — ${q.why}`).join(" · ")}</span>
              <span className="ml-auto text-[9.5px] font-bold uppercase tracking-wider">{othersOpen ? "hide" : "show"}</span>
            </button>
            {othersOpen && quietRows.map((r) => (
              <CommandRowView key={r.aor} row={r} data={data} open={open} setOpen={setOpen} go={go} star={star} mtBusy={mtBusy} flash={flash} active={active} countryForce={countryForce} />
            ))}
          </div>
        )}
        {data && (
          <p className="px-3.5 py-1.5 border-t border-slate-800 text-[9px] text-slate-600 font-mono">
            as of {data.generatedAt.slice(11, 16)}Z · sources: {Object.entries(data.board.sources).map(([k, v]) => `${k}${v ? "" : " ✕"}`).join(" · ")}{data.primer.sourcesDown.length ? ` · down: ${data.primer.sourcesDown.join(", ")}` : ""} · UNKNOWN is never folded into green
          </p>
        )}
      </section>

      {/* ── The picture — follows whatever is open ── */}
      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 -mb-2">Picture{open.aor ? ` — following ${short(open.aor)}` : ""}</p>
      <ErrorBoundary label="Crisis map" minHeight="420px">
        <CrisisMap boardAor={open.aor} starAors={starAors} myFields={myFieldsForMap} sinceMs={data?.sinceMs ?? 0} />
      </ErrorBoundary>
    </div>
  );
}

// ── One command row + its drill ────────────────────────────────────────────

function CommandRowView({ row: r, data, open, setOpen, go, star, mtBusy, flash, active, countryForce }: {
  row: CommandRow; data: Body; open: OpenState; setOpen: (o: OpenState) => void; go: (d: PrimerDoor) => void;
  star: (k: "aor" | "country" | "icao", v: string) => void; mtBusy: boolean; flash: string | null; active: boolean;
  countryForce: (c: CountryRow) => { sel: ForceAssessment | null; base: ForceAssessment | null };
}) {
  const isOpen = open.aor === r.aor;
  const detail = data.board.details[r.aor];
  const rowKey = `cb-cmd-${r.aor}`;
  const toggle = () => setOpen(isOpen ? CLOSED : { aor: r.aor, board: null, country: null, icao: null });
  const worstTone = r.posture.worst === "red" || r.iw?.level === "alert" || r.bases.worst === "r" ? "red" : r.posture.worst === "amber" || r.iw?.level === "warning" || r.iw?.level === "watch" || r.bases.worst === "a" ? "amber" : null;

  return (
    <div id={rowKey} className={`border-t border-slate-800 ${flash === rowKey ? "ring-2 ring-sky-400/60" : ""}`}>
      <button onClick={toggle} className={`w-full text-left grid grid-cols-[22px_1fr_20px] lg:grid-cols-[22px_1.6fr_1fr_1.1fr_.9fr_.9fr_.9fr_.9fr_20px] gap-2.5 items-center px-3.5 py-2.5 transition-colors hover:bg-slate-800/30 ${isOpen ? "bg-slate-800/40" : ""} ${r.star ? "border-l-2 border-l-amber-400/70" : "border-l-2 border-l-transparent"}`}>
        <Star on={r.star} label={r.aor} onClick={() => star("aor", r.aor)} disabled={mtBusy} />
        <span className="min-w-0">
          <span className="block text-[13.5px] font-extrabold tracking-wide text-slate-100">{AOR_LABELS[r.aor]}</span>
          <span className={`block text-[10.5px] leading-snug ${worstTone === "red" ? "text-red-300/90" : worstTone === "amber" ? "text-amber-300/90" : "text-slate-500"}`}>{r.why}</span>
        </span>
        <span className="hidden lg:flex flex-col gap-0.5 min-w-0">
          {r.iw ? (<>
            <span className={`text-[9px] font-bold uppercase tracking-widest border rounded px-1.5 py-0.5 w-fit ${LVL_CHIP[r.iw.level]}`}>{r.iw.level}</span>
            <span className="text-[9.5px] font-mono text-slate-500">{r.iw.anomaly >= 0 ? "+" : "−"}{Math.abs(r.iw.anomaly).toFixed(2)} {TRAJ[r.iw.trajectory]} · {r.iw.boards} board{r.iw.boards === 1 ? "" : "s"}{r.iw.learning ? " · learning" : ""}</span>
          </>) : <span className="text-[9.5px] text-slate-600 italic">no board</span>}
        </span>
        <span className="hidden lg:flex flex-col gap-0.5">
          <span className="flex gap-0.5">
            {Array.from({ length: r.posture.red }).map((_, i) => <span key={`r${i}`} className="w-2 h-2 rounded-full bg-red-500" />)}
            {Array.from({ length: r.posture.amber }).map((_, i) => <span key={`a${i}`} className="w-2 h-2 rounded-full bg-amber-400" />)}
            {Array.from({ length: r.posture.unknown }).map((_, i) => <span key={`u${i}`} className="w-2 h-2 rounded-full bg-slate-600" />)}
            {Array.from({ length: Math.min(r.posture.green, 6) }).map((_, i) => <span key={`g${i}`} className="w-2 h-2 rounded-full bg-emerald-500" />)}
            {r.posture.watched === 0 && <span className="w-2 h-2 rounded-full border border-slate-700" />}
          </span>
          <span className="text-[9.5px] font-mono text-slate-500">{r.posture.watched ? `${r.posture.red} red · ${r.posture.amber} amber${r.posture.unknown ? ` · ${r.posture.unknown} unk` : ""}${r.posture.escalated ? ` · ${r.posture.escalated} ↑` : ""}` : "none watched"}</span>
        </span>
        <span className="hidden lg:flex flex-col gap-0.5">
          {r.bases.count ? (<>
            <span className="flex gap-0.5">{Array.from({ length: r.bases.count }).map((_, i) => <span key={i} className={`w-2 h-2 rounded-full ${i < r.bases.red ? "bg-red-500" : i < r.bases.red + r.bases.amber ? "bg-amber-400" : "bg-emerald-500"}`} />)}</span>
            <span className="text-[9.5px] font-mono text-slate-500">{r.bases.count} · {r.bases.worse ? `${r.bases.worse} ↑` : "steady"}</span>
          </>) : <span className="text-[9.5px] text-slate-600 italic">none</span>}
        </span>
        <span className="hidden lg:flex flex-col gap-0.5">
          {r.demand ? (<>
            <span className={`text-[10px] font-extrabold uppercase tracking-widest ${DEMAND_CLASS[r.demand.direction]}`}>{r.demand.direction}</span>
            <span className="text-[9.5px] font-mono text-slate-500">{r.demand.score >= 0 ? "+" : ""}{r.demand.score} · {r.demand.confidence}</span>
          </>) : <span className="text-[9.5px] text-slate-600 italic">—</span>}
        </span>
        <span className="hidden lg:flex flex-col gap-0.5">
          <span className="text-[10.5px] font-mono text-slate-300">{r.events.total ? `${r.events.kinetic} ✸ · ${r.events.neo} NEO · ${r.events.disaster} ●` : "—"}</span>
          <span className="text-[9.5px] font-mono text-slate-500">{r.events.fresh ? `${r.events.fresh} new` : r.events.total ? "none new" : ""}</span>
        </span>
        <span className="hidden lg:block text-[10.5px] font-mono">
          <span className={r.delta.worse ? "text-red-300 font-bold" : "text-slate-500"}>{r.delta.worse} worse</span>
          <span className="text-slate-600"> · </span>
          <span className={r.delta.better ? "text-emerald-300 font-bold" : "text-slate-500"}>{r.delta.better} better</span>
          {r.delta.fresh ? <span className="text-slate-500"> · {r.delta.fresh} new</span> : null}
        </span>
        <span className="text-slate-600 text-[10px] justify-self-end">{isOpen ? "▾" : "▸"}</span>
      </button>

      {isOpen && detail && (
        <div className="px-3.5 pb-3 pl-9 space-y-3 bg-slate-950/30">
          {/* Boards */}
          {detail.boards.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 pt-2">I&amp;W boards · {detail.boards.length}</p>
              <div className="flex flex-wrap gap-2">
                {detail.boards.map((b: CbBoard) => {
                  const bOpen = open.board === b.problemId;
                  return (
                    <button key={b.problemId} id={`cb-board-${b.problemId}`} onClick={() => { if (!bOpen) noteOpen("board", b.problemId); setOpen({ ...open, board: bOpen ? null : b.problemId }); }}
                      className={`text-left rounded-xl border px-3 py-2 min-w-[220px] flex-1 max-w-[420px] hover:bg-slate-800/40 transition-colors ${flash === `cb-board-${b.problemId}` ? "ring-2 ring-sky-400/60" : ""} ${b.level === "alert" ? "border-red-500/50" : b.level === "warning" ? "border-orange-500/50" : b.level === "watch" ? "border-amber-500/40" : "border-slate-800"}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-bold text-slate-100 truncate">{b.label}</span>
                        <span className={`ml-auto text-[9px] font-bold uppercase tracking-widest border rounded px-1.5 py-0.5 ${LVL_CHIP[b.level]}`}>{b.level}</span>
                        <span className="text-[10px] font-mono text-amber-300">{b.anomaly >= 0 ? "+" : "−"}{Math.abs(b.anomaly).toFixed(2)} {TRAJ[b.trajectory]}</span>
                        <span className="text-slate-600 text-[10px]">{bOpen ? "▴" : "▾"}</span>
                      </div>
                      <p className="text-[10.5px] text-slate-500 mt-0.5 truncate">{b.learning ? "learning mode — baseline forming" : b.drivers[0] ?? "no active drivers"}</p>
                    </button>
                  );
                })}
              </div>
              {open.board && detail.boards.some((b) => b.problemId === open.board) && (
                <div className="border border-slate-800 rounded-xl p-3 bg-slate-950/40">
                  <WarningBoard active={active} only={[open.board]} />
                </div>
              )}
            </div>
          )}

          {/* Countries */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 pt-1 pb-1">Countries · {detail.countries.length} <span className="normal-case tracking-normal font-normal text-slate-600">— ★ first, then worst</span></p>
            {detail.countries.length === 0 && <p className="text-[11px] text-slate-500">Nothing watched in {AOR_LABELS[r.aor]}. <button type="button" onClick={() => openTrackPicker()} className="text-emerald-400 hover:underline">Track a country or an airfield</button>, or ★ one from the Must-tracks panel.</p>}
            {detail.countries.map((c: CountryRow) => (
              <CountryRowView key={c.country} c={c} open={open} setOpen={setOpen} star={star} mtBusy={mtBusy} flash={flash} active={active} force={countryForce(c)} go={go} />
            ))}
          </div>

          {detail.deltas.length > 0 && (
            <p className="text-[10px] text-slate-500 font-mono">Δ since your last look: {detail.deltas.map((d) => `${d.label}${d.axis ? ` ${d.axis}` : ""} ${d.from ?? "—"}→${d.to}`).join(" · ")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function CountryRowView({ c, open, setOpen, star, mtBusy, flash, active, force, go }: {
  c: CountryRow; open: OpenState; setOpen: (o: OpenState) => void; star: (k: "aor" | "country" | "icao", v: string) => void; mtBusy: boolean;
  flash: string | null; active: boolean; force: { sel: ForceAssessment | null; base: ForceAssessment | null }; go: (d: PrimerDoor) => void;
}) {
  const key = `cb-country-${lc(c.country).replace(/\s+/g, "-")}`;
  const isOpen = open.country != null && lc(open.country) === lc(c.country);
  const pinned = c.fields.find((f) => f.sitrep) ?? c.fields[0];
  const toggle = () => setOpen(isOpen ? { ...open, country: null, icao: null } : { ...open, country: c.country, icao: null });
  return (
    <div id={key} className={`border-t border-slate-800/70 ${flash === key ? "ring-2 ring-sky-400/60 rounded" : ""}`}>
      <button onClick={toggle} className={`w-full text-left grid grid-cols-[22px_12px_1fr_20px] lg:grid-cols-[22px_12px_1.4fr_1fr_1fr_.8fr_.8fr_20px] gap-2.5 items-center py-2 pr-1 hover:bg-slate-800/30 ${isOpen ? "bg-slate-800/30" : ""}`}>
        <Star on={c.star} label={c.country} onClick={() => star("country", c.country)} disabled={mtBusy} />
        <Dot sev={c.worst} title={c.worst ? `${c.worst}${c.escalated ? " · escalated today" : ""}` : "not in the posture watch — UNKNOWN"} />
        <span className="min-w-0">
          <span className="text-[13px] font-semibold text-slate-100">{c.country}</span>
          {c.escalated && <span className="ml-1.5 text-[8px] font-bold uppercase tracking-wider text-red-300 border border-red-500/40 rounded px-1">↑ escalated</span>}
          {c.chronicity && c.chronicity !== "new" && c.chronicity !== "unknown" && <span className="ml-1.5 text-[8px] font-mono text-slate-500">{c.chronicity}</span>}
          {c.unwatched && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); openTrackPicker({ kind: "country", country: c.country }); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openTrackPicker({ kind: "country", country: c.country }); } }} title="Not in the posture watch — click to track it" className="ml-1.5 text-[8px] font-mono text-amber-300/80 hover:text-emerald-300 underline decoration-dotted">unwatched · track</span>}
        </span>
        <span className="hidden lg:block text-[10.5px] text-slate-400 truncate">{c.topDriver || "—"}</span>
        <span className="hidden lg:flex items-center gap-1.5 text-[10px] font-mono text-slate-400 min-w-0">
          {pinned ? (<><span className="text-slate-300">{pinned.icao}</span>{pinned.sitrep ? <Leds status={pinned.sitrep.status} /> : <Dot sev={pinned.posture?.composite ?? null} />}{c.fields.length > 1 && <span className="text-slate-600">+{c.fields.length - 1}</span>}</>) : <span className="text-slate-600">no field</span>}
        </span>
        <span className="hidden lg:block text-[10px] font-mono"><span className={c.delta.worse ? "text-red-300" : "text-slate-500"}>{c.delta.worse} worse</span><span className="text-slate-600"> · </span><span className={c.delta.better ? "text-emerald-300" : "text-slate-500"}>{c.delta.better} better</span></span>
        <span className="hidden lg:block text-[10px] font-mono text-slate-500">{c.events ? `${c.events} event${c.events === 1 ? "" : "s"}` : "—"}</span>
        <span className="text-slate-600 text-[10px] justify-self-end">{isOpen ? "▾" : "▸"}</span>
      </button>

      {isOpen && (
        <div className="pl-5 pb-3 space-y-3">
          <CountryRoom country={c.country} sel={force.sel} base={force.base} active={active} />

          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 pb-1">Airfields · {c.fields.length}</p>
            {c.fields.length === 0 && <p className="text-[11px] text-slate-500">No airfield watched in {c.country}. <button type="button" onClick={() => openTrackPicker({ kind: "airfield", query: c.country })} className="text-emerald-400 hover:underline">Track one</button> — search by ICAO, name or country.</p>}
            {c.fields.map((f: FieldRow) => {
              const fKey = `cb-field-${f.icao}`;
              const fOpen = open.icao === f.icao;
              return (
                <div key={f.icao} id={fKey} className={`border-t border-slate-800/60 ${flash === fKey ? "ring-2 ring-sky-400/60 rounded" : ""}`}>
                  <button onClick={() => { if (!f.hasSitrep) { star("icao", f.icao); return; } if (!fOpen) noteOpen("base", f.icao); setOpen({ ...open, icao: fOpen ? null : f.icao }); }}
                    className={`w-full text-left grid grid-cols-[22px_1fr_auto_20px] gap-2.5 items-center py-2 pr-1 hover:bg-slate-800/30 ${fOpen ? "bg-slate-800/30" : ""}`}>
                    <Star on={f.star} label={f.icao} onClick={() => star("icao", f.icao)} disabled={mtBusy} />
                    <span className="min-w-0 flex items-center gap-2 flex-wrap">
                      <span className="text-[12.5px] font-extrabold font-mono text-slate-100">{f.icao}</span>
                      {f.role && <span className="text-[8px] font-bold uppercase tracking-widest border border-slate-700 rounded px-1 py-px text-slate-400">{f.role}</span>}
                      <span className="text-[11px] text-slate-400 truncate">{f.label}</span>
                      <span className="text-[10.5px] text-slate-500 truncate">{f.sitrep ? f.sitrep.driver : f.posture ? f.posture.topDriver : "posture UNKNOWN — not watched"}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {f.sitrep ? <Leds status={f.sitrep.status} size="w-2 h-2" /> : <Dot sev={f.posture?.composite ?? null} />}
                      {f.sitrep && f.sitrep.worse.length > 0 && <span className="text-[9px] font-bold text-amber-400" title={`worse than yesterday: ${f.sitrep.worse.join(", ")}`}>↑</span>}
                      {!f.hasSitrep && <span className="text-[9px] text-slate-500 whitespace-nowrap">★ to get a SITREP</span>}
                      {!f.posture && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); openTrackPicker({ kind: "airfield", icao: f.icao }); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openTrackPicker({ kind: "airfield", icao: f.icao }); } }} className="text-[9px] text-amber-300/80 hover:text-emerald-300 underline decoration-dotted whitespace-nowrap">track</span>}
                    </span>
                    <span className="text-slate-600 text-[10px] justify-self-end">{f.hasSitrep ? (fOpen ? "▾" : "▸") : ""}</span>
                  </button>
                  {fOpen && f.hasSitrep && (
                    <div className="border border-slate-800 rounded-xl p-3 bg-slate-950/40 mb-2">
                      <SitrepPanel active={active} focusIcao={f.icao} single />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button onClick={() => go({ aor: c.aor })} className="text-[9.5px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300">← back to {short(c.aor)}</button>
        </div>
      )}
    </div>
  );
}
