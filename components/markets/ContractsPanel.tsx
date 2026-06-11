"use client";

import { useEffect, useState } from "react";

interface ContractAward {
  id: string;
  title: string;
  vendor: string | null;
  amountUsd: number | null;
  branch: string | null;
  link: string;
  pubDate: string;
}

const BRANCH_COLOUR: Record<string, string> = {
  "ARMY":                    "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  "NAVY":                    "bg-blue-500/15 text-blue-300 border-blue-500/40",
  "AIR FORCE":               "bg-sky-500/15 text-sky-300 border-sky-500/40",
  "MARINE CORPS":            "bg-red-500/15 text-red-300 border-red-500/40",
  "SPACE FORCE":             "bg-violet-500/15 text-violet-300 border-violet-500/40",
  "DEFENSE LOGISTICS AGENCY":"bg-amber-500/15 text-amber-300 border-amber-500/40",
  "MISSILE DEFENSE AGENCY":  "bg-orange-500/15 text-orange-300 border-orange-500/40",
};

function formatUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatDate(s: string): string {
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}

export default function ContractsPanel() {
  const [items, setItems] = useState<ContractAward[]>([]);
  const [loading, setLoading] = useState(true);
  const [srcError, setSrcError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/markets/contracts")
      .then((r) => r.json())
      .then((d) => { setItems(d.contracts ?? []); setSrcError(typeof d.error === "string" ? d.error : null); })
      .catch(() => setSrcError("Network error"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <span className="text-amber-400 text-xs">⚐</span>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
          DOD Contract Awards
        </h3>
        <span className="ml-auto text-[9px] text-slate-700 font-mono">defense.gov</span>
      </div>

      {loading && (
        <div className="px-4 py-3 space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-8 bg-slate-800/60 rounded animate-pulse" />)}
        </div>
      )}

      {!loading && items.length === 0 && (
        srcError ? (
          <p className="px-4 py-6 text-[10px] font-mono text-center text-amber-500">
            ⚠ defense.gov feed unreachable — this is a source outage, not "no awards today."
          </p>
        ) : (
          <p className="px-4 py-6 text-[10px] text-slate-600 font-mono text-center">
            No recent contract awards available.
          </p>
        )
      )}

      {!loading && items.length > 0 && (
        <ul className="divide-y divide-slate-800/80 max-h-[380px] overflow-y-auto">
          {items.map((c) => {
            const open = expanded.has(c.id);
            return (
              <li key={c.id} className="px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
                <button
                  onClick={() => setExpanded((p) => {
                    const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n;
                  })}
                  className="w-full text-left"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {c.branch && (
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${BRANCH_COLOUR[c.branch] ?? "bg-slate-700/40 text-slate-300 border-slate-600"}`}>
                        {c.branch}
                      </span>
                    )}
                    {c.amountUsd && (
                      <span className="text-[10px] font-mono font-bold text-emerald-400">
                        {formatUsd(c.amountUsd)}
                      </span>
                    )}
                    <span className="ml-auto text-[9px] text-slate-600 font-mono flex-shrink-0">
                      {formatDate(c.pubDate)}
                    </span>
                  </div>
                  <p className={`text-xs text-slate-300 leading-snug ${open ? "" : "line-clamp-2"}`}>
                    {c.vendor && (
                      <strong className="text-slate-100">{c.vendor}</strong>
                    )}
                    {c.vendor ? " · " : ""}
                    {c.title}
                  </p>
                </button>
                {open && c.link && (
                  <a
                    href={c.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono mt-1 inline-block"
                  >
                    Full release →
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
