"use client";

import { useEffect, useRef } from "react";
import { TAB_ICONS } from "@/lib/icons";

export type Tab = "glance" | "news" | "calendar" | "email" | "docs" | "osint" | "markets" | "weather" | "family";

interface TabBarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  // Per-tab "new since you last looked" counts. A positive value renders an
  // attention badge on the tab; pass 0/undefined to clear it.
  badges?: Partial<Record<Tab, number>>;
}

export const TABS: { id: Tab; label: string }[] = [
  { id: "glance",   label: "Glance" },
  { id: "news",     label: "News" },
  { id: "calendar", label: "Calendar" },
  { id: "email",    label: "Email" },
  { id: "family",   label: "Family" },
  { id: "osint",    label: "OSINT" },
  { id: "weather",  label: "Weather" },
  { id: "docs",     label: "Docs" },
  { id: "markets",  label: "Economy" },
];

export default function TabBar({ activeTab, onTabChange, badges }: TabBarProps) {
  // Nine tabs do not fit a phone. The row scrolls, labels collapse to icons
  // below `sm` (the badge survives), and the active tab is kept in view so a
  // deep-link to Family or Economy never lands on a bar that shows Glance.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTab]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6">
      <nav
        ref={navRef}
        className="flex gap-1 pt-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Tabs"
      >
        {TABS.map((tab) => {
          const badge = badges?.[tab.id] ?? 0;
          const Icon = TAB_ICONS[tab.id];
          return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            data-active={activeTab === tab.id ? "true" : undefined}
            aria-current={activeTab === tab.id ? "page" : undefined}
            aria-label={tab.label}
            title={tab.label}
            className={`relative flex-shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all rounded-t-md ${
              activeTab === tab.id
                ? "text-emerald-400 bg-slate-950"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            <Icon
              size={15}
              strokeWidth={2.25}
              className={`leading-none transition-colors ${
                activeTab === tab.id ? "text-emerald-400" : "text-slate-600"
              }`}
            />
            <span className="hidden sm:inline">{tab.label}</span>
            {badge > 0 && activeTab !== tab.id && (
              <span
                title={`${badge} new high-priority signal${badge === 1 ? "" : "s"} since you last looked`}
                className="ml-0.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none animate-pulse"
              >
                {badge > 9 ? "9+" : badge}
              </span>
            )}
            {/* Active indicator bar */}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-emerald-500 rounded-full" />
            )}
          </button>
          );
        })}
      </nav>
    </div>
  );
}
