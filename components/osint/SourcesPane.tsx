"use client";

import { useEffect, useMemo, useState } from "react";
import XImportCard from "@/components/osint/XImportCard";
import CaptureStatusCard from "@/components/osint/CaptureStatusCard";
import { suggestionGroupsForAors } from "@/lib/osintSuggestions";
import type { OsintFeed } from "@/lib/types";

// The OSINT ingestion control room — one home for everything the dashboard pulls
// in: browser-captured sources (𝕏 posts, 📄 analysis, 🗺 events) AND the live
// RSS/Telegram feeds, editable inline (owner) so you never leave the tab.

interface FeedSummary { id: string; label: string; kind: string; count: number; ok?: boolean; fetchedAt?: number; }
const CAPTURE_FEED_IDS = new Set(["x-import", "article-capture", "event-capture"]);
const KIND_BADGE: Record<string, string> = {
  social: "text-sky-300 border-sky-500/40", telegram: "text-cyan-300 border-cyan-500/40",
  news: "text-emerald-300 border-emerald-500/40", other: "text-slate-300 border-slate-600",
};

export default function SourcesPane({ feeds, onChanged }: { active: boolean; feeds: FeedSummary[]; onChanged: () => void }) {
  const health = useMemo(() => {
    const m = new Map<string, FeedSummary>();
    for (const f of feeds) if (!CAPTURE_FEED_IDS.has(f.id)) m.set(f.id, f);
    return m;
  }, [feeds]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-slate-100">⇪ Sources</h2>
        <span className="text-[11px] text-slate-500">everything you ingest — browser captures feed the whole tab (Social, News, and I&amp;W corroboration).</span>
      </div>

      <XImportCard onImported={onChanged} />
      <CaptureStatusCard onChanged={onChanged} />
      <FeedsEditor health={health} onChanged={onChanged} />
    </div>
  );
}

function FeedsEditor({ health, onChanged }: { health: Map<string, FeedSummary>; onChanged: () => void }) {
  const [feeds, setFeeds] = useState<OsintFeed[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<OsintFeed["kind"]>("news");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    fetch("/api/osint/feeds").then((r) => r.json()).then((d) => {
      if (Array.isArray(d?.feeds)) setFeeds(d.feeds);
      setCanEdit(!!d?.canEdit);
    }).catch(() => setFeeds([]));
  };
  useEffect(() => { load(); }, []);

  const save = async (next: OsintFeed[]) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/osint/feeds", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feeds: next }) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Save failed."); return; }
      if (Array.isArray(d.feeds)) setFeeds(d.feeds);
      onChanged();
    } finally { setBusy(false); }
  };

  const add = (l: string, u: string, k: OsintFeed["kind"]) => {
    if (!l.trim() || !u.trim() || !feeds) return;
    save([...feeds, { id: "", label: l.trim(), url: u.trim(), kind: k }]);
  };
  const remove = (id: string) => { if (feeds) save(feeds.filter((f) => f.id !== id)); };

  // Suggested feeds not already added — led by the groups relevant to the
  // declared AO (Mission Profile theaters + AOI AORs) when one exists.
  const [aoAors, setAoAors] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/mission-profile")
      .then((r) => r.json())
      .then((d: { profile?: { theaters?: string[]; aois?: { aor: string }[] } }) => {
        const p = d?.profile;
        if (!p) return;
        setAoAors([...new Set([...(p.theaters ?? []), ...(p.aois ?? []).map((a) => a.aor)])]);
      })
      .catch(() => {});
  }, []);
  const { suggestions, aoLed } = useMemo(() => {
    const have = new Set((feeds ?? []).map((f) => f.url));
    const { groups, aoLed } = suggestionGroupsForAors(aoAors);
    return { suggestions: groups.flatMap((g) => g.feeds).filter((s) => !have.has(s.url)).slice(0, 6), aoLed };
  }, [feeds, aoAors]);

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-slate-300 font-bold text-xs">Live feeds</span>
        <span className="text-[10px] text-slate-600 font-mono">RSS · Telegram · server-fetched</span>
        {!canEdit && feeds !== null && <span className="ml-auto text-[10px] text-slate-600">shared — editable by the owner</span>}
      </div>

      {feeds === null ? (
        <p className="text-[10px] text-slate-600">Loading feeds…</p>
      ) : feeds.length === 0 ? (
        <p className="text-[10px] text-slate-600 leading-snug">No RSS/Telegram feeds configured. Add news sites, public Telegram channels (t.me/s/…), or Reddit/Bluesky/Mastodon RSS below.</p>
      ) : (
        <div className="space-y-1">
          {feeds.map((f) => {
            const h = health.get(f.id);
            return (
              <div key={f.id} className="flex items-center gap-2 text-[11px]">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${h?.ok === false ? "bg-red-500" : h ? "bg-emerald-500" : "bg-slate-700"}`} title={h?.ok === false ? "Last fetch failed" : h ? "OK" : "Not fetched yet"} />
                <span className="text-slate-300 truncate flex-1 min-w-0" title={f.url}>{f.label}</span>
                <span className={`text-[8px] font-mono uppercase tracking-wider border rounded px-1 py-px flex-shrink-0 ${KIND_BADGE[f.kind] ?? KIND_BADGE.other}`}>{f.kind}</span>
                {h && <span className="text-[10px] font-mono text-slate-500 w-7 text-right flex-shrink-0">{h.count}</span>}
                {canEdit && <button type="button" onClick={() => remove(f.id)} disabled={busy} className="text-slate-600 hover:text-red-400 flex-shrink-0 disabled:opacity-40" title="Remove">✕</button>}
              </div>
            );
          })}
        </div>
      )}

      {err && <p className="text-[10px] text-red-400">{err}</p>}

      {canEdit && (
        <div className="border-t border-slate-800/60 pt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://feed-url / t.me/s/channel" className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600" />
            <select value={kind} onChange={(e) => setKind(e.target.value as OsintFeed["kind"])} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-300">
              <option value="news">news</option><option value="social">social</option><option value="telegram">telegram</option><option value="other">other</option>
            </select>
            <button type="button" onClick={() => { add(label, url, kind); setLabel(""); setUrl(""); }} disabled={busy || !label.trim() || !url.trim()} className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border border-sky-500/40 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-40 flex-shrink-0">{busy ? "…" : "Add"}</button>
          </div>
          {suggestions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] text-slate-600 uppercase tracking-wider">{aoLed ? "Suggested for your AO:" : "Suggested:"}</span>
              {suggestions.map((s) => (
                <button key={s.url} type="button" onClick={() => add(s.label, s.url, s.kind)} disabled={busy} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 disabled:opacity-40">+ {s.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[9px] text-slate-600">Edits here save to the shared feed set — same as Preferences → Sources &amp; feeds, which also has a per-feed Test.</p>
    </div>
  );
}
