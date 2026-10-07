"use client";

import { useEffect, useMemo, useState } from "react";
import { CloseIcon } from "@/lib/icons";
import CountryRoom, { type CountrySection } from "@/components/ground/CountryRoom";
import SitrepPanel, { type SitrepSection } from "@/components/osint/SitrepPanel";
import WarningBoard from "@/components/osint/WarningBoard";
import { Leds, Dot, Star, RoleSwitch, Untrack, LVL_CHIP, TRAJ, type EditOps } from "@/components/osint/boardBits";
import { openTrackPicker } from "@/lib/trackClient";
import type { ForceAssessment } from "@/lib/forceProtection";
import type { CommandBoard, CountryRow, FieldRow, CbBoard } from "@/lib/commandBoard";
import { roomSiblings, roomAor, findCountry, findField, sameRoom, fieldWorst, type RoomRef } from "@/lib/room";
import { AOR_LABELS } from "@/lib/aor";
import { SEVERITY_TEXT, type Severity } from "@/lib/severity";

// THE ROOM — one detail surface for the command board (REVIEW-2026-10 §11,
// C + C′). A country's situation room, an airfield's SITREP or an I&W board
// slides in from the right; the board page behind never reflows. Tabs replace
// the five-screen scroll, ‹ › walk the command (countries / fields / boards in
// board order), ⇥ pin docks it as a right column on wide screens, Esc closes.
// The room holds no data of its own: the subject comes from the board the
// parent already has, and the pages are the existing components
// (CountryRoom, SitrepPanel single, WarningBoard only) rendered by section.

const COUNTRY_TABS: { key: CountrySection | "airfields"; label: string }[] = [
  { key: "overview", label: "Overview" }, { key: "incidents", label: "Incidents" }, { key: "news", label: "News" },
  { key: "civil", label: "Civil" }, { key: "health", label: "Health" }, { key: "spectrum", label: "Spectrum" }, { key: "airfields", label: "Airfields" },
];
const FIELD_TABS: { key: SitrepSection; label: string }[] = [
  { key: "sitrep", label: "SITREP" }, { key: "weather", label: "Weather" }, { key: "ops", label: "Ops · NOTAMs" }, { key: "threats", label: "Threats" },
  { key: "infra", label: "Infrastructure" }, { key: "spectrum", label: "Spectrum" }, { key: "history", label: "History" },
];
const short = (aor: string) => (AOR_LABELS[aor as keyof typeof AOR_LABELS] ?? aor).replace(/^US/, "");
const SEV_WORD: Record<string, string> = { red: "RED", amber: "AMBER", green: "GREEN", unknown: "UNKNOWN" };

export interface RoomDrawerProps {
  room: RoomRef;
  board: CommandBoard;
  forces: ForceAssessment[];
  active: boolean;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  onOpen: (ref: RoomRef) => void;
  star: (k: "aor" | "country" | "icao", v: string) => void;
  mtBusy: boolean;
  edit: EditOps | null;
}

export default function RoomDrawer({ room, board, forces, active, pinned, onPin, onClose, onOpen, star, mtBusy, edit }: RoomDrawerProps) {
  const [countryTab, setCountryTab] = useState<CountrySection | "airfields">("overview");
  const [fieldTab, setFieldTab] = useState<SitrepSection>("sitrep");
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t); }, []);

  const siblings = useMemo(() => roomSiblings(board, room), [board, room]);
  const ix = siblings.findIndex((s) => sameRoom(s, room));
  const prev = ix > 0 ? siblings[ix - 1] : null;
  const next = ix >= 0 && ix < siblings.length - 1 ? siblings[ix + 1] : null;
  const aor = roomAor(board, room);
  const country = room.kind === "country" ? findCountry(board, room.id) : null;
  const field = room.kind === "field" ? findField(board, room.id) : null;
  const iwBoard: CbBoard | null = room.kind === "board" ? Object.values(board.details).flatMap((d) => d.boards).find((b) => b.problemId === room.id) ?? null : null;

  // Keyboard: Esc closes, ← → walk the command.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && prev) onOpen(prev);
      else if (e.key === "ArrowRight" && next) onOpen(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, prev, next, onClose, onOpen]);

  if (!active) return null;

  // The force assessments the country room reads (not re-fetched).
  const forceById = new Map(forces.map((f) => [f.id, f]));
  const sel = country?.posture ? forceById.get(country.posture.id) ?? null : null;
  const baseRow = country?.fields.find((f) => f.posture)?.posture;
  const base = baseRow ? forceById.get(baseRow.id) ?? null : null;

  const crumb = (
    <span className="min-w-0 truncate text-[10.5px] font-mono text-slate-500">
      {aor ? short(aor) : "—"}
      {room.kind === "field" && field?.country && <> › <button onClick={() => onOpen({ kind: "country", id: field.country })} className="text-sky-300 hover:underline">{field.country}</button></>}
      {" › "}<b className="text-slate-100">{room.kind === "board" ? (iwBoard?.label ?? room.id) : room.id}</b>
    </span>
  );

  const shell = `${pinned ? "xl:static xl:sticky xl:top-0 xl:h-[100dvh] xl:w-auto xl:max-w-none xl:shadow-none xl:border-l-slate-800" : ""} fixed inset-y-0 right-0 z-50 w-full md:w-[62%] max-w-[960px] bg-slate-950 border-l border-sky-500/40 shadow-[-24px_0_60px_rgba(0,0,0,.55)] flex flex-col transition-[transform,opacity] duration-150 ${shown ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0"}`;

  return (
    <>
      <div onClick={onClose} aria-hidden className={`fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[1px] ${pinned ? "xl:hidden" : ""}`} />
      <aside role="dialog" aria-modal="true" aria-label="the room" className={shell}>
        {/* header */}
        <div className="flex items-center gap-2.5 px-3.5 py-2 border-b border-slate-800 bg-sky-500/[0.04] flex-wrap flex-shrink-0">
          <span className="text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-sky-300">◉ Room</span>
          {crumb}
          <span className="flex-1" />
          <span className="flex items-center gap-1">
            <button onClick={() => prev && onOpen(prev)} disabled={!prev} title={prev ? `← ${prev.id}` : "first in the command"} className="text-[10px] font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-100 disabled:opacity-35 max-w-[150px] truncate">‹ {prev ? prev.id : ""}</button>
            <button onClick={() => next && onOpen(next)} disabled={!next} title={next ? `→ ${next.id}` : "last in the command"} className="text-[10px] font-mono px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-100 disabled:opacity-35 max-w-[150px] truncate">{next ? next.id : ""} ›</button>
          </span>
          <button onClick={onPin} title={pinned ? "Unpin — the room slides over the board again" : "Pin as a side column on a wide screen"} className={`hidden xl:inline-block text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${pinned ? "border-sky-500/60 text-sky-300 bg-sky-500/10" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>⇥ pin</button>
          <button onClick={onClose} title="close (Esc)" aria-label="Close" className="w-7 h-7 rounded-md inline-flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800"><CloseIcon size={14} /></button>
        </div>

        {/* title line */}
        <div className="px-3.5 pt-2.5 pb-1 flex items-center gap-2.5 flex-wrap flex-shrink-0">
          {room.kind === "country" && (
            <>
              <span className="text-lg">🌐</span>
              <h3 className="text-[19px] font-extrabold text-slate-50 leading-tight">{room.id}</h3>
              {aor && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 border border-slate-700 rounded px-1.5 py-px">{AOR_LABELS[aor]}</span>}
              {country ? (
                <>
                  <span className={`text-[11px] font-extrabold tracking-wide ${SEVERITY_TEXT[(country.worst ?? "unknown") as Severity]}`}>● {SEV_WORD[country.worst ?? "unknown"]}</span>
                  {country.escalated && <span className="text-[8px] font-bold uppercase tracking-wider text-red-300 border border-red-500/40 rounded px-1">▲ escalated</span>}
                  {country.chronicity && country.chronicity !== "unknown" && <span className="text-[10.5px] font-mono text-slate-500">· {country.chronicity}</span>}
                  {country.unwatched && <span className="text-[10px] text-amber-300/90">not in the posture watch — UNKNOWN, not clear</span>}
                </>
              ) : <span className="text-[10px] text-slate-500">not on the board</span>}
              <span className="ml-auto flex items-center gap-1.5 flex-wrap">
                {country?.fields[0] && <span className="text-[10px] font-mono text-slate-500">pinned <button onClick={() => onOpen({ kind: "field", id: country.fields[0].icao })} className="text-sky-300 hover:underline">{country.fields[0].icao}</button></span>}
                <Star on={!!country?.star} label={room.id} onClick={() => star("country", room.id)} disabled={mtBusy} />
                {country?.unwatched && <button onClick={() => openTrackPicker({ kind: "country", country: room.id })} className="text-[9px] font-bold uppercase tracking-wider text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded px-1.5 py-px">Track</button>}
                {edit && country && (!country.unwatched || country.star) && <Untrack label={`${room.id} (posture watch${country.star ? " + ★" : ""})`} onClick={() => edit.untrackCountry(room.id)} disabled={edit.busy} />}
              </span>
            </>
          )}
          {room.kind === "field" && (
            <>
              <h3 className="text-[19px] font-extrabold font-mono text-slate-50 leading-tight">{room.id}</h3>
              {field && <span className="text-[13px] text-slate-300 truncate">{field.label}</span>}
              {field && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 border border-slate-700 rounded px-1.5 py-px">{aor ? AOR_LABELS[aor] : "—"}{field.country ? ` · ${field.country}` : ""}</span>}
              {field?.sitrep ? <Leds status={field.sitrep.status} size="w-2 h-2" /> : <Dot sev={field?.posture?.composite ?? null} />}
              {field?.sitrep && field.sitrep.worse.length > 0 && <span className="text-[9px] font-bold text-amber-400" title={`worse than yesterday: ${field.sitrep.worse.join(", ")}`}>▲ {field.sitrep.worse.join(" · ")}</span>}
              {!field && <span className="text-[10px] text-slate-500">not on the board</span>}
              <span className="ml-auto flex items-center gap-1.5 flex-wrap">
                {edit && field && <RoleSwitch icao={field.icao} role={field.role} onSet={(r) => edit.setRole(field.icao, r)} disabled={edit.busy} />}
                {!edit && field?.role && <span className="text-[8px] font-bold uppercase tracking-widest border border-slate-700 rounded px-1 py-px text-slate-400">{field.role}</span>}
                <Star on={!!field?.star} label={room.id} onClick={() => star("icao", room.id)} disabled={mtBusy} />
                {field && !field.posture && <button onClick={() => openTrackPicker({ kind: "airfield", icao: field.icao })} className="text-[9px] font-bold uppercase tracking-wider text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded px-1.5 py-px">Track</button>}
                {edit && field && <Untrack label={field.icao} onClick={() => edit.untrackField(field.icao, field.role)} disabled={edit.busy} />}
              </span>
            </>
          )}
          {room.kind === "board" && (
            <>
              <h3 className="text-[19px] font-extrabold text-slate-50 leading-tight">{iwBoard?.label ?? room.id}</h3>
              {iwBoard && <span className={`text-[9px] font-bold uppercase tracking-widest border rounded px-1.5 py-0.5 ${LVL_CHIP[iwBoard.level]}`}>{iwBoard.level}</span>}
              {iwBoard && <span className="text-[10.5px] font-mono text-amber-300">{iwBoard.anomaly >= 0 ? "+" : "−"}{Math.abs(iwBoard.anomaly).toFixed(2)} {TRAJ[iwBoard.trajectory]}{iwBoard.learning ? " · learning" : ""}</span>}
            </>
          )}
        </div>

        {/* tabs */}
        {room.kind === "country" && (
          <div className="flex gap-0.5 px-2.5 border-b border-slate-800 flex-wrap flex-shrink-0">
            {COUNTRY_TABS.map((t) => {
              const n = t.key === "incidents" ? country?.events : t.key === "airfields" ? country?.fields.length : undefined;
              return <button key={t.key} onClick={() => setCountryTab(t.key)} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1.5 border-b-2 ${countryTab === t.key ? "text-sky-300 border-sky-400" : "text-slate-500 border-transparent hover:text-slate-300"}`}>{t.label}{n != null && n > 0 ? <i className="not-italic font-mono font-normal ml-1 text-slate-600">{n}</i> : null}</button>;
            })}
          </div>
        )}
        {room.kind === "field" && field?.hasSitrep && (
          <div className="flex gap-0.5 px-2.5 border-b border-slate-800 flex-wrap flex-shrink-0">
            {FIELD_TABS.map((t) => <button key={t.key} onClick={() => setFieldTab(t.key)} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1.5 border-b-2 ${fieldTab === t.key ? "text-sky-300 border-sky-400" : "text-slate-500 border-transparent hover:text-slate-300"}`}>{t.label}</button>)}
          </div>
        )}

        {/* body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3">
          {room.kind === "country" && (
            <>
              {countryTab === "airfields" ? (
                <div className="space-y-2">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 flex items-center gap-2">Airfields in {room.id} · {country?.fields.length ?? 0}
                    {edit && <button type="button" onClick={() => openTrackPicker({ kind: "airfield", query: room.id })} className="normal-case tracking-normal text-[9.5px] font-bold text-emerald-400 hover:underline">＋ Track in {room.id}</button>}</p>
                  {(country?.fields.length ?? 0) === 0 && <p className="text-[11px] text-slate-500">No airfield watched in {room.id}. <button type="button" onClick={() => openTrackPicker({ kind: "airfield", query: room.id })} className="text-emerald-400 hover:underline">Track one</button> — search by ICAO, name or country.</p>}
                  <div className="flex flex-wrap gap-2">{country?.fields.map((f) => <FieldTile key={f.icao} f={f} onOpen={onOpen} />)}</div>
                </div>
              ) : null}
              {/* Keep the dossier mounted across tabs (one fetch, one AI read); the Airfields tab hides it. */}
              <div className={countryTab === "airfields" ? "hidden" : ""}>
                <CountryRoom country={room.id} sel={sel} base={base} active={active} section={countryTab === "airfields" ? "overview" : countryTab} hideHeader />
                {countryTab === "overview" && (country?.fields.length ?? 0) > 0 && (
                  <div className="mt-3">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">✈ Airfields · {country!.fields.length} <button onClick={() => setCountryTab("airfields")} className="normal-case tracking-normal font-normal text-sky-300 hover:underline ml-1">all →</button></p>
                    <div className="flex flex-wrap gap-2">{country!.fields.slice(0, 3).map((f) => <FieldTile key={f.icao} f={f} onOpen={onOpen} />)}</div>
                  </div>
                )}
              </div>
            </>
          )}
          {room.kind === "field" && (
            field?.hasSitrep ? (
              <SitrepPanel active={active} focusIcao={room.id} single section={fieldTab} />
            ) : (
              <div className="space-y-3">
                <div className="border border-slate-800 rounded-xl px-3.5 py-3 bg-slate-900/40 text-[12px] text-slate-300">
                  <p className="font-bold text-slate-100 mb-1">{room.id} has no full SITREP slot.</p>
                  <p className="text-slate-400">Posture: {field?.posture ? <><span className={SEVERITY_TEXT[field.posture.composite as Severity]}>{SEV_WORD[field.posture.composite]}</span> — {field.posture.topDriver}</> : "not in the posture watch — UNKNOWN, not clear"}.</p>
                  <p className="text-slate-500 mt-1.5">★ it to give it one of the 6 full-SITREP slots (hub first): weather, NOTAMs, threats, infrastructure, spectrum, mission impact.</p>
                  <button onClick={() => star("icao", room.id)} disabled={mtBusy} className="mt-2 text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-amber-500/50 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">★ Get a SITREP</button>
                </div>
              </div>
            )
          )}
          {room.kind === "board" && (
            iwBoard ? <WarningBoard active={active} only={[room.id]} /> : <p className="text-[11px] text-slate-500">That board is not on the command picture this pass.</p>
          )}
        </div>
      </aside>
    </>
  );
}

function FieldTile({ f, onOpen }: { f: FieldRow; onOpen: (ref: RoomRef) => void }) {
  const worst = fieldWorst(f);
  return (
    <button onClick={() => onOpen({ kind: "field", id: f.icao })} className={`text-left min-w-[180px] flex-1 max-w-[300px] rounded-xl border px-3 py-2 hover:bg-slate-800/40 ${worst === "r" ? "border-red-500/50" : worst === "a" ? "border-amber-500/40" : "border-slate-800"}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-extrabold font-mono text-slate-100">{f.icao}</span>
        {f.role ? <span className="text-[8px] font-bold uppercase tracking-widest border border-slate-700 rounded px-1 py-px text-slate-400">{f.role}</span> : f.star ? <span className="text-amber-400 text-[11px]">★</span> : null}
        <span className="ml-auto">{f.sitrep ? <Leds status={f.sitrep.status} size="w-2 h-2" /> : <Dot sev={f.posture?.composite ?? null} />}</span>
        {f.sitrep && f.sitrep.worse.length > 0 && <span className="text-[9px] font-bold text-amber-400" title={`worse than yesterday: ${f.sitrep.worse.join(", ")}`}>▲</span>}
      </div>
      <p className={`text-[10.5px] mt-1 truncate ${worst === "r" ? "text-red-300" : worst === "a" ? "text-amber-300" : "text-slate-400"}`}>{f.sitrep ? f.sitrep.driver : f.posture ? f.posture.topDriver : "not watched — posture UNKNOWN"}</p>
      <p className="text-[9px] font-mono text-slate-600 mt-0.5 truncate">{f.hasSitrep ? "SITREP in this room →" : "★ to get a SITREP"}</p>
    </button>
  );
}

export type { CountryRow };
