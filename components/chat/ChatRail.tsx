"use client";

import { useState } from "react";
import { BriefIcon } from "@/lib/icons";

interface ChatRailProps {
  label: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function ChatRail({
  label,
  icon = <BriefIcon size={14} strokeWidth={2.25} className="inline-block align-[-2px]" />,
  defaultOpen = false,
  children,
}: ChatRailProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <>
      {/* ── Mobile: compact trigger when closed, full panel when open ──── */}
      <div className="lg:hidden">
        {open ? (
          <div className="mt-4">
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-slate-600 hover:text-slate-400 font-mono transition-colors"
              >
                Hide analyst ▲
              </button>
            </div>
            {children}
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="w-full mt-4 text-xs text-slate-600 hover:text-slate-300 border border-slate-800 hover:border-slate-700 rounded-lg py-2 font-mono uppercase tracking-wider transition-all"
          >
            {icon} Show {label}
          </button>
        )}
      </div>

      {/* ── Desktop: slim rail ↔ full panel ────────────────────────────── */}
      {open ? (
        <div className="hidden lg:flex flex-col lg:w-80 xl:w-96 flex-shrink-0">
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-400 font-mono transition-colors"
            >
              <span>◁</span> collapse
            </button>
          </div>
          {children}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title={`Open ${label}`}
          className="hidden lg:flex flex-col items-center justify-start w-10 flex-shrink-0 pt-4 pb-6 gap-3 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-emerald-500/30 hover:bg-slate-900 cursor-pointer transition-all group"
        >
          <span className="text-emerald-400 text-sm group-hover:scale-110 transition-transform">
            {icon}
          </span>
          <span
            className="text-[10px] font-bold uppercase tracking-widest text-slate-600 group-hover:text-emerald-500/70 transition-colors"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {label}
          </span>
        </button>
      )}
    </>
  );
}
