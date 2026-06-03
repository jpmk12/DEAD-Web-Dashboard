"use client";

import { useEffect } from "react";
import { Tab, TABS } from "./TabBar";
import { TAB_ICONS, BriefIcon, DigestIcon, CaptureIcon, PreferencesIcon } from "@/lib/icons";

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  badges?: Partial<Record<Tab, number>>;
  onBrief: () => void;
  onDigest: () => void;
  onCapture: () => void;
  onPreferences: () => void;
}

/**
 * Phone navigation. The top tab row and header actions are hidden below `lg`
 * (see TabShell); this slide-in drawer surfaces all 8 tabs plus the primary
 * actions at comfortable tap targets. Desktop never renders this (`lg:hidden`).
 */
export default function MobileNavDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
  badges,
  onBrief,
  onDigest,
  onCapture,
  onPreferences,
}: MobileNavDrawerProps) {
  // Close on Escape and lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const go = (tab: Tab) => {
    onTabChange(tab);
    onClose();
  };
  const act = (fn: () => void) => {
    fn();
    onClose();
  };

  const actionClass =
    "flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider px-3 py-3 rounded-md transition-all touch-manipulation";

  return (
    <div className="lg:hidden fixed inset-0 z-50">
      <button
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
      />
      <nav
        aria-label="Navigation"
        className="absolute top-0 right-0 h-full w-[78%] max-w-xs bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col pt-safe pb-safe"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Menu</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {TABS.map((tab) => {
            const Icon = TAB_ICONS[tab.id];
            const badge = badges?.[tab.id] ?? 0;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => go(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-wider transition-colors touch-manipulation ${
                  active ? "text-emerald-400 bg-emerald-500/10" : "text-slate-300 hover:bg-slate-800/60"
                }`}
              >
                <Icon size={20} strokeWidth={2.25} className={active ? "text-emerald-400" : "text-slate-500"} />
                <span className="flex-1 text-left">{tab.label}</span>
                {badge > 0 && !active && (
                  <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
                {active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
              </button>
            );
          })}
        </div>

        <div className="border-t border-slate-800 p-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => act(onBrief)}
            className={`${actionClass} bg-emerald-500 hover:bg-emerald-400 text-slate-950`}
          >
            <BriefIcon size={16} strokeWidth={2.5} /> Brief
          </button>
          <button
            onClick={() => act(onDigest)}
            className={`${actionClass} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300`}
          >
            <DigestIcon size={16} strokeWidth={2.25} /> Digest
          </button>
          <button
            onClick={() => act(onCapture)}
            className={`${actionClass} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300`}
          >
            <CaptureIcon size={16} strokeWidth={2.5} /> Capture
          </button>
          <button
            onClick={() => act(onPreferences)}
            className={`${actionClass} bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300`}
          >
            <PreferencesIcon size={16} strokeWidth={2.25} /> Settings
          </button>
        </div>
      </nav>
    </div>
  );
}
