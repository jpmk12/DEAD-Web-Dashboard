"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/feedback";
import { invalidateEffectiveZone, type EffectiveZone } from "@/lib/zoneClient";
import { zoneLabel } from "@/lib/effectiveZone";

// The zone label on Glance's Today panel and the Calendar Today strip IS
// the control (REVIEW-2026-10 §12): tap it to pin the zone it shows, pin
// this device's zone, or unpin and follow the device (and an active TDY).
// Writes the two personal scalars through /api/user-prefs/patch — never
// the full prefs POST, which would rebuild the row — then invalidates the
// effective zone so every consumer re-asks.

export default function ZonePin({ zone, className = "", title, children }: {
  zone: EffectiveZone;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const write = async (body: { timezoneMode: "auto" | "pinned"; timezone?: string }, said: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/user-prefs/patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error("Could not change the zone", d?.error || `HTTP ${r.status}`); return; }
      invalidateEffectiveZone();
      window.dispatchEvent(new CustomEvent("dashboard-cache-cleared"));
      toast.ok(said);
      setOpen(false);
    } catch (e) { toast.error("Could not change the zone", e); }
    finally { setBusy(false); }
  };

  const device = zone.device ?? null;
  const deviceDiffers = !!device && device !== zone.zone;
  const sourceLine = zone.source === "pinned" ? `Pinned to ${zone.zone}.`
    : zone.source === "trip" ? `Set by the active TDY${zone.trip ? ` (${zone.trip.label})` : ""}.`
    : "Following this device.";

  return (
    <span ref={wrap} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
        title={title ?? `${sourceLine} Tap to pin or unpin.`}
        className={`${className} hover:text-slate-200 underline decoration-dotted underline-offset-2 decoration-slate-600`}>
        {children ?? zone.label}
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full mt-1 z-30 min-w-[240px] rounded-lg border border-slate-700 bg-slate-900 shadow-xl p-2 text-left">
          <p className="text-[10px] text-slate-500 px-1 pb-1.5">{sourceLine}</p>
          {zone.source !== "pinned" && (
            <button role="menuitem" disabled={busy} onClick={() => write({ timezoneMode: "pinned", timezone: zone.zone }, `Pinned ${zone.zone}`)}
              className="w-full text-left text-[11px] text-slate-200 hover:bg-slate-800 rounded px-2 py-1.5">📌 Pin {zone.zone} <span className="text-slate-500">({zoneLabel(zone.zone)})</span></button>
          )}
          {deviceDiffers && zone.source !== "device" && (
            <button role="menuitem" disabled={busy} onClick={() => write({ timezoneMode: "pinned", timezone: device! }, `Pinned ${device}`)}
              className="w-full text-left text-[11px] text-slate-200 hover:bg-slate-800 rounded px-2 py-1.5">📌 Pin this device&apos;s zone <span className="text-slate-500">({device})</span></button>
          )}
          {zone.source === "pinned" && (
            <button role="menuitem" disabled={busy} onClick={() => write({ timezoneMode: "auto" }, "Following the device zone")}
              className="w-full text-left text-[11px] text-slate-200 hover:bg-slate-800 rounded px-2 py-1.5">↶ Unpin — follow the device (an active TDY still wins)</button>
          )}
          <p className="text-[9.5px] text-slate-600 px-1 pt-1.5">Pinned › active TDY › this device. Also in Preferences → You.</p>
        </div>
      )}
    </span>
  );
}
