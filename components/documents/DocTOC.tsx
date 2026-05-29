"use client";

import { useMemo } from "react";

interface DocTOCProps {
  text: string;
  onJumpToLine: (lineIndex: number) => void;
  onClose: () => void;
}

interface Heading {
  level: number;
  text: string;
  lineIndex: number;
}

// Build an outline from the doc by walking lines and capturing every
// heading (#–######). The line index is what the parent uses to jump the
// textarea cursor to that line. Headings inside fenced code blocks are
// skipped — `# foo` inside ```...``` is code, not a heading.
function buildOutline(text: string): Heading[] {
  const lines = text.split("\n");
  const out: Heading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    out.push({ level: m[1].length, text: m[2], lineIndex: i });
  }
  return out;
}

export default function DocTOC({ text, onJumpToLine, onClose }: DocTOCProps) {
  const headings = useMemo(() => buildOutline(text), [text]);

  return (
    <div className="h-full flex flex-col min-h-0 bg-slate-900/40">
      <div className="border-b border-slate-800 px-3 py-3 flex items-center gap-2 flex-shrink-0">
        <span className="text-emerald-400 text-sm">≣</span>
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold flex-1">Outline</p>
        <button
          onClick={onClose}
          title="Close outline"
          className="text-slate-600 hover:text-slate-300 text-lg leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-slate-800 transition-all"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {headings.length === 0 ? (
          <p className="text-[10px] text-slate-600 italic px-2 py-3 leading-relaxed">
            No headings yet. Add <code className="text-emerald-400">#</code> or click <span className="font-bold">H1</span> in the toolbar to start a section.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {headings.map((h, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => onJumpToLine(h.lineIndex)}
                  title={h.text}
                  style={{ paddingLeft: `${(h.level - 1) * 10 + 6}px` }}
                  className={`w-full text-left text-xs py-1 pr-2 rounded hover:bg-slate-800 transition-colors block truncate ${
                    h.level === 1 ? "text-slate-200 font-semibold" :
                    h.level === 2 ? "text-slate-300" :
                                    "text-slate-500"
                  }`}
                >
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
