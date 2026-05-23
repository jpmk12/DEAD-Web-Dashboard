"use client";

import { useState } from "react";

const ACCOUNTS = [
  {
    handle: "sentdefender",
    label: "SentDefender",
    description: "Real-time conflict tracking, geopolitical flashpoints, and open-source intelligence.",
  },
  {
    handle: "DefenseOne",
    label: "Defense One",
    description: "Defense policy, technology, and national security coverage.",
  },
  {
    handle: "BreakingDefense",
    label: "Breaking Defense",
    description: "Breaking news on defense acquisition, strategy, and technology.",
  },
  {
    handle: "AirForceMag",
    label: "Air Force Magazine",
    description: "Official magazine of the Air & Space Forces Association.",
  },
  {
    handle: "politico",
    label: "Politico",
    description: "Politics, policy, and government from Washington DC.",
  },
  {
    handle: "MilTimes",
    label: "Military Times",
    description: "News and analysis for the US military community.",
  },
  {
    handle: "realcleardefense",
    label: "RealClear Defense",
    description: "Aggregated defense and national security commentary.",
  },
];

export default function TwitterSection() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
          X / Twitter Accounts
        </span>
        <div className="flex-1 h-px bg-slate-800" />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-xs text-slate-600 hover:text-slate-400 font-mono transition-colors"
        >
          {collapsed ? "▼ show" : "▲ hide"}
        </button>
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ACCOUNTS.map(({ handle, label, description }) => (
            <a
              key={handle}
              href={`https://x.com/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-3 bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-xl px-4 py-3 transition-all card-hover"
            >
              {/* X logo */}
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 group-hover:bg-slate-700 flex items-center justify-center transition-colors mt-0.5">
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-slate-300" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.91-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors truncate">
                    {label}
                  </span>
                  <span className="text-[10px] font-mono text-slate-600 group-hover:text-slate-400 transition-colors flex-shrink-0">
                    @{handle} ↗
                  </span>
                </div>
                <p className="text-xs text-slate-500 group-hover:text-slate-400 transition-colors leading-snug mt-0.5">
                  {description}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
