"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";

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

interface QuotaUsage {
  usedBytes: number;
  limitBytes: number;
  count: number;
}

interface FilesPanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Bumped on any upload/delete/edit so the right pane can refetch its
  // metadata view.
  refreshKey: number;
  onRefresh: () => void;
  // Optional doc context: when set, the Upload button defaults to attaching
  // newly-uploaded files to this doc.
  attachToDocId?: string | null;
}

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Pick a glyph based on the MIME family. Crude but readable in a 16px row.
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
  try { return formatDistanceToNow(parseISO(s), { addSuffix: true }); }
  catch { return ""; }
}

export default function FilesPanel({ selectedId, onSelect, refreshKey, onRefresh, attachToDocId }: FilesPanelProps) {
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [quota, setQuota] = useState<QuotaUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch the file list + quota on mount and whenever the refresh key bumps.
  useEffect(() => {
    setLoading(true);
    fetch("/api/files")
      .then((r) => r.json())
      .then((d) => {
        setFiles(Array.isArray(d?.files) ? d.files : []);
        setQuota(d?.quota ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) =>
      f.filename.toLowerCase().includes(q) ||
      f.tags.some((t) => t.toLowerCase().includes(q)) ||
      (f.description ?? "").toLowerCase().includes(q)
    );
  }, [files, search]);

  // Single shared upload path — both the file picker and drag/drop call this.
  const upload = async (file: File) => {
    setUploadError(null);
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError(`"${file.name}" is ${fmtBytes(file.size)}. Per-file limit is ${fmtBytes(MAX_FILE_SIZE_BYTES)}.`);
      return;
    }
    if (quota && quota.usedBytes + file.size > quota.limitBytes) {
      setUploadError(`Storage quota would be exceeded — ${fmtBytes(quota.usedBytes)}/${fmtBytes(quota.limitBytes)} used. Delete some files first.`);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (attachToDocId) form.append("docId", attachToDocId);
      const res = await fetch("/api/files", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUploadError(typeof data.error === "string" ? data.error : `Upload failed (${res.status})`);
        return;
      }
      onRefresh();
    } catch {
      setUploadError("Network error");
    } finally {
      setUploading(false);
    }
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;
    // Serial loop so quota is rechecked between each — parallel uploads can
    // race against a tight quota and fail mid-batch.
    (async () => {
      for (let i = 0; i < list.length; i++) await upload(list[i]);
    })();
    e.target.value = ""; // allow re-picking the same file
  };

  return (
    <div className="w-72 flex-shrink-0 flex flex-col bg-slate-950 border-r border-slate-800 min-h-0">
      {/* Header: upload + quota + search */}
      <div
        className={`p-3 border-b border-slate-800 space-y-2 transition-colors ${dragOver ? "bg-emerald-500/5 border-emerald-500/40" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const dropped = Array.from(e.dataTransfer.files);
          (async () => { for (const f of dropped) await upload(f); })();
        }}
      >
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-md transition-all glow-green"
        >
          <span className="text-base leading-none">↑</span>
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={onPickFiles}
          className="hidden"
        />
        <p className="text-[10px] text-slate-600 font-mono text-center leading-relaxed">
          Drop files here · {fmtBytes(MAX_FILE_SIZE_BYTES)} per-file limit
        </p>
        {attachToDocId && (
          <p className="text-[10px] text-emerald-400 font-mono text-center">
            New uploads attach to the open doc
          </p>
        )}
        {/* Quota bar */}
        {quota && (
          <div>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 mb-1">
              <span>{fmtBytes(quota.usedBytes)} / {fmtBytes(quota.limitBytes)}</span>
              <span>{quota.count} file{quota.count === 1 ? "" : "s"}</span>
            </div>
            <div className="h-1 bg-slate-800 rounded overflow-hidden">
              <div
                className={`h-full transition-all ${
                  quota.usedBytes / quota.limitBytes > 0.9 ? "bg-red-500"
                  : quota.usedBytes / quota.limitBytes > 0.75 ? "bg-amber-500"
                  : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, (quota.usedBytes / quota.limitBytes) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {uploadError && (
          <p className="text-[10px] text-red-400 font-mono leading-snug">⚠ {uploadError}</p>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search filename / tags…"
          className="w-full bg-slate-800/70 border border-slate-700/80 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-3 space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-slate-900/60 border border-slate-800 rounded animate-pulse" />)}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="px-3 py-6 text-[10px] text-slate-600 font-mono text-center leading-relaxed">
            {search ? "No matches." : "No files yet. Upload or drop a file above."}
          </p>
        )}
        {!loading && filtered.length > 0 && (
          <ul>
            {filtered.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => onSelect(f.id)}
                  className={`w-full text-left px-3 py-2 border-l-2 transition-colors ${
                    selectedId === f.id
                      ? "bg-slate-800/70 border-emerald-500"
                      : "border-transparent hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base flex-shrink-0">{fileGlyph(f.mimeType)}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs truncate ${selectedId === f.id ? "text-slate-100" : "text-slate-300"}`} title={f.filename}>
                        {f.filename}
                      </p>
                      <p className="text-[9px] text-slate-600 font-mono">
                        {fmtBytes(f.sizeBytes)} · {timeAgo(f.uploadedAt)}
                      </p>
                    </div>
                  </div>
                  {f.tags.length > 0 && (
                    <p className="text-[9px] text-violet-400/70 font-mono truncate mt-1">
                      {f.tags.join(" · ")}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
