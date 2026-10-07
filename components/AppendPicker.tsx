"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon } from "@/lib/icons";
import { relDay } from "@/lib/relTime";
import { toast } from "@/lib/feedback";
import { appendRecents, noteAppended, todayYmd, type AppendPayload } from "@/lib/appendClient";
import { entryMarkdown } from "@/lib/docAppend";
import { docTypeMeta } from "@/lib/docTypes";

// The Append-to picker (REVIEW-2026-10 §9 D4) — the Track picker's shape:
// your logs first (most recently appended first; titles, aliases and tags
// searched), other docs after, "New log" last; the entry is shown as it will
// land and can be edited; one POST; "Open the log" afterwards. Opens on
// `docs:append` (lib/appendClient.openAppend) from any door in the app.

interface LogRow { id: string; title: string; aliases: string[]; tags: string[]; entries: number; latest: { date: string; source: string; excerpt: string } | null; updatedAt: string }
interface TitleRow { id: string; title: string; aliases?: string[]; docType?: string; collection?: string | null }


export default function AppendPicker() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<AppendPayload | null>(null);
  const [q, setQ] = useState("");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [titles, setTitles] = useState<TitleRow[]>([]);
  const [sel, setSel] = useState<{ id: string | null; title: string } | null>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; title: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const p = (e as CustomEvent<AppendPayload>).detail;
      if (!p) return;
      setPayload(p); setText(p.text.trim()); setQ(""); setSel(null); setDone(null); setEditing(false); setOpen(true);
      fetch("/api/documents/logs").then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.logs)) setLogs(d.logs); }).catch(() => {});
      fetch("/api/documents/titles").then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d?.docs)) setTitles(d.docs); }).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 30);
    };
    window.addEventListener("docs:append", onOpen);
    return () => window.removeEventListener("docs:append", onOpen);
  }, []);

  // A preselected target (the one-tap shortcut) lands selected once the logs arrive.
  useEffect(() => {
    if (!open || !payload?.targetId || sel) return;
    const l = logs.find((x) => x.id === payload.targetId) ?? titles.find((x) => x.id === payload.targetId);
    if (l) setSel({ id: l.id, title: l.title });
  }, [open, payload, logs, titles, sel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ql = q.trim().toLowerCase();
  const hit = (title: string, aliases: string[] = [], tags: string[] = []) => !ql || title.toLowerCase().includes(ql) || aliases.some((a) => a.toLowerCase().includes(ql)) || tags.some((t) => t.toLowerCase().includes(ql));
  const recents = useMemo(() => appendRecents(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const logRows = useMemo(() => logs.filter((l) => hit(l.title, l.aliases, l.tags)).sort((a, b) => {
    const ra = recents.indexOf(a.id), rb = recents.indexOf(b.id);
    if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  }), [logs, ql, recents]); // eslint-disable-line react-hooks/exhaustive-deps
  const otherRows = useMemo(() => titles.filter((t) => t.docType !== "log" && hit(t.title, t.aliases)).slice(0, ql ? 8 : 4), [titles, ql]); // eslint-disable-line react-hooks/exhaustive-deps
  const newTitle = q.trim() ? q.trim().slice(0, 80) : "";

  const preview = payload ? entryMarkdown({ date: todayYmd(), text, source: payload.source, sourceTitle: payload.sourceTitle, sourceUrl: payload.sourceUrl, thread: payload.thread }) : "";

  const submit = async () => {
    if (!payload || !sel || !text.trim()) return;
    setBusy(true);
    try {
      let id = sel.id;
      let title = sel.title;
      if (!id) {
        const r = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: sel.title, content: `# ${sel.title}\n`, docType: "log", tags: ["log"] }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.doc?.id) throw new Error(d?.error || `HTTP ${r.status}`);
        id = d.doc.id as string; title = d.doc.title ?? sel.title;
      }
      const r = await fetch(`/api/documents/${id}/append`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayYmd(), text: text.trim(), source: payload.source, sourceTitle: payload.sourceTitle, sourceUrl: payload.sourceUrl, thread: payload.thread, link: payload.link }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      noteAppended(id, title);
      setDone({ id, title });
      toast.ok(`Appended to ${title}`);
      window.dispatchEvent(new CustomEvent("docs:changed"));
    } catch (e) { toast.error("Could not append", e); }
    finally { setBusy(false); }
  };

  const openLog = (id: string) => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("app:navigate", { detail: "docs" }));
    setTimeout(() => window.dispatchEvent(new CustomEvent("docs:open", { detail: id })), 120);
  };

  if (!open || !payload) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/70 backdrop-blur-sm px-3 pt-[7vh]" onMouseDown={() => setOpen(false)}>
      <div onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Append to a running log" className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden max-h-[86vh] flex flex-col">
        <div className="px-4 pt-3 pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-400">Append to</span>
            <span className="text-[10px] text-slate-500">a running log · dated entry · source kept</span>
            <button onClick={() => setOpen(false)} className="ml-auto w-7 h-7 rounded-md inline-flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800" aria-label="Close"><CloseIcon size={14} /></button>
          </div>
          {!done && (
            <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="China · Hormuz · reading log…" autoComplete="off" spellCheck={false}
              onKeyDown={(e) => { if (e.key === "Enter" && !sel) { const first = logRows[0]; if (first) setSel({ id: first.id, title: first.title }); else if (newTitle) setSel({ id: null, title: newTitle }); } }}
              className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/60" />
          )}
        </div>

        <div className="overflow-y-auto min-h-0">
          {done ? (
            <div className="px-4 py-4 space-y-2">
              <p className="text-[12px] text-emerald-300">✓ Appended to <b>{done.title}</b>.</p>
              <div className="flex gap-2">
                <button onClick={() => openLog(done.id)} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400">Open the log</button>
                <button onClick={() => setOpen(false)} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Done</button>
              </div>
            </div>
          ) : (
            <>
              {!sel && (
                <ul className="divide-y divide-slate-800">
                  <li className="px-4 pt-2 pb-1 text-[8.5px] font-bold uppercase tracking-[0.14em] text-slate-600">Your logs — most recently appended first</li>
                  {logRows.length === 0 && <li className="px-4 py-2 text-[11px] text-slate-500">{logs.length ? "No log matches." : "No logs yet — start one below."}</li>}
                  {logRows.map((l) => (
                    <li key={l.id}><button onClick={() => setSel({ id: l.id, title: l.title })} className="w-full text-left px-4 py-2 hover:bg-slate-800/60 flex items-center gap-3">
                      <span>📓</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-slate-100 truncate">{l.title}</span>
                        <span className="block text-[10px] text-slate-500 truncate">{l.entries} entr{l.entries === 1 ? "y" : "ies"}{l.latest ? ` · last ${relDay(l.latest.date)} · ${l.latest.excerpt}` : ""}{l.aliases.length ? ` · aliases: ${l.aliases.join(", ")}` : ""}</span>
                      </span>
                    </button></li>
                  ))}
                  {otherRows.length > 0 && <li className="px-4 pt-2 pb-1 text-[8.5px] font-bold uppercase tracking-[0.14em] text-slate-600">Other docs</li>}
                  {otherRows.map((t) => (
                    <li key={t.id}><button onClick={() => setSel({ id: t.id, title: t.title })} className="w-full text-left px-4 py-2 hover:bg-slate-800/60 flex items-center gap-3">
                      <span className={docTypeMeta(t.docType ?? "note").color}>{docTypeMeta(t.docType ?? "note").icon}</span>
                      <span className="min-w-0 flex-1"><span className="block text-[13px] text-slate-100 truncate">{t.title}</span><span className="block text-[10px] text-slate-500">{docTypeMeta(t.docType ?? "note").label}{t.collection ? ` · ${t.collection}` : ""}</span></span>
                    </button></li>
                  ))}
                  {newTitle && (
                    <li><button onClick={() => setSel({ id: null, title: newTitle })} className="w-full text-left px-4 py-2 hover:bg-slate-800/60 flex items-center gap-3">
                      <span className="text-emerald-400">＋</span>
                      <span className="min-w-0 flex-1"><span className="block text-[13px] text-emerald-300 truncate">New log “{newTitle}”</span><span className="block text-[10px] text-slate-500">starts a 📓 log with this as the first entry</span></span>
                    </button></li>
                  )}
                </ul>
              )}
              {sel && (
                <div className="px-4 py-3 space-y-2">
                  <button onClick={() => setSel(null)} className="text-[10px] text-slate-500 hover:text-slate-300">← logs</button>
                  <p className="text-[13px] text-slate-100">📓 <b>{sel.title}</b>{!sel.id && <span className="ml-2 text-[10px] text-emerald-300">new log</span>}</p>
                  {editing ? (
                    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[12px] text-slate-100 focus:outline-none focus:border-emerald-500/60" />
                  ) : (
                    <pre className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[10.5px] font-mono text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-auto">{preview}</pre>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={submit} disabled={busy || !text.trim()} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40">{busy ? "…" : "Append ↵"}</button>
                    <button onClick={() => setEditing((v) => !v)} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">{editing ? "Preview" : "Edit entry first"}</button>
                    {sel.id && <button onClick={() => openLog(sel.id!)} className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Open the log</button>}
                    <span className="text-[9px] text-slate-600 ml-auto">Esc closes · ⌘K “Append to a log”</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
