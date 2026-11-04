"use client";

import { AppTheme } from "@/lib/types";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

// ─── Theme selector ───────────────────────────────────────────────────────────

const THEMES: {
  id: AppTheme;
  name: string;
  desc: string;
  bg: string;
  surface: string;
  accent: string;
  accentLabel: string;
}[] = [
  {
    id: "nightwatch",
    name: "Nightwatch",
    desc: "Deep slate / emerald",
    bg: "#020617",
    surface: "#0f172a",
    accent: "#10b981",
    accentLabel: "emerald",
  },
  {
    id: "amber",
    name: "Amber",
    desc: "Tactical terminal / phosphor",
    bg: "#0c0800",
    surface: "#160f00",
    accent: "#f59e0b",
    accentLabel: "amber",
  },
  {
    id: "arctic",
    name: "Arctic",
    desc: "Midnight navy / ice-blue",
    bg: "#03091a",
    surface: "#07112a",
    accent: "#0ea5e9",
    accentLabel: "sky",
  },
  {
    id: "mission",
    name: "Mission Brief",
    desc: "Parchment / aviation blue",
    bg: "#f5f4f0",
    surface: "#ffffff",
    accent: "#185FA5",
    accentLabel: "blue",
  },
];

export default function ThemeSelector({
  value,
  onChange,
}: {
  value: AppTheme;
  onChange: (t: AppTheme) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {THEMES.map((theme) => {
        const active = value === theme.id;
        return (
          <button
            key={theme.id}
            onClick={() => onChange(theme.id)}
            className={`flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all ${
              active ? "border-emerald-500/60 shadow-[0_0_14px_-2px_var(--glow-accent)]" : "border-slate-700/60 hover:border-slate-600/80"
            }`}
            title={theme.name}
          >
            {/* Mini preview */}
            <div
              className="h-14 w-full relative"
              style={{ backgroundColor: theme.bg }}
            >
              {/* Simulated card */}
              <div
                className="absolute inset-x-2 top-2 bottom-2 rounded-md flex flex-col justify-between p-1.5"
                style={{ backgroundColor: theme.surface, border: `1px solid ${theme.accent}22` }}
              >
                <div className="flex gap-1 items-center">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.accent }} />
                  <div className="h-1 rounded-full flex-1" style={{ backgroundColor: `${theme.accent}40` }} />
                </div>
                <div className="space-y-0.5">
                  <div className="h-0.5 rounded-full w-3/4" style={{ backgroundColor: `${theme.accent}60` }} />
                  <div className="h-0.5 rounded-full w-1/2" style={{ backgroundColor: `${theme.accent}30` }} />
                </div>
              </div>
              {active && (
                <div
                  className="absolute top-1 right-1 w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold"
                  style={{ backgroundColor: theme.accent, color: theme.bg }}
                >
                  ✓
                </div>
              )}
            </div>
            {/* Label */}
            <div className="px-2 py-1.5 bg-slate-800/40">
              <p className={`text-[10px] font-bold font-mono ${active ? "text-slate-100" : "text-slate-400"}`}>
                {theme.name}
              </p>
              <p className="text-[9px] text-slate-600 leading-tight">{theme.desc}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
