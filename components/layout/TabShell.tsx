"use client";

import { useState } from "react";
import TabBar, { Tab } from "./TabBar";
import NewsShell from "@/components/news/NewsShell";

export default function TabShell() {
  const [activeTab, setActiveTab] = useState<Tab>("news");

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <header className="bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 sticky top-0 z-30">
        <div className="h-0.5 bg-gradient-to-r from-emerald-500 via-green-400 to-transparent" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <span className="text-emerald-400 text-xs">◆</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-bold tracking-widest uppercase text-slate-100 leading-none">
                DEAD&apos;s Dashboard
              </h1>
            </div>
          </div>
        </div>

        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <div className={activeTab !== "news" ? "hidden" : ""}>
          <NewsShell />
        </div>
      </main>
    </div>
  );
}
