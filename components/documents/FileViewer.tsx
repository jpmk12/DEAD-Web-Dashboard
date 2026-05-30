"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";

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

interface FileViewerProps {
  fileId: string;
  onChanged: () => void;
  onDeleted: () => void;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Right-pane file viewer. Header carries filename + metadata + actions;
// body renders a preview tuned to the mime family (image inline / PDF in
// an iframe / plain text inline / generic icon block for everything else).
// Metadata edits PATCH and refresh on success.
export default function FileViewer({ fileId, onChanged, onDeleted }: FileViewerProps) {
  const [file, setFile] = useState<FileSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ filename: string; description: string; tags: string }>({
    filename: "", description: "", tags: "",
  });

  // Fetch metadata. The bytes only stream on the preview/download routes.
  useEffect(() => {
    setLoading(true);
    setTextPreview(null);
    fetch("/api/files")
      .then((r) => r.json())
      .then((d) => {
        const list: FileSummary[] = Array.isArray(d?.files) ? d.files : [];
        const hit = list.find((f) => f.id === fileId) ?? null;
        setFile(hit);
        if (hit) {
          setDraft({
            filename: hit.filename,
            description: hit.description ?? "",
            tags: hit.tags.join(", "),
          });
        }
      })
      .catch(() => setFile(null))
      .finally(() => setLoading(false));
  }, [fileId]);

  // For text-family files small enough to inline, fetch the body and render
  // as preformatted text. Cap at 200 KB so we don't render a 25 MB log.
  useEffect(() => {
    if (!file) { setTextPreview(null); return; }
    const isText = file.mimeType.startsWith("text/")
      || file.mimeType === "application/json"
      || file.mimeType === "application/xml";
    if (!isText || file.sizeBytes > 200 * 1024) { setTextPreview(null); return; }
    fetch(`/api/files/${file.id}/inline`)
      .then((r) => r.text())
      .then((text) => setTextPreview(text))
      .catch(() => setTextPreview(null));
  }, [file]);

  const save = async () => {
    if (!file) return;
    const patch = {
      filename: draft.filename.trim() || file.filename,
      description: draft.description.trim() || null,
      tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    const res = await fetch(`/api/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.file) setFile(data.file);
      setEditing(false);
      onChanged();
    }
  };

  const onDelete = async () => {
    if (!file) return;
    if (!confirm(`Delete "${file.filename}"? This can't be undone.`)) return;
    const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (res.ok) {
      onChanged();
      onDeleted();
    }
  };

  if (loading || !file) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-sm font-mono">
        {loading ? "Loading…" : "File not found"}
      </div>
    );
  }

  const isImage = file.mimeType.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Header */}
      <div className="border-b border-slate-800 px-5 py-3 flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              value={draft.filename}
              onChange={(e) => setDraft({ ...draft, filename: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
              autoFocus
              className="flex-1 bg-slate-800 border border-slate-700 focus:border-emerald-500/40 rounded px-2 py-1 text-sm text-slate-100 outline-none"
            />
          ) : (
            <p className="flex-1 text-base font-bold text-slate-100 truncate" title={file.filename}>{file.filename}</p>
          )}
          <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">
            {fmtBytes(file.sizeBytes)} · {file.mimeType}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-600 font-mono">
          <span>Uploaded {(() => { try { return format(parseISO(file.uploadedAt), "MMM d, yyyy 'at' h:mm a"); } catch { return file.uploadedAt; } })()}</span>
          <span className="flex-1" />
          {editing ? (
            <>
              <button onClick={save} className="text-emerald-400 hover:text-emerald-300 font-bold uppercase tracking-wider">Save</button>
              <button onClick={() => setEditing(false)} className="text-slate-500 hover:text-slate-300 font-bold uppercase tracking-wider">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} title="Edit filename / description / tags" className="text-slate-500 hover:text-slate-300">Edit</button>
              <a href={`/api/files/${file.id}`} download className="text-slate-500 hover:text-emerald-400" title="Download">⬇</a>
              <button onClick={onDelete} title="Delete" className="text-slate-500 hover:text-red-400">🗑</button>
            </>
          )}
        </div>
        {editing ? (
          <>
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="tags, comma-separated"
              className="bg-slate-800 border border-slate-700 focus:border-emerald-500/40 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-700 outline-none"
            />
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Optional description / notes"
              rows={2}
              className="bg-slate-800 border border-slate-700 focus:border-emerald-500/40 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-700 outline-none resize-none"
            />
          </>
        ) : (
          <>
            {file.tags.length > 0 && (
              <p className="text-[10px] text-violet-400/80 font-mono truncate">{file.tags.join(" · ")}</p>
            )}
            {file.description && (
              <p className="text-xs text-slate-400 leading-relaxed">{file.description}</p>
            )}
          </>
        )}
      </div>

      {/* Body — preview tuned to file kind */}
      <div className="flex-1 overflow-auto bg-slate-900/40 min-h-0">
        {isImage && (
          <div className="flex items-center justify-center h-full p-4">
            <img
              src={`/api/files/${file.id}/inline`}
              alt={file.filename}
              className="max-w-full max-h-full object-contain rounded shadow-lg"
            />
          </div>
        )}
        {isPdf && (
          <iframe
            src={`/api/files/${file.id}/inline`}
            title={file.filename}
            className="w-full h-full border-0 bg-white"
          />
        )}
        {textPreview !== null && (
          <pre className="p-5 text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">{textPreview}</pre>
        )}
        {!isImage && !isPdf && textPreview === null && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-3">
            <p className="text-5xl">{fileGlyph(file.mimeType)}</p>
            <p className="text-sm font-bold text-slate-300">No inline preview for {file.mimeType.split("/")[0] || "this format"}</p>
            <a
              href={`/api/files/${file.id}`}
              download
              className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 rounded-md transition-all"
            >
              ⬇ Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
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
