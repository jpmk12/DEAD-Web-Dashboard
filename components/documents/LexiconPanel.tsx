"use client";

import { useEffect, useMemo, useState } from "react";

interface LexEntry {
  id: string;
  title: string;
  definition: string;
  props: Record<string, string>;
  linkCount: number;
  owner: { id: string; title: string } | null;
}

interface LexiconPanelProps {
  // Open a term (or owner) doc in the Docs pane.
  onOpenDoc: (id: string) => void;
}

// Glossary surface over every ≔ term doc: alphabetical cards with
// first-paragraph definitions, owner, link count, an A–Z jump bar, and
// filter chips from the terms' `course` property.
export default function LexiconPanel({ onOpenDoc }: LexiconPanelProps) {
  const [entries, setEntries] = useState<LexEntry[] | null>(null);
  const [courseFilter, setCourseFilter] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/documents/lexicon")
      .then((r) => r.json())
      .then((d) => setEntries(Array.isArray(d.entries) ? d.entries : []))
      .catch(() => setEntries([]));
  }, []);

  const courses = useMemo(
    () => [...new Set((entries ?? []).map((e) => e.props.course).filter(Boolean))].sort(),
    [entries]
  );
  const filtered = useMemo(
    () => (entries ?? []).filter((e) => !courseFilter || e.props.course === courseFilter),
    [entries, courseFilter]
  );
  const letters = useMemo(() => {
    const present = new Set(filtered.map((e) => (e.title[0] ?? "#").toUpperCase()));
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => ({ l, hot: present.has(l) }));
  }, [filtered]);

  const jump = (l: string) => {
    document.getElementById(`lex-${l}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Group by first letter for anchors.
  const groups = useMemo(() => {
    const m = new Map<string, LexEntry[]>();
    for (const e of filtered) {
      const l = (e.title[0] ?? "#").toUpperCase();
      const arr = m.get(l);
      if (arr) arr.push(e); else m.set(l, [e]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 flex-shrink-0 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">≔ Lexicon</span>
        <span className="text-[10px] text-slate-600 font-mono">
          {entries === null ? "loading…" : `${filtered.length} term${filtered.length === 1 ? "" : "s"}`}
        </span>
        {courses.length > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setCourseFilter(null)}
              className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border transition-all ${
                courseFilter === null ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-500 hover:text-slate-300"
              }`}
            >
              All
            </button>
            {courses.map((c) => (
              <button
                key={c}
                onClick={() => setCourseFilter((f) => (f === c ? null : c))}
                className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border transition-all ${
                  courseFilter === c ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-500 hover:text-slate-300"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* A–Z jump bar */}
      <div className="flex flex-wrap gap-0.5 px-4 py-1.5 border-b border-slate-800/60 flex-shrink-0">
        {letters.map(({ l, hot }) => (
          <button
            key={l}
            onClick={() => hot && jump(l)}
            disabled={!hot}
            className={`w-5 h-5 text-[10px] font-bold rounded flex items-center justify-center ${
              hot ? "text-emerald-300 hover:bg-emerald-500/10 cursor-pointer" : "text-slate-700 cursor-default"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {entries !== null && entries.length === 0 && (
          <div className="text-center py-12">
            <p className="text-2xl mb-2">≔</p>
            <p className="text-sm font-bold text-slate-300 mb-1">No terms yet</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              Set a doc&apos;s type to <span className="text-emerald-400">Term</span> and it appears here as a glossary
              entry — first paragraph becomes the definition. Set <span className="font-mono text-slate-400">owner</span> in
              its properties to attribute it, or let the most-linked theorist claim it.
            </p>
          </div>
        )}
        {groups.map(([letter, list]) => (
          <div key={letter} id={`lex-${letter}`}>
            <p className="text-[10px] font-bold text-slate-600 mt-2 mb-1.5">{letter}</p>
            <div className="gap-3 mb-2" style={{ columns: "2 320px" }}>
              {list.map((e) => (
                <div key={e.id} className="break-inside-avoid bg-slate-900/60 border border-slate-800 rounded-xl px-3.5 py-3 mb-3">
                  <button
                    onClick={() => onOpenDoc(e.id)}
                    className="text-[13px] font-bold text-emerald-300 hover:text-emerald-200 text-left leading-snug"
                  >
                    {e.title}
                  </button>
                  {e.props.course && (
                    <span className="ml-2 text-[8.5px] font-bold text-slate-500 border border-slate-700 rounded px-1.5 py-0.5 align-middle">
                      {e.props.course}
                    </span>
                  )}
                  {e.definition ? (
                    <p className="text-[11.5px] text-slate-400 leading-relaxed mt-1.5">{e.definition}</p>
                  ) : (
                    <p className="text-[11px] text-slate-600 italic mt-1.5">No definition yet — first paragraph of the doc becomes one.</p>
                  )}
                  <p className="text-[10px] text-slate-600 mt-2">
                    {e.owner && (
                      <>
                        owner:{" "}
                        {e.owner.id ? (
                          <button onClick={() => onOpenDoc(e.owner!.id)} className="text-sky-400 hover:text-sky-300 border-b border-dashed border-sky-500/40">
                            {e.owner.title}
                          </button>
                        ) : (
                          <span className="text-sky-400/80">{e.owner.title}</span>
                        )}
                        {" · "}
                      </>
                    )}
                    {e.linkCount} link{e.linkCount === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
