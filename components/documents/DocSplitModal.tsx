"use client";

import { useMemo, useState } from "react";
import { splitAtHeadings, buildMasterAfterSplit } from "@/lib/composeDocs";

interface DocSplitModalProps {
  docId: string;
  title: string;
  content: string;
  tags: string[];
  onClose: () => void;
  // Fired after the split completes: (newMasterContent) so the editor can
  // refresh in place; the parent also bumps the sidebar list.
  onDone: (newMasterContent: string) => void;
}

type Level = 1 | 2 | 3;

// Break one long doc into per-section docs at a chosen heading level. The
// master keeps its preamble and becomes an index of [[wiki-links]] (sections
// left unchecked stay inline). The pre-split master is force-snapshotted to
// version history first, so the operation is fully undoable via 📜 History.
export default function DocSplitModal({ docId, title, content, tags, onClose, onDone }: DocSplitModalProps) {
  const [level, setLevel] = useState<Level>(2);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [tagInput, setTagInput] = useState(tags.filter((t) => t !== "template").join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Section counts per level so the selector shows what each cut yields.
  const counts = useMemo(() => {
    const c: Record<Level, number> = { 1: 0, 2: 0, 3: 0 };
    ([1, 2, 3] as Level[]).forEach((lv) => { c[lv] = splitAtHeadings(content, lv).sections.length; });
    return c;
  }, [content]);

  const { preamble, sections } = useMemo(() => splitAtHeadings(content, level), [content, level]);

  const toggle = (i: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const extractedIdx = useMemo(() => {
    const s = new Set<number>();
    sections.forEach((_, i) => { if (!excluded.has(i)) s.add(i); });
    return s;
  }, [sections, excluded]);

  const runSplit = async () => {
    if (busy || extractedIdx.size === 0) return;
    setBusy(true);
    setError(null);
    const newTags = tagInput.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20);
    try {
      // 1. Snapshot the pre-split master (bypasses the autosave throttle).
      await fetch(`/api/documents/${docId}/versions`, { method: "POST" });

      // 2. Create the section docs in order. Sequential keeps creation order
      //    aligned with document order (nice for "recent" sorts).
      for (let i = 0; i < sections.length; i++) {
        if (!extractedIdx.has(i)) continue;
        const s = sections[i];
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: s.title,
            content: `← part of [[${title}]]\n\n${s.body}`.trimEnd() + "\n",
            tags: newTags,
          }),
        });
        if (!res.ok) throw new Error(`Failed creating "${s.title}"`);
      }

      // 3. Rewrite the master as preamble + link index (+ kept sections).
      const newMaster = buildMasterAfterSplit(preamble, sections, extractedIdx, level);
      const patch = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newMaster }),
      });
      if (!patch.ok) throw new Error("Failed updating the master doc");

      onDone(newMaster);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Split failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-slate-700/80 rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-800 flex-shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">✂ Split at headings</h2>
          <span className="text-[10px] text-slate-600 font-mono truncate">{title}</span>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Level selector */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              Split level
            </label>
            <div className="flex gap-2">
              {([1, 2, 3] as Level[]).map((lv) => (
                <button
                  key={lv}
                  onClick={() => { setLevel(lv); setExcluded(new Set()); }}
                  disabled={counts[lv] === 0}
                  className={`text-[11px] font-semibold px-3 py-1.5 rounded-md border transition-all disabled:opacity-30 ${
                    level === lv
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                      : "bg-slate-800/60 text-slate-400 border-slate-700 hover:text-slate-200"
                  }`}
                >
                  {"#".repeat(lv)} H{lv} — {counts[lv]} section{counts[lv] === 1 ? "" : "s"}
                </button>
              ))}
            </div>
          </div>

          {/* Section plan */}
          {sections.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              No H{level} headings found. Pick another level, or add <code className="text-emerald-400">{"#".repeat(level)} Heading</code> lines to mark sections.
            </p>
          ) : (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                New docs — uncheck to keep a section inline
              </label>
              <ul className="space-y-1.5">
                {sections.map((s, i) => {
                  const extract = !excluded.has(i);
                  return (
                    <li key={i}>
                      <button
                        onClick={() => toggle(i)}
                        className={`w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
                          extract
                            ? "bg-emerald-500/5 border-emerald-500/25"
                            : "bg-slate-900/50 border-slate-800 opacity-60"
                        }`}
                      >
                        <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] flex-shrink-0 border ${
                          extract ? "bg-emerald-500 border-emerald-500 text-slate-950 font-bold" : "border-slate-600"
                        }`}>
                          {extract ? "✓" : ""}
                        </span>
                        <span className="flex-1 text-xs text-slate-200 font-medium truncate">{s.title}</span>
                        <span className="text-[9px] text-slate-600 font-mono flex-shrink-0">~{Math.round(s.body.length / 5)}w</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Tags for new docs */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              Tags for new docs
            </label>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="comma, separated"
              className="w-full bg-slate-800/70 border border-slate-700/80 rounded-md px-3 py-2 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
            />
          </div>

          <p className="text-[10px] text-slate-600 leading-relaxed bg-slate-900/50 border border-slate-800 rounded-md px-3 py-2">
            The master keeps its intro and becomes an index of <span className="text-emerald-400">[[wiki-links]]</span>;
            each new doc opens with <span className="text-emerald-400">← part of [[{title}]]</span>.
            The pre-split master is snapshotted to <span className="text-slate-400">📜 History</span> first, so this is undoable.
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-slate-800 flex-shrink-0">
          <button
            onClick={runSplit}
            disabled={busy || extractedIdx.size === 0}
            className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3.5 py-2 rounded-md disabled:opacity-40 transition-all"
          >
            {busy ? "Splitting…" : `Split into ${extractedIdx.size} doc${extractedIdx.size === 1 ? "" : "s"}`}
          </button>
          <button onClick={onClose} disabled={busy} className="ml-auto text-[11px] text-slate-500 hover:text-slate-300 px-2 py-2 disabled:opacity-40">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
