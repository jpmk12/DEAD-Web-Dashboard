export type Tab = "glance" | "news" | "calendar" | "email" | "docs" | "osint" | "markets" | "weather";

interface TabBarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  // Per-tab "new since you last looked" counts. A positive value renders an
  // attention badge on the tab; pass 0/undefined to clear it.
  badges?: Partial<Record<Tab, number>>;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "glance",   label: "Glance",       icon: "◆" },
  { id: "news",     label: "News",         icon: "◉" },
  { id: "calendar", label: "Calendar & AI", icon: "◈" },
  { id: "email",    label: "Email",         icon: "◎" },
  { id: "docs",     label: "Docs",          icon: "▤" },
  { id: "osint",    label: "OSINT",         icon: "⊕" },
  { id: "markets",  label: "Markets",       icon: "◈" },
  { id: "weather",  label: "Weather",       icon: "〜" },
];

export default function TabBar({ activeTab, onTabChange, badges }: TabBarProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <nav className="flex gap-1 pt-1" aria-label="Tabs">
        {TABS.map((tab) => {
          const badge = badges?.[tab.id] ?? 0;
          return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all rounded-t-md ${
              activeTab === tab.id
                ? "text-emerald-400 bg-slate-950"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
            }`}
          >
            <span className={`text-sm leading-none transition-colors ${
              activeTab === tab.id ? "text-emerald-400" : "text-slate-600"
            }`}>
              {tab.icon}
            </span>
            {tab.label}
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
