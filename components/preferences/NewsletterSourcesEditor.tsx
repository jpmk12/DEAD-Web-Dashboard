"use client";

import { useState } from "react";
import { NewsletterSourceRule } from "@/lib/types";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

export default function NewsletterSourcesEditor({ value, onChange }: { value: NewsletterSourceRule[]; onChange: (v: NewsletterSourceRule[]) => void; }) {
  const [label, setLabel] = useState("");
  const [matchType, setMatchType] = useState<NewsletterSourceRule["matchType"]>("sender");
  const [val, setVal] = useState("");

  const add = () => {
    const lab = label.trim().slice(0, 40);
    const v = val.trim().slice(0, 200);
    if (!lab || !v || value.length >= 12) return;
    const id = `nl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    onChange([...value, { id, label: lab, matchType, value: v, enabled: true }]);
    setLabel(""); setVal("");
  };
  const toggleEnabled = (id: string) =>
    onChange(value.map((r) => (r.id === id ? { ...r, enabled: r.enabled === false } : r)));
  const remove = (id: string) => onChange(value.filter((r) => r.id !== id));

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Newsletter Sources
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Which emails feed the Newsletters panel. Match by{" "}
        <span className="text-emerald-400">sender</span> (email or domain, e.g.&nbsp;
        <code className="text-emerald-400">politico.com</code>) or by{" "}
        <span className="text-emerald-400">subject</span> phrase — useful when one sender blasts several
        newsletters. Up to 12.
      </p>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5 max-h-56 overflow-y-auto">
          {value.map((r) => {
            const off = r.enabled === false;
            return (
              <li key={r.id} className={`flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5 ${off ? "opacity-50" : ""}`}>
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 flex-shrink-0 w-14 text-center">
                  {r.matchType}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-200 truncate">{r.label}</div>
                  <div className="text-[10px] font-mono text-slate-500 truncate">{r.value}</div>
                </div>
                <button
                  onClick={() => toggleEnabled(r.id)}
                  title={off ? "Disabled — click to enable" : "Enabled — click to disable"}
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors flex-shrink-0 ${off ? "text-slate-500 hover:text-emerald-400" : "text-emerald-400 hover:text-emerald-300"}`}
                >
                  {off ? "Off" : "On"}
                </button>
                <button onClick={() => remove(r.id)} className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1 flex-shrink-0">×</button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-1.5">
        <select
          value={matchType}
          onChange={(e) => setMatchType(e.target.value as NewsletterSourceRule["matchType"])}
          className="bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-slate-500"
        >
          <option value="sender">Sender</option>
          <option value="subject">Subject</option>
        </select>
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
          className="w-24 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <input
          value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={matchType === "sender" ? "politico.com" : "Morning Defense"}
          className="flex-1 min-w-0 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <button
          onClick={add}
          disabled={!label.trim() || !val.trim() || value.length >= 12}
          className="text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}
