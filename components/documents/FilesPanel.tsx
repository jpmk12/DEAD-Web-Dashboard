"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { toast } from "@/lib/feedback";

interface FileSummary {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  tags: string[];
  docId: string | null;
  uploadedAt: string;
}

interface QuotaUsage { usedBytes: number; limitBytes: number; count: number }

interface FilesPanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  refreshKey: number;
  onRefresh: () => void;
  attachToDocId?: string | null;
}

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fileGlyph(mime: string): string {
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("video/")) return "🎬";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime === "application/pdf") return "📕";
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml")) return "📄";
  if (mime.includes("zip") || mime.includes("archive") || mime.includes("compressed")) return "📦";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "📊";
  if (mime.includes("word") || mime.includes("document")) return "📃";
  return "📁";
}

function timeAgo(s: string): string {
  try { return formatDistanceToNow(parseISO(s), { addSuffix: true }); } catch { return ""; }
}

// Upload queue entry — one per dropped/picked file, with its own state so one
// failure can be retried without re-dropping the rest (REVIEW-2026-10 D3).
interface QueueItem { key: string; file: File; status: "waiting" | "uploading" | "done" | "error"; error?: string }

// Folder drops: walk the DataTransferItem entries (Chromium/WebKit) so a
// dropped folder yields its files. Falls back to the flat file list.
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items.map((it) => (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null);
  if (!entries.some((e) => e)) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File | null>((res) => (entry as FileSystemFileEntry).file(res, () => res(null)));
      if (f) out.push(f);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const all: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        all.push(...batch);
      }
      for (const e of all) await walk(e);
    }
  };
  for (const e of entries) if (e) await walk(e);
  return out.length ? out : Array.from(dt.files);
}

export default function FilesPanel({ selectedId, onSelect, refreshKey, onRefresh, attachToDocId }: FilesPanelProps) {
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [quota, setQuota] = useState<QuotaUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<null | "tag" | "untag" | "attach">(null);
  const [bulkInput, setBulkInput] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/files")
      .then((r) => r.json())
      .then((d) => { setFiles(Array.isArray(d?.files) ? d.files : []); setQuota(d?.quota ?? null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  // Drop the selection of ids that no longer exist.
  useEffect(() => { setChecked((c) => new Set([...c].filter((id) => files.some((f) => f.id === id)))); }, [files]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.filename.toLowerCase().includes(q) || f.tags.some((t) => t.toLowerCase().includes(q)) || (f.description ?? "").toLowerCase().includes(q));
  }, [files, search]);

  // ── Upload queue: serial so the quota is rechecked between files. ──
  const enqueue = (list: File[]) => {
    if (!list.length) return;
    setQueue((q) => [...q, ...list.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, status: "waiting" as const }))]);
  };
  useEffect(() => {
    if (busyRef.current) return;
    const next = queue.find((q) => q.status === "waiting");
    if (!next) return;
    busyRef.current = true;
    const mark = (patch: Partial<QueueItem>) => setQueue((q) => q.map((x) => (x.key === next.key ? { ...x, ...patch } : x)));
    (async () => {
      mark({ status: "uploading" });
      if (next.file.size > MAX_FILE_SIZE_BYTES) { mark({ status: "error", error: `${fmtBytes(next.file.size)} — over the ${fmtBytes(MAX_FILE_SIZE_BYTES)} limit` }); return; }
      try {
        const form = new FormData();
        form.append("file", next.file);
        if (attachToDocId) form.append("docId", attachToDocId);
        const res = await fetch("/api/files", { method: "POST", body: form });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          mark({ status: "error", error: typeof data.error === "string" ? data.error : `upload failed (${res.status})` });
          return;
        }
        mark({ status: "done" });
        onRefresh();
      } catch { mark({ status: "error", error: "network error" }); }
    })().finally(() => { busyRef.current = false; setQueue((q) => [...q]); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);
  const retry = (key: string) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, status: "waiting", error: undefined } : x)));
  const clearDone = () => setQueue((q) => q.filter((x) => x.status !== "done"));
  const pending = queue.filter((q) => q.status === "waiting" || q.status === "uploading").length;

  // ── Bulk ──
  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisible = filtered.length > 0 && filtered.every((f) => checked.has(f.id));
  const selectAll = () => setChecked(allVisible ? new Set() : new Set(filtered.map((f) => f.id)));
  const runBulk = async (body: Record<string, unknown>, label: string) => {
    setBulkBusy(true);
    try {
      const r = await fetch("/api/files/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ids: [...checked] }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast.error(`${label} failed`, d?.error); return; }
      toast.ok(`${label} · ${d.affected ?? 0} file${d.affected === 1 ? "" : "s"}`);
      setChecked(new Set()); setBulkMode(null); setBulkInput("");
      onRefresh();
    } catch (e) { toast.error(`${label} failed`, e); }
    finally { setBulkBusy(false); }
  };
  const bulkDelete = () => {
    if (!confirm(`Delete ${checked.size} file${checked.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    if ([...checked].includes(selectedId ?? "")) onSelect(null);
    void runBulk({ op: "delete" }, "Deleted");
  };
  const zipHref = `/api/files/zip?ids=${encodeURIComponent([...checked].join(","))}`;

  return (
    <div
      className={`w-full lg:w-72 lg:flex-shrink-0 flex flex-col bg-slate-950 border-r border-slate-800 min-h-0 relative ${dragOver ? "ring-2 ring-inset ring-emerald-500/60" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void filesFromDrop(e.dataTransfer).then(enqueue); }}
    >
      {dragOver && <div className="absolute inset-0 z-10 flex items-center justify-center bg-emerald-500/10 pointer-events-none"><span className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">Drop to upload</span></div>}

      {/* Header: upload + quota + search */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <div className="flex gap-1.5">
          <button onClick={() => fileInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-md transition-all glow-green">
            <span className="text-base leading-none">↑</span>{pending ? `Uploading ${pending}…` : "Upload"}
          </button>
          <button onClick={() => folderInputRef.current?.click()} title="Upload a whole folder" className="text-[10px] font-bold uppercase tracking-wider px-2 rounded-md border border-slate-700 text-slate-400 hover:text-slate-200">folder</button>
        </div>
        <input ref={fileInputRef} type="file" multiple onChange={(e) => { enqueue(Array.from(e.target.files ?? [])); e.target.value = ""; }} className="hidden" />
        <input ref={folderInputRef} type="file" multiple onChange={(e) => { enqueue(Array.from(e.target.files ?? [])); e.target.value = ""; }} className="hidden" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
        <p className="text-[10px] text-slate-600 font-mono text-center leading-relaxed">Drop files or folders anywhere in this pane · {fmtBytes(MAX_FILE_SIZE_BYTES)} per file</p>
        {attachToDocId && <p className="text-[10px] text-emerald-400 font-mono text-center">New uploads attach to the open doc</p>}
        {quota && (
          <div>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 mb-1">
              <span>{fmtBytes(quota.usedBytes)} / {fmtBytes(quota.limitBytes)}</span>
              <span>{quota.count} file{quota.count === 1 ? "" : "s"}</span>
            </div>
            <div className="h-1 bg-slate-800 rounded overflow-hidden">
              <div className={`h-full transition-all ${quota.usedBytes / quota.limitBytes > 0.9 ? "bg-red-500" : quota.usedBytes / quota.limitBytes > 0.75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (quota.usedBytes / quota.limitBytes) * 100)}%` }} />
            </div>
          </div>
        )}
        {queue.length > 0 && (
          <div className="border border-slate-800 rounded-md overflow-hidden">
            {queue.map((q) => (
              <div key={q.key} className="flex items-center gap-2 px-2 py-1 border-t border-slate-800/60 first:border-t-0 text-[10px]">
                <span className="flex-1 min-w-0 truncate text-slate-300" title={q.file.name}>{q.file.name}</span>
                {q.status === "done" && <span className="font-mono text-emerald-400">✓ {fmtBytes(q.file.size)}</span>}
                {q.status === "uploading" && <span className="font-mono text-slate-400 animate-pulse">uploading…</span>}
                {q.status === "waiting" && <span className="font-mono text-slate-600">queued</span>}
                {q.status === "error" && <><span className="font-mono text-red-400 truncate max-w-[120px]" title={q.error}>⚠ {q.error}</span><button onClick={() => retry(q.key)} className="text-slate-400 hover:text-emerald-300 font-bold uppercase tracking-wider">retry</button></>}
              </div>
            ))}
            {queue.some((q) => q.status === "done") && <button onClick={clearDone} className="w-full text-[9px] text-slate-600 hover:text-slate-300 py-1 border-t border-slate-800/60">clear finished</button>}
          </div>
        )}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search filename / tags…" className="w-full bg-slate-800/70 border border-slate-700/80 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500" />
      </div>

      {/* Bulk bar */}
      {checked.size > 0 && (
        <div className="px-3 py-2 border-b border-emerald-500/30 bg-emerald-500/5 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
            <b className="text-slate-200">{checked.size} selected</b>
            <button disabled={bulkBusy} onClick={() => setBulkMode(bulkMode === "tag" ? null : "tag")} className="font-bold uppercase tracking-wider border border-slate-700 rounded px-1.5 py-0.5 text-slate-300 hover:border-slate-500">tag</button>
            <button disabled={bulkBusy} onClick={() => setBulkMode(bulkMode === "untag" ? null : "untag")} className="font-bold uppercase tracking-wider border border-slate-700 rounded px-1.5 py-0.5 text-slate-300 hover:border-slate-500">untag</button>
            <button disabled={bulkBusy} onClick={() => attachToDocId ? void runBulk({ op: "attach", docId: attachToDocId }, "Attached to the open doc") : setBulkMode(bulkMode === "attach" ? null : "attach")} title={attachToDocId ? "Attach to the open doc" : "Attach to a doc by id"} className="font-bold uppercase tracking-wider border border-slate-700 rounded px-1.5 py-0.5 text-slate-300 hover:border-slate-500">attach{attachToDocId ? " to open doc" : "…"}</button>
            <a href={zipHref} download className="font-bold uppercase tracking-wider border border-emerald-500/50 rounded px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-500/10">⇩ .zip</a>
            <button disabled={bulkBusy} onClick={bulkDelete} className="font-bold uppercase tracking-wider border border-red-500/40 rounded px-1.5 py-0.5 text-red-300 hover:bg-red-500/10">delete</button>
            <button onClick={() => { setChecked(new Set()); setBulkMode(null); }} className="ml-auto text-slate-500 hover:text-slate-300">✕</button>
          </div>
          {bulkMode && (
            <div className="flex gap-1">
              <input autoFocus value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && bulkInput.trim()) void runBulk(bulkMode === "attach" ? { op: "attach", docId: bulkInput.trim() } : { op: bulkMode, tag: bulkInput.trim() }, bulkMode === "attach" ? "Attached" : bulkMode === "tag" ? "Tagged" : "Untagged"); if (e.key === "Escape") setBulkMode(null); }}
                placeholder={bulkMode === "attach" ? "doc id (paste from the editor's URL)" : "tag"} className="flex-1 bg-slate-800/70 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-slate-500" />
              <button disabled={bulkBusy || !bulkInput.trim()} onClick={() => void runBulk(bulkMode === "attach" ? { op: "attach", docId: bulkInput.trim() } : { op: bulkMode, tag: bulkInput.trim() }, bulkMode === "attach" ? "Attached" : bulkMode === "tag" ? "Tagged" : "Untagged")} className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-slate-950 rounded px-2 disabled:opacity-40">apply</button>
            </div>
          )}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-3 space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 bg-slate-900/60 border border-slate-800 rounded animate-pulse" />)}</div>}
        {!loading && filtered.length === 0 && (
          <p className="px-3 py-6 text-[10px] text-slate-600 font-mono text-center leading-relaxed">{search ? "No matches." : "No files yet. Upload, or drop files anywhere in this pane."}</p>
        )}
        {!loading && filtered.length > 0 && (
          <>
            <label className="flex items-center gap-2 px-3 py-1.5 text-[9px] uppercase tracking-widest text-slate-600 border-b border-slate-800/60 cursor-pointer">
              <input type="checkbox" checked={allVisible} onChange={selectAll} className="accent-emerald-500" /> select all visible ({filtered.length})
            </label>
            <ul>
              {filtered.map((f) => (
                <li key={f.id} className={`flex items-start gap-2 pl-3 pr-2 py-2 border-l-2 transition-colors ${selectedId === f.id ? "bg-slate-800/70 border-emerald-500" : "border-transparent hover:bg-slate-800/40"}`}>
                  <input type="checkbox" checked={checked.has(f.id)} onChange={() => toggle(f.id)} className="mt-1 accent-emerald-500 flex-shrink-0" aria-label={`Select ${f.filename}`} />
                  <button onClick={() => onSelect(f.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-base flex-shrink-0">{fileGlyph(f.mimeType)}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs truncate ${selectedId === f.id ? "text-slate-100" : "text-slate-300"}`} title={f.filename}>{f.filename}</p>
                        <p className="text-[9px] text-slate-600 font-mono">{fmtBytes(f.sizeBytes)} · {timeAgo(f.uploadedAt)}{f.docId ? " · attached" : ""}</p>
                      </div>
                    </div>
                    {f.tags.length > 0 && <p className="text-[9px] text-violet-400/70 font-mono truncate mt-1">{f.tags.join(" · ")}</p>}
                  </button>
                  <a href={`/api/files/${f.id}`} download title={`Download ${f.filename}`} onClick={(e) => e.stopPropagation()} className="mt-0.5 text-[11px] text-slate-600 hover:text-emerald-400 flex-shrink-0" aria-label={`Download ${f.filename}`}>⇩</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
