"use client";

import { useEffect, useState } from "react";
import { renderClocks, DEFAULT_CLOCKS, isValidTz, type ClockDef } from "@/lib/worldClocks";

// The clock row under the Glance greeting: home station, the capitals that
// set the tempo, and Zulu. Client-only (the same hydration rule as the
// greeting — the server's zone is not the reader's), ticking once a minute
// on the minute. The list is editable inline and remembered per browser.

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
    // Tick on the minute boundary so every clock flips together.
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {rows.map((c) => (
        <div
          key={`${c.label}|${c.tz}`}
          title={`${c.tz} · ${c.utcOffset}${c.dayOffset ? ` · ${c.dayOffset > 0 ? "tomorrow" : "yesterday"} relative to you` : ""}`}
          className={`flex items-baseline gap-1.5 rounded-md border px-2.5 py-1 ${c.isNight ? "border-slate-800 bg-slate-900/60" : "border-slate-700 bg-slate-800/40"}`}
        >
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{c.label}</span>
          <span className={`font-mono text-[15px] font-bold tabular-nums leading-none ${c.valid ? "text-slate-100" : "text-red-300"}`}>{c.time}</span>
          <span className="text-[9px] text-slate-500 font-mono">
            {c.weekday}{c.dayOffset > 0 ? " +1" : c.dayOffset < 0 ? " −1" : ""}
            <span className="ml-1" aria-hidden>{c.isNight ? "☾" : "☀"}</span>
          </span>
          {editing && (
            <button type="button" onClick={() => persist(clocks.filter((x) => !(x.label === c.label && x.tz === c.tz)))}
              className="ml-0.5 text-slate-600 hover:text-red-300 text-xs leading-none" aria-label={`Remove ${c.label} clock`}>×</button>
          )}
        </div>
      ))}
      {editing ? (
        <form
          className="flex items-center gap-1"
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
          <datalist id="glance-clock-zones">
            {["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu", "Europe/London", "Europe/Berlin", "Europe/Moscow", "Asia/Tehran", "Asia/Riyadh", "Asia/Qatar", "Asia/Dubai", "Asia/Kabul", "Asia/Karachi", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney"].map((z) => <option key={z} value={z} />)}
          </datalist>
          <button type="submit" className="text-[11px] px-2 py-1 rounded bg-emerald-600/80 text-white">Add</button>
          <button type="button" onClick={() => { setEditing(false); setDraft({ label: "", tz: "" }); }} className="text-[11px] px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">Done</button>
          <button type="button" onClick={() => persist(DEFAULT_CLOCKS)} className="text-[10px] text-slate-500 hover:text-slate-300">reset</button>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-[10px] text-slate-600 hover:text-slate-400" aria-label="Edit clocks">edit</button>
      )}
    </div>
  );
}
