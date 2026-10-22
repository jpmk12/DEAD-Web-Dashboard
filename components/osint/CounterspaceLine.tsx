"use client";

import { useState } from "react";
import { LED_HEX } from "@/lib/levelTokens";
import { AssetsOfInterestInline } from "@/components/preferences/SpectrumInline";
import { useSpectrumSummary, openBoard } from "@/components/osint/PostureCard";

// The compact counterspace line for the SITREP Spectrum card: the worst
// inspector-fleet read across the Russia / China boards, one row per actor
// with a door to the board, and the assets-of-interest declaration folded
// under "⚙ assets" (edited where it is read, the edge-vendors rule).

export function CounterspaceLine() {
  const sum = useSpectrumSummary();
  const [assetsOpen, setAssetsOpen] = useState(false);
  if (!sum) return <p className="text-[10.5px] text-slate-500 pl-4">loading…</p>;
  const postures = sum.postures ?? [];
  if (!postures.length) {
    return <p className="text-[10.5px] text-slate-500 pl-4">No board watches a space power (Russia, China) — declare one as an AOI in the Mission Profile to read its inspector fleet.</p>;
  }
  return (
    <div className="pl-4 space-y-1">
      {postures.map((p) => {
        const r = p.counterspace;
        const led = r && r.live ? r.led : "u";
        const cat = p.catalogue;
        return (
          <p key={p.actor} className="text-[10.5px] text-slate-300 flex items-start gap-1.5">
            <span className="text-[8px] mt-1" style={{ color: LED_HEX[led] }}>●</span>
            <span className="flex-1">
              <b>{p.country}:</b>{" "}
              {r ? (r.live ? `${r.state} — ${r.why.replace(/^.*? — /, "")}` : "UNKNOWN — catalogue and reporting both dead") : "no counterspace read this pass"}
              {cat && !cat.configured && <span className="text-slate-500"> · Space-Track not configured (reporting only)</span>}
              {cat && cat.configured && !cat.live && <span className="text-amber-200/80"> · catalogue unreachable: {cat.reason}</span>}
              {cat?.closestKm != null && <span className="text-slate-500"> · closest {cat.closestKm < 1 ? `${Math.round(cat.closestKm * 1000)} m` : `${cat.closestKm.toFixed(cat.closestKm < 10 ? 1 : 0)} km`} to a declared asset</span>}
            </span>
            {p.board && <button type="button" onClick={() => openBoard(p.board!.problemId)} className="text-[9px] font-bold uppercase tracking-wider text-slate-600 hover:text-sky-300 flex-shrink-0" title={`Open the I&W board — ${p.board.label}`}>board →</button>}
          </p>
        );
      })}
      <button type="button" onClick={() => setAssetsOpen((v) => !v)} aria-expanded={assetsOpen} className="text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300">⚙ assets {assetsOpen ? "▴" : "▾"}</button>
      {assetsOpen && <AssetsOfInterestInline />}
    </div>
  );
}
