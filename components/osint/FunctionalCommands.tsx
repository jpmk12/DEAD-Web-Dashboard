"use client";

import { LED_CLASS } from "@/lib/levelTokens";
import type { FcRow, FcDoor, FunctionalCommand } from "@/lib/functionalCommands";

// Functional combatant commands — a group beneath the geographic rows on the
// command board (lib/functionalCommands). Each row is its domain's cells;
// the lit cell names its sensor and the board / field / country it read; a
// row opens in place to the per-board / per-strait / per-actor lines; every
// cell with a door is a button to the surface that owns it. The picture
// follows the open row (CrisisMap `domain`).

const LED_WORD: Record<string, string> = { g: "green", a: "amber", r: "red", u: "UNKNOWN" };

export default function FunctionalCommands({ rows, open, onOpen, onDoor }: {
  rows: FcRow[] | null;
  open: FunctionalCommand | null;
  onOpen: (cmd: FunctionalCommand | null) => void;
  onDoor: (door: FcDoor) => void;
}) {
  return (
    <section className="border border-slate-800 rounded-xl bg-slate-900/40 overflow-hidden">
      <div className="px-3.5 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-300">◈ Functional commands</span>
        <span className="text-[10px] text-slate-500">a domain, not a place · every cell is a sensor the app already runs · UNKNOWN is a dead or undeclared sensor, never calm</span>
        <span className="flex-1" />
        {open && <button onClick={() => onOpen(null)} className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200">collapse</button>}
      </div>
      {!rows ? (
        <p className="px-3.5 py-3 text-[11px] text-slate-500 font-mono">assembling the domain picture…</p>
      ) : rows.map((r) => {
        const isOpen = open === r.cmd;
        return (
          <div key={r.cmd} className={`border-t border-slate-800 first:border-t-0 ${isOpen ? "bg-slate-950/40" : ""}`}>
            <button onClick={() => onOpen(isOpen ? null : r.cmd)} aria-expanded={isOpen}
              className="w-full text-left px-3.5 py-2.5 grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-1 items-start hover:bg-slate-800/40">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${LED_CLASS[r.worst]}`} title={LED_WORD[r.worst]} />
                <span className="font-mono font-bold text-slate-100 text-[12px]">{r.label}</span>
                <span className="text-slate-600 text-[10px]">{isOpen ? "▾" : "▸"}</span>
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap gap-1.5 items-center">
                  {r.cells.map((c) => (
                    <span key={c.key} className="inline-flex items-center gap-1 text-[10px] rounded border border-slate-700/70 px-1.5 py-0.5 text-slate-300" title={c.text}>
                      <span className={`w-1.5 h-1.5 rounded-full ${LED_CLASS[c.led]}`} />{c.label}
                    </span>
                  ))}
                </span>
                <span className="block text-[11px] text-slate-400 mt-1 truncate" title={r.why}>{r.why}</span>
              </span>
            </button>
            {isOpen && (
              <div className="px-3.5 pb-3 space-y-2">
                <p className="text-[10px] text-slate-500">{r.domain}</p>
                {r.cells.map((c) => (
                  <div key={c.key} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`w-2 h-2 rounded-full ${LED_CLASS[c.led]}`} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">{c.label}</span>
                      <span className="text-[9px] text-slate-600 font-mono">{LED_WORD[c.led]}{c.live ? "" : " · sensor did not answer"}</span>
                      {c.door && (
                        <button onClick={() => onDoor(c.door!)} className="ml-auto text-[9px] font-bold uppercase tracking-wider text-sky-300 hover:underline">
                          {c.door.kind === "board" ? "board →" : c.door.kind === "field" ? `${c.door.id} →` : c.door.kind === "country" ? `${c.door.id} →` : `${c.door.tab} →`}
                        </button>
                      )}
                    </div>
                    <p className="text-[11.5px] text-slate-200 mt-1">{c.text}</p>
                    {c.detail.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {c.detail.slice(0, 8).map((d, i) => <li key={i} className="text-[10.5px] text-slate-400 font-mono truncate" title={d}>· {d}</li>)}
                        {c.detail.length > 8 && <li className="text-[10px] text-slate-600">+{c.detail.length - 8} more</li>}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {rows && (
        <p className="px-3.5 py-1.5 border-t border-slate-800 text-[9px] text-slate-600 font-mono">
          USSTRATCOM and USSOCOM are not listed — the app has no honest sensor for the first; the second is a customer of mobility, not a domain it watches.
        </p>
      )}
    </section>
  );
}
