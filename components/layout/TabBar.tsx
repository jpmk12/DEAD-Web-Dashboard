export type Tab = "news";

interface TabBarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "news", label: "News", icon: "◉" },
];

export default function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <nav className="flex gap-1 pt-1" aria-label="Tabs">
        {TABS.map((tab) => (
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
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-emerald-500 rounded-full" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
