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
  // Auto-capture (browser-extension) token management.
  const [showAuto, setShowAuto] = useState(false);
  const [tok, setTok] = useState<{ configured: boolean; label: string | null; lastUsedAt: string | null; expectedIntervalHours: number | null } | null>(null);
  const [newTok, setNewTok] = useState<string | null>(null);
  const [tokBusy, setTokBusy] = useState(false);
  const [tokCopied, setTokCopied] = useState(false);

  const refresh = () => {
    fetch("/api/osint/x-import")
      .then((r) => r.json())
      .then((d) => { if (typeof d?.count === "number") setStatus(d); })
      .catch(() => {});
  };
  const refreshToken = () => {
    fetch("/api/settings/x-token").then((r) => r.json()).then((d) => setTok(d)).catch(() => {});
  };
  useEffect(() => { refresh(); refreshToken(); }, []);
  // Keep the freshness pill honest while the pane is open (token last-used bumps
  // on every unattended upload). Cheap GET; the server value only moves daily.
  useEffect(() => {
    const id = setInterval(refreshToken, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const generateToken = async () => {
    setTokBusy(true);
    try {
      const res = await fetch("/api/settings/x-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "browser extension" }) });
      const d = await res.json();
      if (res.ok && d.token) { setNewTok(d.token); refreshToken(); }
    } finally { setTokBusy(false); }
  };
  const revokeToken = async () => {
    if (!window.confirm("Revoke the upload token? The extension will stop uploading until you generate a new one.")) return;
    setTokBusy(true);
    try { await fetch("/api/settings/x-token", { method: "DELETE" }); setNewTok(null); refreshToken(); }
    finally { setTokBusy(false); }
  };
  const copyToken = () => {
    if (!newTok) return;
    navigator.clipboard?.writeText(newTok).then(() => { setTokCopied(true); setTimeout(() => setTokCopied(false), 2000); }).catch(() => {});
  };

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
        {tok?.configured && (() => {
          // Freshness of the UNATTENDED pipeline: when the extension last posted
          // (token last-used), judged against its self-reported cadence — green
          // under ~2× the interval, amber under ~4×, red beyond. Falls back to a
          // daily assumption (28h/72h) until the extension reports its schedule.
          const lastMs = tok.lastUsedAt ? new Date(tok.lastUsedAt).getTime() : null;
          const ageH = lastMs ? (Date.now() - lastMs) / 3_600_000 : null;
          const iv = tok.expectedIntervalHours;
          const greenH = iv ? iv * 2 : 28;
          const amberH = iv ? iv * 4 : 72;
          const tier = ageH == null ? "idle" : ageH < greenH ? "fresh" : ageH < amberH ? "stale" : "cold";
          const cls = {
            fresh: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
            stale: "border-amber-500/40 text-amber-300 bg-amber-500/10",
            cold: "border-red-500/40 text-red-300 bg-red-500/10",
            idle: "border-slate-700 text-slate-500",
          }[tier];
          const cadence = iv ? ` (expected every ~${iv}h)` : "";
          const title = {
            fresh: `Automated capture is current${cadence}.`,
            stale: `No automated upload in a while${cadence} — is your browser open on schedule?`,
            cold: "No automated upload well past schedule — check the extension (chrome://extensions → options → Run now).",
            idle: "Token generated, but no automated upload received yet.",
          }[tier];
          const txt = lastMs ? `auto ${formatDistanceToNow(new Date(tok.lastUsedAt as string), { addSuffix: true })}` : "auto: not yet run";
          return (
            <span title={title} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${cls}`}>
              {tier === "idle" ? "○" : "●"} {txt}
            </span>
          );
        })()}
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
        <button
          type="button"
          onClick={() => setShowAuto((v) => !v)}
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-all ${showAuto ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"}`}
        >
          Auto-capture {tok?.configured ? "●" : ""} {showAuto ? "▴" : "▾"}
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
            <li>On <span className="font-mono text-slate-300">x.com</span>, open the list / bookmarks / search / profile you want, then <span className="text-slate-200">tap the bookmark once to start collecting</span> — a green counter appears bottom-right.</li>
            <li><span className="text-slate-200">Scroll normally</span> — the counter climbs as posts render (X removes posts from the page as you scroll, so collection has to ride along; up to 200).</li>
            <li>Tap the <span className="text-emerald-400">green counter</span> (or the bookmark again) — it downloads <span className="font-mono text-slate-300">x-capture-….json</span>.</li>
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

      {showAuto && (
        <div className="border-t border-slate-800 pt-2 space-y-2 text-[11px] text-slate-400 leading-relaxed">
          <p>
            Unattended daily capture via a <span className="text-slate-200">browser extension</span> that runs in your own
            logged-in browser (same safety model — nothing goes to X). Generate a token below, then load the extension from
            <span className="font-mono text-slate-300"> tools/x-auto-capture/</span> and paste the token into its options.
          </p>

          {newTok ? (
            <div className="space-y-1.5">
              <p className="text-amber-300">Copy this token now — it&apos;s shown only once:</p>
              <div className="flex items-center gap-2">
                <input readOnly value={newTok} onFocus={(e) => e.target.select()} className="flex-1 bg-slate-950/60 border border-emerald-500/40 rounded-md px-2 py-1.5 text-[11px] font-mono text-emerald-300" />
                <button type="button" onClick={copyToken} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20">{tokCopied ? "✓" : "⧉ Copy"}</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" disabled={tokBusy} onClick={generateToken} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50">
                {tok?.configured ? "↻ Regenerate token" : "＋ Generate token"}
              </button>
              {tok?.configured && (
                <>
                  <span className="text-[10px] text-slate-500 font-mono">token active{tok.lastUsedAt ? ` · last used ${formatDistanceToNow(new Date(tok.lastUsedAt), { addSuffix: true })}` : " · not used yet"}</span>
                  <button type="button" disabled={tokBusy} onClick={revokeToken} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border border-slate-700 text-slate-500 hover:border-red-500/40 hover:text-red-400 disabled:opacity-50">Revoke</button>
                </>
              )}
            </div>
          )}

          <ol className="list-decimal list-inside space-y-0.5 text-slate-400">
            <li><span className="text-slate-200">Generate a token</span> above and copy it.</li>
            <li>In Chrome/Edge → <span className="font-mono text-slate-300">chrome://extensions</span> → Developer mode → <span className="text-slate-200">Load unpacked</span> → pick <span className="font-mono text-slate-300">tools/x-auto-capture/</span>.</li>
            <li>Open the extension&apos;s <span className="text-slate-200">options</span>, paste your dashboard URL, the token, and the X list URL to capture. Save, then <span className="text-emerald-400">Run now</span> to test.</li>
          </ol>
          <p className="text-slate-600">Runs daily while your browser is open. Regenerating rotates the token (the old one stops working); the manual file upload above always keeps working.</p>
        </div>
      )}
    </div>
  );
}
