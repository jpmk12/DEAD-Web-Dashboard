"use client";

import { useEffect, useState } from "react";
import { renderClocks, DEFAULT_CLOCKS, isValidTz, type ClockDef, type DayPhase } from "@/lib/worldClocks";
import { DAY_PHASE_ICONS } from "@/lib/icons";

// The clock row under the Glance greeting — "big digits" design: one tile
// per zone, UTC offset above, the time as the largest numerals on the page,
// the place name and weekday beneath. Each tile carries the part of the
// local day as a small lucide glyph in its corner AND as its sky: day tiles
// sit on neutral slate, night tiles recede into indigo-black, dawn and dusk
// warm the top edge — so "is it their day or their night" reads from across
// the room before the digits do. Zulu is the reference and glows emerald;
// the tile for the device's own zone gets a sky border so "here" is never
// in doubt.
//
// Client-only (the same hydration rule as the greeting — the server's zone
// is not the reader's), ticking once a minute on the minute so every tile
// flips together. The list is editable inline and remembered per browser.

const KEY = "glance.clocks";

function loadClocks(): ClockDef[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CLOCKS;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_CLOCKS;
    const ok = arr.filter((c): c is ClockDef => c && typeof c.label === "string" && typeof c.tz === "string" && isValidTz(c.tz)).slice(0, 8);
    return ok.length ? ok : DEFAULT_CLOCKS;
  } catch { return DEFAULT_CLOCKS; }
}

const ZONES = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu", "Europe/London", "Europe/Berlin", "Europe/Moscow", "Asia/Tehran", "Asia/Amman", "Asia/Riyadh", "Asia/Qatar", "Asia/Dubai", "Asia/Kabul", "Asia/Karachi", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney"];

// The sky per phase: background wash, the glyph's colour, and the digits.
const PHASE: Record<DayPhase, { sky: string; glyph: string; digits: string; label: string }> = {
  day:   { sky: "border-slate-700 bg-gradient-to-b from-slate-800 to-slate-950",                      glyph: "text-amber-300",  digits: "text-slate-50 drop-shadow-[0_0_14px_rgba(148,163,184,0.15)]", label: "daytime" },
  night: { sky: "border-slate-800 bg-gradient-to-b from-[#0d1330] to-slate-950",                      glyph: "text-indigo-300", digits: "text-slate-300", label: "night" },
  dawn:  { sky: "border-orange-500/25 bg-gradient-to-b from-orange-500/[0.14] via-slate-900 to-slate-950", glyph: "text-orange-300", digits: "text-slate-100", label: "dawn" },
  dusk:  { sky: "border-violet-500/25 bg-gradient-to-b from-orange-400/[0.12] via-[#171433] to-slate-950", glyph: "text-orange-400", digits: "text-slate-200", label: "dusk" },
};

export default function WorldClocks() {
  const [now, setNow] = useState<number | null>(null);
  const [clocks, setClocks] = useState<ClockDef[]>(DEFAULT_CLOCKS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ label: string; tz: string }>({ label: "", tz: "" });
  const [deviceTz, setDeviceTz] = useState("UTC");

  useEffect(() => {
    setClocks(loadClocks());
    setDeviceTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setNow(Date.now());
    let interval: ReturnType<typeof setInterval> | null = null;
    const align = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { clearTimeout(align); if (interval) clearInterval(interval); };
  }, []);

  const persist = (next: ClockDef[]) => {
    setClocks(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  if (now === null) return null;
  const rows = renderClocks(now, clocks, deviceTz);
  // Phones get three tiles a row (six clocks = two tidy rows); tablets four;
  // desktops all six. A forced six-up grid squeezed the digits past their
  // tiles on a phone.
  const cols = rows.length <= 3
    ? "grid-cols-3"
    : rows.length <= 4
      ? "grid-cols-2 sm:grid-cols-4"
      : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6";

  return (
    <section aria-label="World clocks">
      <div className={`grid gap-2 sm:gap-2.5 ${cols}`}>
        {rows.map((c) => {
          const zulu = c.tz === "UTC";
          const here = c.tz === deviceTz;
          const phase = PHASE[c.phase];
          const Glyph = DAY_PHASE_ICONS[c.phase];
          // Zulu and "here" keep their identity borders; the sky still shows
          // the phase underneath.
          const border = zulu ? "border-emerald-500/50" : here ? "border-sky-500/45" : "";
          const sky = zulu
            ? "bg-gradient-to-b from-emerald-500/[0.08] to-slate-950"
            : phase.sky.replace(/^border-\S+\s/, "");
          const digits = !c.valid ? "text-red-300" : zulu ? "text-emerald-300 drop-shadow-[0_0_14px_rgba(52,211,153,0.35)]" : phase.digits;
          return (
            <div
              key={`${c.label}|${c.tz}`}
              title={`${c.tz} · ${phase.label}${c.dayOffset ? ` · ${c.dayOffset > 0 ? "tomorrow" : "yesterday"} relative to you` : ""}${here ? " · your zone" : ""}`}
              className={`relative min-w-0 overflow-hidden rounded-xl border px-1.5 sm:px-2 pt-2.5 pb-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${border || phase.sky.match(/^border-\S+/)?.[0] || "border-slate-700"} ${sky}`}
            >
              {/* The part of the day, in the corner — glyph AND sky so it reads
                  without the legend. Night glyphs are dimmer than day ones on
                  purpose: a moon should recede. */}
              {c.valid && (
                <Glyph
                  size={13}
                  strokeWidth={2.25}
                  aria-label={phase.label}
                  className={`absolute top-1.5 right-1.5 ${phase.glyph} ${c.phase === "night" ? "opacity-70" : "opacity-90"}`}
                />
              )}
              <span className="block text-[8.5px] font-mono tracking-[0.12em] text-slate-600 leading-none">{c.utcOffset || "—"}</span>
              <span className={`block font-mono text-[24px] sm:text-[26px] lg:text-[30px] font-black leading-none tabular-nums tracking-tight mt-1.5 ${digits}`}>
                {c.time}{zulu && <span className="text-[12px] font-bold text-slate-500 ml-0.5">Z</span>}
              </span>
              <span className="block mt-2 text-[9.5px] sm:text-[10.5px] font-extrabold uppercase tracking-[0.1em] sm:tracking-[0.18em] text-slate-300 truncate">{c.label}</span>
              <span className="block text-[9.5px] text-slate-500 mt-0.5">
                {c.weekday}{c.dayOffset > 0 ? " +1" : c.dayOffset < 0 ? " −1" : ""}
                <span className={`ml-1 ${phase.glyph} opacity-80`}>{phase.label}</span>
              </span>
              {editing && (
                <button type="button" onClick={() => persist(clocks.filter((x) => !(x.label === c.label && x.tz === c.tz)))}
                  className="absolute top-1 left-1.5 text-slate-600 hover:text-red-300 text-sm leading-none" aria-label={`Remove ${c.label} clock`}>×</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex justify-end">
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const tz = draft.tz.trim(), label = draft.label.trim() || tz;
              if (!isValidTz(tz)) return;
              persist([...clocks, { label, tz }].slice(0, 8));
              setDraft({ label: "", tz: "" });
            }}
          >
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Label" maxLength={20}
              className="w-[90px] bg-slate-800/70 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-100" />
            <input value={draft.tz} onChange={(e) => setDraft({ ...draft, tz: e.target.value })} placeholder="Asia/Riyadh" maxLength={40} list="glance-clock-zones"
              className={`w-[130px] bg-slate-800/70 border rounded px-1.5 py-1 text-[11px] text-slate-100 font-mono ${draft.tz && !isValidTz(draft.tz) ? "border-red-500/60" : "border-slate-700"}`} />
            <datalist id="glance-clock-zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
            <button type="submit" className="text-[11px] px-2 py-1 rounded bg-emerald-600/80 text-white">Add</button>
            <button type="button" onClick={() => persist(DEFAULT_CLOCKS)} className="text-[10px] text-slate-500 hover:text-slate-300 px-1">reset</button>
            <button type="button" onClick={() => { setEditing(false); setDraft({ label: "", tz: "" }); }} className="text-[11px] px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">Done</button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="text-[9.5px] text-slate-700 hover:text-slate-400" aria-label="Edit clocks">edit clocks</button>
        )}
      </div>
    </section>
  );
}
