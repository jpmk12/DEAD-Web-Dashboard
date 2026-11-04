"use client";

import { useEffect, useState } from "react";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

// ─── Long-term memory panel ──────────────────────────────────────────────────

export default function MemoryPanel() {
  const [content, setContent] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    fetch("/api/user-memory")
      .then((r) => r.json())
      .then(({ memory }: { memory: { content: string; lastUpdated: string } }) => {
        setContent(memory?.content ?? "");
        setLastUpdated(memory?.lastUpdated ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loaded]);

  const save = async () => {
    setBusy(true);
    try {
      await fetch("/api/user-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setLastUpdated(new Date().toISOString());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm("Clear all stored memory? This can't be undone.")) return;
    setBusy(true);
    try {
      await fetch("/api/user-memory", { method: "DELETE" });
      setContent("");
      setLastUpdated(null);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const fmtUpdated = lastUpdated && new Date(lastUpdated).getTime() > 0
    ? new Date(lastUpdated).toLocaleString()
    : "never";

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Long-term Memory
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Auto-maintained from chat. The assistant remembers projects, upcoming events,
        people you mention, and ad-hoc notes — injected into every AI response.
        Last updated: <span className="font-mono">{fmtUpdated}</span>
      </p>

      {!editing ? (
        <>
          <div className="bg-slate-800/70 border border-slate-700/80 rounded-lg p-3 text-[11px] text-slate-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
            {content.trim() || (
              <span className="text-slate-600 italic">Memory is empty — chat a bit and it'll fill in.</span>
            )}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              className="flex-1 text-[11px] text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Edit
            </button>
            <button
              onClick={clear}
              disabled={busy || !content}
              className="flex-1 text-[11px] text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Clear all
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="The assistant's memory of you — usually managed automatically. Edit if needed."
            className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg p-3 text-[11px] text-slate-200 placeholder-slate-600 resize-none outline-none focus:border-slate-500 transition-colors font-mono leading-relaxed"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-2.5 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="flex-1 text-[11px] text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
