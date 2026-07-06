"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { X_BOOKMARKLET } from "@/lib/xBookmarklet";

// X capture import — the Social pane's upload surface for dead-x-capture
// files (produced by the bookmarklet on x.com in the user's own browser).
// Nothing here talks to X: file in → POST /api/osint/x-import → posts ride
// the OSINT feed as kind "social".

interface XStatus {
  count: number;
  newest: string | null;
  sources: { label: string; count: number }[];
}

interface Props {
  onImported: () => void;   // parent reloads the feed so new posts appear immediately
}

export default function XImportCard({ onImported }: Props) {
  const [status, setStatus] = useState<XStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    fetch("/api/osint/x-import")
      .then((r) => r.json())
      .then((d) => { if (typeof d?.count === "number") setStatus(d); })
      .catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  const importText = async (text: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/osint/x-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        setMsg({ kind: "err", text: d.error || "Import failed." });
        return;
      }
      const bits = [`${d.imported} new`, d.updated > 0 ? `${d.updated} updated` : "", d.skipped > 0 ? `${d.skipped} skipped` : ""].filter(Boolean);
      setMsg({ kind: "ok", text: `Imported from “${d.source?.label ?? "capture"}” — ${bits.join(", ")}. ${d.total} posts loaded.` });
      refresh();
      onImported();
    } catch {
      setMsg({ kind: "err", text: "Import failed — network error." });
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    f.text().then(importText).catch(() => setMsg({ kind: "err", text: "Could not read the file." }));
  };

  const clearAll = async () => {
    if (!window.confirm("Remove all imported X posts from the feed?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/osint/x-import", { method: "DELETE" });
      if (res.ok) {
        setMsg({ kind: "ok", text: "Imported X posts cleared." });
        refresh();
        onImported();
      } else {
        setMsg({ kind: "err", text: "Clear failed." });
      }
    } finally {
      setBusy(false);
    }
  };

  const copyBookmarklet = () => {
    navigator.clipboard?.writeText(X_BOOKMARKLET)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      className={`bg-slate-900/60 border rounded-xl p-3 space-y-2 transition-colors ${drag ? "border-sky-400/70 bg-sky-500/5" : "border-slate-800"}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sky-300 font-bold text-xs">𝕏 Capture import</span>
        <span className="text-[10px] text-slate-500 font-mono">
          {status === null
            ? "…"
            : status.count === 0
            ? "no posts loaded"
            : `${status.count} posts loaded${status.newest ? ` · newest ${formatDistanceToNow(new Date(status.newest), { addSuffix: true })}` : ""}`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-sky-500/40 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 transition-all disabled:opacity-50"
        >
          {busy ? "Working…" : "⇪ Import file"}
        </button>
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-all ${showHelp ? "border-sky-500/40 text-sky-300 bg-sky-500/10" : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"}`}
        >
          Bookmarklet {showHelp ? "▴" : "▾"}
        </button>
        {status !== null && status.count > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={clearAll}
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-slate-700 text-slate-500 hover:border-red-500/40 hover:text-red-400 transition-all disabled:opacity-50"
          >
            ✕ Clear
          </button>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {msg && (
        <p className={`text-[11px] leading-snug ${msg.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>
      )}

      {status !== null && status.count > 0 && status.sources.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-mono">
          {status.sources.map((s) => (
            <span key={s.label} className="px-1.5 py-0.5 rounded border border-slate-700/80 text-slate-400">
              {s.label} <span className="text-slate-600">×{s.count}</span>
            </span>
          ))}
        </div>
      )}

      {showHelp && (
        <div className="border-t border-slate-800 pt-2 space-y-2 text-[11px] text-slate-400 leading-relaxed">
          <p>
            X has no usable feed for this host, so the capture runs in <span className="text-slate-200">your own logged-in browser</span>:
            a bookmarklet copies the posts currently on screen into a JSON file, and you upload that file here.
            It automates nothing, sends nothing to X, and never touches your credentials.
          </p>
          <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
            <li><span className="text-slate-200">Copy the bookmarklet</span> below, then create a new browser bookmark and paste it as the bookmark&apos;s URL (name it e.g. &quot;DEAD X capture&quot;).</li>
            <li>On <span className="font-mono text-slate-300">x.com</span>, open the list / bookmarks / search / profile you want and scroll so the posts you care about have rendered.</li>
            <li>Tap the bookmark — it downloads <span className="font-mono text-slate-300">x-capture-….json</span> (up to 200 posts).</li>
            <li>Drop the file on this card (or use <span className="text-sky-300">Import file</span>). Re-importing the same posts is safe — they dedupe by post id.</li>
          </ol>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyBookmarklet}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all"
            >
              {copied ? "✓ Copied" : "⧉ Copy bookmarklet"}
            </button>
            <span className="text-[10px] text-slate-600 font-mono">imports auto-expire after 14 days · newest 1000 kept</span>
          </div>
          <textarea
            readOnly
            value={X_BOOKMARKLET}
            rows={3}
            onFocus={(e) => e.target.select()}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-md px-2 py-1.5 text-[10px] font-mono text-slate-500 resize-none focus:outline-none focus:border-sky-500/40"
          />
          <p className="text-slate-600">
            If a capture comes back with missing authors/text, X likely changed its page structure — save the x.com page
            (Ctrl/Cmd-S, HTML only) and upload it in chat so the selectors can be fixed against the real markup.
          </p>
        </div>
      )}
    </div>
  );
}
