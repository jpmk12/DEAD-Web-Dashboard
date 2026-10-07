"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openTrackPicker, postTrack, roleBody, untrackAirfieldBody, untrackCountryBody, type TrackResponse } from "@/lib/trackClient";
import dynamic from "next/dynamic";
import ErrorBoundary from "@/components/ErrorBoundary";
import ReactivationCard from "@/components/osint/ReactivationCard";
import RoomDrawer from "@/components/osint/RoomDrawer";
import CommandAirfields from "@/components/osint/CommandAirfields";
import { Leds, Dot, Star, RoleSwitch, Untrack, LVL_CHIP, TRAJ, type EditOps } from "@/components/osint/boardBits";
import { getForceProtectionData } from "@/lib/forceProtectionClient";
import type { ForceAssessment } from "@/lib/forceProtection";
import type { CommandsBody } from "@/lib/commandsAssemble";
import type { CommandRow, CountryRow, CbBoard, Led } from "@/lib/commandBoard";
import type { PrimerDoor, PrimerItem } from "@/lib/primer";
import { toggleMustTrack, type MustTrack } from "@/lib/missionProfile";
import { AOR_LABELS, type Aor } from "@/lib/aor";
import { parseRoomParam, roomParam, roomAor, doorRoom, findField, findCountry, sameRoom, type RoomRef } from "@/lib/room";
import { noteOpen } from "@/lib/noteOpenClient";
import { toast } from "@/lib/feedback";

// The OSINT command board — REVIEW-2026-10 §6, rebuilt around THE ROOM in
// §11 (decisions C + A′ + C′). One scrolling page of LISTS: WHERE TO LOOK
// FIRST (the deterministic primer, AI read on tap) → MY AIRFIELDS (hub,
// spokes, ★ fields pinned) → COMBATANT COMMANDS (one row each, ★ first then
// worst; a row drills in place to its boards and countries ONLY) → AIRFIELDS
// BY COMMAND (every tracked field, the full register) → THE PICTURE (the
// Crisis map and its Significant-events list, which follow whatever is open).
//
// Every detail — a country's situation room, an airfield's SITREP, a board —
// opens in the room (components/osint/RoomDrawer.tsx), a drawer that slides
// over the page from the right (a full-screen sheet on a phone; ⇥ pin docks
// it as a right column on a wide screen). The page behind never reflows.
// The open room is in the URL as `?room=country:Germany` so ⌘K, the
// primer's doors, Glance's tiles and a pasted link all open the same thing.
//
// Mount contract: the parent keeps this hidden-mounted after first activation
// so the map does not re-fetch its ~15 sources on every pane hop; the board
// arms itself lazily on first activation (all tabs mount at app load). The
// room renders only while the pane is ACTIVE — it is position:fixed and
// would otherwise cover the other panes.
//
// Every ★ is a Mission Profile write (owner) through PATCH /api/mission-profile
// — the board never keeps its own tracking state. Add / remove / hub·spoke
// go through the ONE Track door (`postTrack` → /api/track): ＋ Track… opens
// the picker prefilled; ✕ on an airfield or country row is a full untrack (a
// hub/spoke loses its role on the same write); the hub/spoke switch is op
// "role". Every write returns the server's `undo`, shown in a strip for a
// few seconds; the board reloads on `tracking:changed`.

const CrisisMap = dynamic(() => import("@/components/osint/CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[420px] bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse flex items-center justify-center text-xs text-slate-600 font-mono uppercase tracking-wider">
      Loading crisis map…
    </div>
  ),
});

type Body = CommandsBody & { canEdit?: boolean };

const DEMAND_CLASS: Record<string, string> = { rise: "text-amber-300", hold: "text-slate-400", fall: "text-emerald-400" };
const TONE_RING: Record<string, string> = { red: "border-red-500/50 text-red-300", amber: "border-amber-500/50 text-amber-300", slate: "border-slate-700 text-slate-400" };
const short = (aor: Aor) => AOR_LABELS[aor].replace(/^US/, "");
const lc = (s: string) => s.trim().toLowerCase();
const PIN_KEY = "commands.roomPinned";

/** The URL half of the room: `?room=` written on open, removed on close. */
function writeRoomParam(ref: RoomRef | null) {
  try {
    const u = new URL(window.location.href);
    if (ref) u.searchParams.set("room", roomParam(ref)); else u.searchParams.delete("room");
    window.history.replaceState(null, "", u.toString());
  } catch { /* ignore */ }
}

export default function CommandBoard({ active }: { active: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (active && !armed) setArmed(true); }, [active, armed]);

  const [data, setData] = useState<Body | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const sinceRef = useRef<number | null>(null);
  const pollTries = useRef(0);
  const [openAor, setOpenAor] = useState<Aor | null>(null);
  const [room, setRoom] = useState<RoomRef | null>(null);
  const [pinned, setPinned] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [mtPanel, setMtPanel] = useState(false);
  const [primerOpen, setPrimerOpen] = useState(true);
  const [mineOpen, setMineOpen] = useState(true);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [forces, setForces] = useState<ForceAssessment[]>([]);
  const [mtBusy, setMtBusy] = useState(false);
  const [trkBusy, setTrkBusy] = useState(false);
  const [undoBar, setUndoBar] = useState<{ text: string; body: Record<string, unknown> } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parked = useRef<{ kind: "sitrep" | "iw" | "country"; id: string } | null>(null);

  useEffect(() => {
    try {
      setPrimerOpen(localStorage.getItem("commands.primerOpen") !== "0");
      setMineOpen(localStorage.getItem("commands.mineOpen") !== "0");
      setPinned(localStorage.getItem(PIN_KEY) === "1");
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
    // A Track anywhere (picker, Weather ✕, Preferences, this board) drops the
    // server's commands cache; re-read so the strip and the rows agree.
    window.addEventListener("tracking:changed", load);
    return () => { clearInterval(id); window.removeEventListener("tracking:changed", load); };
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

  // ── The room ──
  const openRoom = useCallback((ref: RoomRef) => {
    setRoom(ref);
    if (data) { const a = roomAor(data.board, ref); if (a) setOpenAor(a); }
    if (ref.kind === "field") noteOpen("base", ref.id);
    else if (ref.kind === "board") noteOpen("board", ref.id);
    // (a country notes itself when its dossier mounts)
    writeRoomParam(ref);
  }, [data]);
  const closeRoom = useCallback(() => { setRoom(null); writeRoomParam(null); }, []);
  const togglePin = () => setPinned((v) => { try { localStorage.setItem(PIN_KEY, v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  // Once the board lands, the open room's command is known — the drill and the map follow it.
  useEffect(() => {
    if (!data || !room) return;
    const a = roomAor(data.board, room);
    if (a) setOpenAor((cur) => cur ?? a);
  }, [data, room]);

  // ── Doors in: a primer door, watch:focus {kind, id}, regional:select, ?room= ──
  // A door names its deepest level: that opens in the room; the command it
  // belongs to drills open behind it and its row is flashed.
  const go = useCallback((door: PrimerDoor) => {
    setOpenAor(door.aor);
    const ref = doorRoom(door);
    if (ref) openRoom(ref);
    const key = `cb-cmd-${door.aor}`;
    setFlash(key);
    if (!ref) setTimeout(() => document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    setTimeout(() => setFlash((f) => (f === key ? null : f)), 3_500);
  }, [openRoom]);

  const resolveDoor = useCallback((req: { kind: "sitrep" | "iw" | "country"; id: string }, body: Body): PrimerDoor | null => {
    const details = Object.values(body.board.details);
    if (req.kind === "sitrep") {
      const f = findField(body.board, req.id);
      return f && f.aor !== "UNKNOWN" ? { aor: f.aor, country: f.country || undefined, icao: f.icao } : null;
    }
    if (req.kind === "iw") {
      if (!req.id) { const worst = body.board.rows.find((r) => r.iw); return worst ? { aor: worst.aor } : null; }
      for (const d of details) for (const b of d.boards) if (b.problemId === req.id) return { aor: d.aor, problemId: b.problemId };
      return null;
    }
    const c = findCountry(body.board, req.id);
    return c ? { aor: c.aor, country: c.country } : null;
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
    // A pasted / reloaded link with ?room= — parked like any other door.
    try {
      const ref = parseRoomParam(new URLSearchParams(window.location.search).get("room"));
      if (ref) { parked.current = { kind: ref.kind === "field" ? "sitrep" : ref.kind === "board" ? "iw" : "country", id: ref.id }; setArmed(true); }
    } catch { /* ignore */ }
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

  // ── Track / untrack / role: the ONE door, with the server's undo shown briefly ──
  const showUndo = useCallback((d: TrackResponse, what: string) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (!d.changes?.length || !d.undo) { setUndoBar(null); return; }
    setUndoBar({ text: `${what} — ${d.changes.join(" · ")}`, body: d.undo });
    undoTimer.current = setTimeout(() => setUndoBar(null), 20_000);
  }, []);
  const track = useCallback(async (body: Record<string, unknown>, what: string) => {
    if (!data?.canEdit) { toast.info("Tracking is team config — the owner changes it"); return; }
    setTrkBusy(true);
    try {
      const d = await postTrack(body);
      if (!d.error) showUndo(d, what);
    } finally { setTrkBusy(false); }
  }, [data?.canEdit, showUndo]);
  const undoTrack = useCallback(async () => {
    if (!undoBar) return;
    const body = undoBar.body;
    setUndoBar(null);
    setTrkBusy(true);
    try {
      const d = await postTrack(body, { quiet: true });
      if (d.error) toast.error("Could not undo", d.error);
      else toast.ok("Undone", d.changes?.join(" · "));
    } finally { setTrkBusy(false); }
  }, [undoBar]);
  const setRole = (icao: string, role: "hub" | "spoke" | null) => track(roleBody(icao, role), role ? `${icao} → ${role}` : `${icao} role cleared`);
  const untrackField = (icao: string, own: "hub" | "spoke" | null) => {
    if (room?.kind === "field" && room.id === icao) closeRoom();
    return track(untrackAirfieldBody(icao, own), `${icao} untracked`);
  };
  const untrackCountry = (country: string) => track(untrackCountryBody(country), `${country} untracked`);
  const editOps: EditOps | null = data?.canEdit ? { busy: trkBusy, setRole, untrackField, untrackCountry } : null;

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
  const roomAorNow = data && room ? roomAor(data.board, room) : null;
  const mapAor = roomAorNow ?? openAor;

  if (!armed) return null;

  const crumbParts: string[] = [];
  if (openAor) crumbParts.push(short(openAor));
  if (room && data) {
    if (room.kind === "field") { const f = findField(data.board, room.id); if (f?.country) crumbParts.push(f.country); crumbParts.push(room.id); }
    else if (room.kind === "country") crumbParts.push(room.id);
    else crumbParts.push("board");
  }
  const crumb = crumbParts.length ? crumbParts.join(" › ") : null;
  const roomOpen = !!room && !!data;

  return (
    <div className={roomOpen && pinned ? "xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(520px,46%)] xl:gap-4 xl:items-start" : ""}>
    <div className="space-y-4 min-w-0">
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
                <button onClick={() => go(it.door)} className="self-center text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 whitespace-nowrap" title="Open exactly this level in the room">{it.doorLabel}</button>
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

      {/* ── Undo strip: the last tracking write, reversible for 20 s ── */}
      {undoBar && (
        <div className="flex items-center gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-[11px] text-sky-100">
          <span className="min-w-0 truncate" title={undoBar.text}>{undoBar.text}</span>
          <span className="flex-1" />
          <button onClick={undoTrack} disabled={trkBusy} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-sky-400/60 text-sky-200 hover:bg-sky-500/20 disabled:opacity-50 whitespace-nowrap">↶ Undo</button>
          <button onClick={() => setUndoBar(null)} aria-label="Dismiss" className="text-slate-500 hover:text-slate-300 text-[11px]">✕</button>
        </div>
      )}

      {/* ── My airfields ── */}
      {data && (data.board.myFields.length > 0 || canEdit) && (
        <section className="border border-slate-800 rounded-xl bg-slate-900/40 overflow-hidden">
          <div className="px-3.5 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-200">✈ My airfields</span>
            <span className="text-[10px] text-slate-500">hub · spokes · ★ must-track fields — a SITREP one click from anywhere</span>
            <span className="flex-1" />
            {canEdit && (
              <button onClick={() => openTrackPicker({ kind: "airfield" })} title="Track an airfield (search by ICAO, name or country); then set hub / spoke on its card" className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">＋ Track…</button>
            )}
            <button onClick={() => setMineOpen((v) => !v)} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200">{mineOpen ? "fold ▴" : "unfold ▾"}</button>
          </div>
          {data.board.myFields.length === 0 && (
            <p className="px-3.5 py-3 text-[11px] text-slate-500">No own-force airfield declared. <button type="button" onClick={() => openTrackPicker({ kind: "airfield" })} className="text-emerald-400 hover:underline">＋ Track…</button> a field, then mark it <b>hub</b> or <b>spoke</b> on its card — or declare them in Preferences → Mission Profile.</p>
          )}
          {!mineOpen && data.board.myFields.length > 0 && (
            <p className="px-3.5 py-2 text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
              {data.board.myFields.map((f) => <button key={f.icao} onClick={() => openRoom({ kind: "field", id: f.icao })} className="flex items-center gap-1.5 hover:text-sky-200"><span className="font-mono font-bold text-slate-200">{f.icao}</span>{f.sitrep ? <Leds status={f.sitrep.status} /> : <Dot sev={f.posture?.composite ?? null} />}</button>)}
            </p>
          )}
          {mineOpen && data.board.myFields.length > 0 && (
            <div className="px-3.5 py-2.5 flex flex-wrap gap-2">
              {data.board.myFields.map((f) => {
                const worst = f.sitrep ? (["r", "a", "u", "g"] as Led[]).find((l) => Object.values(f.sitrep!.status).includes(l)) ?? "g" : null;
                const sel = sameRoom(room, { kind: "field", id: f.icao });
                return (
                  <div key={f.icao} id={`cb-mine-${f.icao}`} className={`min-w-[200px] flex-1 max-w-[320px] rounded-xl border transition-colors ${sel ? "ring-2 ring-sky-400/60" : ""} ${worst === "r" ? "border-red-500/50" : worst === "a" ? "border-amber-500/40" : "border-slate-800"}`}>
                    <button onClick={() => openRoom({ kind: "field", id: f.icao })} title="Open the SITREP in the room" className="w-full text-left px-3 pt-2 pb-1 rounded-t-xl hover:bg-slate-800/40">
                      <div className="flex items-center gap-1.5">
                        <Star on={f.star} label={f.icao} onClick={() => star("icao", f.icao)} disabled={mtBusy} />
                        <span className="text-[13px] font-extrabold font-mono text-slate-100">{f.icao}</span>
                        {f.role && !canEdit && <span className="text-[8px] font-bold uppercase tracking-widest border border-slate-700 rounded px-1 py-px text-slate-400">{f.role}</span>}
                        <span className="ml-auto">{f.sitrep ? <Leds status={f.sitrep.status} size="w-2 h-2" /> : <Dot sev={f.posture?.composite ?? null} />}</span>
                        {f.sitrep && f.sitrep.worse.length > 0 && <span className="text-[9px] font-bold text-amber-400" title={`worse than yesterday: ${f.sitrep.worse.join(", ")}`}>↑</span>}
                      </div>
                      <p className={`text-[10.5px] mt-1 truncate ${worst === "r" ? "text-red-300" : worst === "a" ? "text-amber-300" : "text-slate-400"}`}>{f.sitrep ? f.sitrep.driver : f.posture ? f.posture.topDriver : "not watched — posture UNKNOWN"}</p>
                      <p className="text-[9px] font-mono text-slate-600 mt-0.5 truncate">{f.aor !== "UNKNOWN" ? short(f.aor) : "—"} · {f.country || "—"} · {f.hasSitrep ? "SITREP →" : "★ to get a SITREP"}</p>
                    </button>
                    {canEdit && (
                      <div className="flex items-center gap-2 px-3 pb-1.5 pt-0.5">
                        <RoleSwitch icao={f.icao} role={f.role} onSet={(r) => setRole(f.icao, r)} disabled={trkBusy} />
                        <span className="flex-1" />
                        <Untrack label={f.icao} onClick={() => untrackField(f.icao, f.role)} disabled={trkBusy} />
                      </div>
                    )}
                  </div>
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
          <span className="text-[10px] text-slate-500">{crumb ? <><span className="text-slate-600">open:</span> <b className="text-sky-200 font-mono">{crumb}</b></> : "★ must-tracks first, then worst · click a command to drill · a country row opens its room →"}</span>
          <span className="flex-1" />
          {(openAor || room) && <button onClick={() => { setOpenAor(null); closeRoom(); }} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200">collapse all</button>}
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
          <CommandRowView key={r.aor} row={r} data={data} openAor={openAor} setOpenAor={setOpenAor} room={room} openRoom={openRoom} star={star} mtBusy={mtBusy} flash={flash} edit={editOps} />
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
              <CommandRowView key={r.aor} row={r} data={data} openAor={openAor} setOpenAor={setOpenAor} room={room} openRoom={openRoom} star={star} mtBusy={mtBusy} flash={flash} edit={editOps} />
            ))}
          </div>
        )}
        {data && (
          <p className="px-3.5 py-1.5 border-t border-slate-800 text-[9px] text-slate-600 font-mono">
            as of {data.generatedAt.slice(11, 16)}Z · sources: {Object.entries(data.board.sources).map(([k, v]) => `${k}${v ? "" : " ✕"}`).join(" · ")}{data.primer.sourcesDown.length ? ` · down: ${data.primer.sourcesDown.join(", ")}` : ""} · UNKNOWN is never folded into green
          </p>
        )}
      </section>

      {/* ── Airfields by command — the full register (A′) ── */}
      {data && <CommandAirfields board={data.board} room={room} onOpen={openRoom} star={star} mtBusy={mtBusy} edit={editOps} canEdit={canEdit} />}

      {/* ── The picture — follows whatever is open ── */}
      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600 -mb-2">Picture{mapAor ? ` — following ${room ? "the room" : "the board"} · ${short(mapAor)}` : ""}</p>
      <ErrorBoundary label="Crisis map" minHeight="420px">
        <CrisisMap boardAor={mapAor} starAors={starAors} myFields={myFieldsForMap} sinceMs={data?.sinceMs ?? 0} />
      </ErrorBoundary>
    </div>

    {/* ── The room ── */}
    {roomOpen && (
      <RoomDrawer room={room!} board={data!.board} forces={forces} active={active} pinned={pinned} onPin={togglePin} onClose={closeRoom} onOpen={openRoom} star={star} mtBusy={mtBusy} edit={editOps} />
    )}
    </div>
  );
}

// ── One command row + its drill (boards + countries; every row is a door) ──

function CommandRowView({ row: r, data, openAor, setOpenAor, room, openRoom, star, mtBusy, flash, edit }: {
  row: CommandRow; data: Body; openAor: Aor | null; setOpenAor: (a: Aor | null) => void; room: RoomRef | null; openRoom: (ref: RoomRef) => void;
  star: (k: "aor" | "country" | "icao", v: string) => void; mtBusy: boolean; flash: string | null; edit: EditOps | null;
}) {
  const isOpen = openAor === r.aor;
  const detail = data.board.details[r.aor];
  const rowKey = `cb-cmd-${r.aor}`;
  const toggle = () => setOpenAor(isOpen ? null : r.aor);
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
          {/* Boards — each a door into the room */}
          {detail.boards.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 pt-2">I&amp;W boards · {detail.boards.length} <span className="normal-case tracking-normal font-normal text-slate-600">— tap opens the full board in the room</span></p>
              <div className="flex flex-wrap gap-2">
                {detail.boards.map((b: CbBoard) => {
                  const sel = sameRoom(room, { kind: "board", id: b.problemId });
                  return (
                    <button key={b.problemId} id={`cb-board-${b.problemId}`} onClick={() => openRoom({ kind: "board", id: b.problemId })}
                      className={`text-left rounded-xl border px-3 py-2 min-w-[220px] flex-1 max-w-[420px] hover:bg-slate-800/40 transition-colors ${sel ? "ring-2 ring-sky-400/60" : ""} ${b.level === "alert" ? "border-red-500/50" : b.level === "warning" ? "border-orange-500/50" : b.level === "watch" ? "border-amber-500/40" : "border-slate-800"}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-bold text-slate-100 truncate">{b.label}</span>
                        <span className={`ml-auto text-[9px] font-bold uppercase tracking-widest border rounded px-1.5 py-0.5 ${LVL_CHIP[b.level]}`}>{b.level}</span>
                        <span className="text-[10px] font-mono text-amber-300">{b.anomaly >= 0 ? "+" : "−"}{Math.abs(b.anomaly).toFixed(2)} {TRAJ[b.trajectory]}</span>
                        <span className={`text-[10px] ${sel ? "text-sky-300" : "text-slate-600"}`}>→</span>
                      </div>
                      <p className="text-[10.5px] text-slate-500 mt-0.5 truncate">{b.learning ? "learning mode — baseline forming" : b.drivers[0] ?? "no active drivers"}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Countries — each a door into the room; the pinned field chips open the field */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 pt-1 pb-1 flex items-center gap-2 flex-wrap">Countries · {detail.countries.length} <span className="normal-case tracking-normal font-normal text-slate-600">— ★ first, then worst · a row opens its room →</span>
              {edit && <button type="button" onClick={() => openTrackPicker({ kind: "country" })} className="normal-case tracking-normal text-[9.5px] font-bold text-emerald-400 hover:underline">＋ Track a country</button>}</p>
            {detail.countries.length === 0 && <p className="text-[11px] text-slate-500">Nothing watched in {AOR_LABELS[r.aor]}. <button type="button" onClick={() => openTrackPicker()} className="text-emerald-400 hover:underline">Track a country or an airfield</button>, or ★ one from the Must-tracks panel.</p>}
            {detail.countries.map((c: CountryRow) => (
              <CountryRowView key={c.country} c={c} sel={sameRoom(room, { kind: "country", id: c.country })} room={room} openRoom={openRoom} star={star} mtBusy={mtBusy} flash={flash} edit={edit} />
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

function CountryRowView({ c, sel, room, openRoom, star, mtBusy, flash, edit }: {
  c: CountryRow; sel: boolean; room: RoomRef | null; openRoom: (ref: RoomRef) => void; star: (k: "aor" | "country" | "icao", v: string) => void; mtBusy: boolean;
  flash: string | null; edit: EditOps | null;
}) {
  const key = `cb-country-${lc(c.country).replace(/\s+/g, "-")}`;
  const pinned = c.fields.find((f) => f.sitrep) ?? c.fields[0];
  return (
    <div id={key} className={`border-t border-slate-800/70 ${flash === key ? "ring-2 ring-sky-400/60 rounded" : ""}`}>
      <button onClick={() => openRoom({ kind: "country", id: c.country })} title="Open the situation room"
        className={`w-full text-left grid grid-cols-[22px_12px_1fr_20px] lg:grid-cols-[22px_12px_1.4fr_1fr_1fr_.8fr_.8fr_20px] gap-2.5 items-center py-2 pr-1 hover:bg-slate-800/30 ${sel ? "bg-sky-500/[0.07] shadow-[inset_3px_0_0_#38bdf8]" : ""}`}>
        <Star on={c.star} label={c.country} onClick={() => star("country", c.country)} disabled={mtBusy} />
        <Dot sev={c.worst} title={c.worst ? `${c.worst}${c.escalated ? " · escalated today" : ""}` : "not in the posture watch — UNKNOWN"} />
        <span className="min-w-0">
          <span className="text-[13px] font-semibold text-slate-100">{c.country}</span>
          {c.escalated && <span className="ml-1.5 text-[8px] font-bold uppercase tracking-wider text-red-300 border border-red-500/40 rounded px-1">↑ escalated</span>}
          {c.chronicity && c.chronicity !== "new" && c.chronicity !== "unknown" && <span className="ml-1.5 text-[8px] font-mono text-slate-500">{c.chronicity}</span>}
          {c.unwatched && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); openTrackPicker({ kind: "country", country: c.country }); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openTrackPicker({ kind: "country", country: c.country }); } }} title="Not in the posture watch — click to track it" className="ml-1.5 text-[8px] font-mono text-amber-300/80 hover:text-emerald-300 underline decoration-dotted">unwatched · track</span>}
          {edit && (!c.unwatched || c.star) && <span className="ml-1.5 align-middle"><Untrack label={`${c.country} (posture watch${c.star ? " + ★" : ""})`} onClick={() => edit.untrackCountry(c.country)} disabled={edit.busy} /></span>}
        </span>
        <span className="hidden lg:block text-[10.5px] text-slate-400 truncate">{c.topDriver || "—"}</span>
        <span className="hidden lg:flex items-center gap-1.5 text-[10px] font-mono text-slate-400 min-w-0 flex-wrap">
          {c.fields.length ? c.fields.slice(0, 3).map((f) => (
            <span key={f.icao} role="button" tabIndex={0} title={`Open ${f.icao} in the room`}
              onClick={(e) => { e.stopPropagation(); openRoom({ kind: "field", id: f.icao }); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openRoom({ kind: "field", id: f.icao }); } }}
              className={`inline-flex items-center gap-1 border rounded px-1.5 py-px bg-slate-950/50 hover:border-sky-400 hover:text-sky-200 ${sameRoom(room, { kind: "field", id: f.icao }) ? "border-sky-400 text-sky-200" : "border-slate-700 text-slate-300"}`}>
              {f.icao}{f.sitrep ? <Leds status={f.sitrep.status} /> : <Dot sev={f.posture?.composite ?? null} />}
            </span>
          )) : <span className="text-slate-600">no field</span>}
          {c.fields.length > 3 && <span className="text-slate-600">+{c.fields.length - 3}</span>}
          {pinned && c.fields.length === 0 && null}
        </span>
        <span className="hidden lg:block text-[10px] font-mono"><span className={c.delta.worse ? "text-red-300" : "text-slate-500"}>{c.delta.worse} worse</span><span className="text-slate-600"> · </span><span className={c.delta.better ? "text-emerald-300" : "text-slate-500"}>{c.delta.better} better</span></span>
        <span className="hidden lg:block text-[10px] font-mono text-slate-500">{c.events ? `${c.events} event${c.events === 1 ? "" : "s"}` : "—"}</span>
        <span className={`text-[10px] justify-self-end ${sel ? "text-sky-300" : "text-slate-600"}`}>→</span>
      </button>
    </div>
  );
}
