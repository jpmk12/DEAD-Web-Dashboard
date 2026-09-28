"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rankCommands, groupResults, GROUP_LABEL, type Command } from "@/lib/commandPalette";
import { TABS } from "@/components/layout/TabBar";
import { COCOM_LABEL } from "@/lib/aor";

// ⌘K — every surface reachable by name.
//
// Static entries (tabs, OSINT panes, actions, Preferences sections) are always
// present. Entity entries come from endpoints the app already has, fetched on
// the FIRST open of a session and refreshed when older than five minutes —
// never on page load. None of them costs a model call: the titles index,
// the SITREP base list, the I&W problem list, the force-protection
// assessments (already warm from Glance), and the family roster (403 for
// crew → silently absent).
//
// Selecting an entry dispatches the window events the tabs already listen
// for (`app:navigate`, `osint:set-pane`, `docs:open`, `watch:focus`,
// `regional:select`, `family:focus`, `prefs:open`, `capture:open`,
// `brief:open`, `digest:open`, `assistant:open`). The palette knows names and
// events; it holds no tab state.

interface Props { open: boolean; onClose: () => void }

const STALE_MS = 5 * 60 * 1000;

const STATIC: Command[] = [
  ...TABS.map((t) => ({ id: `go:${t.id}`, group: "go" as const, label: t.label, hint: "tab" })),
  { id: "go:osint:watch", group: "go", label: "OSINT · Watch", hint: "I&W · SITREP · crisis map", keywords: ["crisis", "map", "iw", "sitrep"] },
  { id: "go:osint:regional", group: "go", label: "OSINT · Regional", hint: "country situation rooms", keywords: ["ground", "truth", "dossier"] },
  { id: "go:osint:feeds", group: "go", label: "OSINT · Feeds", hint: "social · telegram · news", keywords: ["x", "telegram", "rss"] },
  { id: "go:osint:sources", group: "go", label: "OSINT · Sources", hint: "feeds, watchlist suggestions, capture", keywords: ["watchlist", "capture"] },
  { id: "act:brief", group: "act", label: "Morning brief", hint: "open today's brief", keywords: ["briefing"] },
  { id: "act:digest", group: "act", label: "Weekly digest", hint: "reading digest" },
  { id: "act:capture", group: "act", label: "Quick capture", hint: "task, event, or note", keywords: ["task", "note", "event", "add"] },
  { id: "act:assistant", group: "act", label: "Ask the assistant", hint: "AI chat with today's context", keywords: ["chat", "ai", "ask"] },
  { id: "act:alerts", group: "act", label: "Alerts on this device", hint: "push notifications setup", keywords: ["push", "notifications", "install"] },
  { id: "prefs:mission", group: "prefs", label: "Preferences — Mission Profile", keywords: ["hub", "spoke", "aoi", "theater", "airfields"] },
  { id: "prefs:you", group: "prefs", label: "Preferences — You", keywords: ["timezone", "watchlist", "topics", "home", "role"] },
  { id: "prefs:connections", group: "prefs", label: "Preferences — Connections & appearance", keywords: ["theme", "gmail", "account", "acled"] },
  { id: "prefs:email", group: "prefs", label: "Preferences — Email rules", keywords: ["vip", "mute", "senders"] },
  { id: "prefs:sources", group: "prefs", label: "Preferences — Sources & feeds", keywords: ["rss", "osint", "newsletters", "news"] },
  { id: "prefs:ai", group: "prefs", label: "Preferences — AI Controls", keywords: ["spend", "usage", "features", "model"] },
];

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const later = (ms: number, fn: () => void) => { setTimeout(fn, ms); };

function run(cmd: Command) {
  const [kind, ...rest] = cmd.id.split(":");
  const key = rest.join(":");
  switch (kind) {
    case "go": {
      if (key.startsWith("osint:")) { emit("app:navigate", "osint"); later(40, () => emit("osint:set-pane", key.slice(6))); }
      else emit("app:navigate", key);
      return;
    }
    case "act": {
      if (key === "brief") emit("brief:open");
      else if (key === "digest") emit("digest:open");
      else if (key === "capture") emit("capture:open");
      else if (key === "assistant") emit("assistant:open", { prompt: "" });
      else if (key === "alerts") emit("prefs:open", "you");
      return;
    }
    case "prefs": emit("prefs:open", key); return;
    case "base": {
      emit("app:navigate", "osint");
      later(40, () => emit("osint:set-pane", "watch"));
      later(160, () => emit("watch:focus", { kind: "sitrep", id: key }));
      return;
    }
    case "board": {
      emit("app:navigate", "osint");
      later(40, () => emit("osint:set-pane", "watch"));
      later(160, () => emit("watch:focus", { kind: "iw", id: key }));
      return;
    }
    case "country": {
      emit("app:navigate", "osint");
      later(40, () => emit("osint:set-pane", "regional"));
      later(160, () => emit("regional:select", key));
      return;
    }
    case "person": {
      try { sessionStorage.setItem("family.focus", key); } catch { /* ignore */ }
      emit("app:navigate", "family");
      later(250, () => emit("family:focus", key));
      return;
    }
    case "doc": {
      emit("app:navigate", "docs");
      later(60, () => emit("docs:open", key));
      return;
    }
    case "docsearch": {
      emit("app:navigate", "docs");
      later(60, () => emit("docs:search", key));
      return;
    }
  }
}

async function loadEntities(): Promise<Command[]> {
  const out: Command[] = [];
  const j = async (url: string) => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };
  const [docs, bases, warn, fp, roster] = await Promise.all([
    j("/api/documents/titles"), j("/api/sitrep/bases"), j("/api/warning"), j("/api/force-protection"), j("/api/family/roster"),
  ]);
  for (const b of (bases?.bases ?? []) as { icao: string; label: string; place?: string; country?: string }[]) {
    out.push({ id: `base:${b.icao}`, group: "base", label: `${b.label} (${b.icao})`, hint: `SITREP · ${b.place || b.country || ""}`.trim(), keywords: [b.icao, b.icao.slice(1), "sitrep"] });
  }
  for (const p of (warn?.problems ?? []) as { problemId: string; label: string; level?: string }[]) {
    out.push({ id: `board:${p.problemId}`, group: "board", label: p.label, hint: `I&W board${p.level ? ` · ${p.level}` : ""}`, keywords: ["iw", "warning", "indicators", "board"] });
  }
  const seenCountry = new Set<string>();
  for (const a of (fp?.assessments ?? []) as { country: string; label: string; cocom: string; kind: string; icao?: string }[]) {
    if (!a.country || seenCountry.has(a.country)) continue;
    seenCountry.add(a.country);
    const cocom = COCOM_LABEL[a.cocom as keyof typeof COCOM_LABEL] ?? a.cocom;
    out.push({ id: `country:${a.country}`, group: "country", label: a.country, hint: `Regional · ${cocom}`, keywords: [a.cocom, "regional", "ground", "posture"] });
  }
  for (const p of (roster?.profile?.people ?? []) as { id: string; name: string; role?: string; school?: string }[]) {
    out.push({ id: `person:${p.id}`, group: "person", label: p.name, hint: [p.role, p.school].filter(Boolean).join(" · ") || "family", keywords: ["family", "deadlines"] });
  }
  for (const d of (docs?.docs ?? []) as { id: string; title: string; aliases?: string[]; docType?: string; collection?: string }[]) {
    out.push({ id: `doc:${d.id}`, group: "doc", label: d.title, hint: [d.docType, d.collection].filter(Boolean).join(" · ") || "doc", keywords: d.aliases ?? [] });
  }
  return out;
}

export default function CommandPalette({ open, onClose }: Props) {
  const [q, setQ] = useState("");
  const [entities, setEntities] = useState<Command[]>([]);
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch on open, not on mount; refresh when stale.
  useEffect(() => {
    if (!open) return;
    setQ(""); setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    if (Date.now() - loadedAt < STALE_MS || loading) return;
    setLoading(true);
    loadEntities().then((e) => { setEntities(e); setLoadedAt(Date.now()); }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const all = useMemo(() => [...STATIC, ...entities], [entities]);
  const results = useMemo(() => {
    const r = rankCommands(q, all);
    const t = q.trim();
    if (t.length >= 2) r.push({ id: `docsearch:${t}`, group: "doc", label: `Search docs for “${t}”`, hint: "full-text" });
    return r;
  }, [q, all]);
  const groups = useMemo(() => groupResults(results), [results]);

  useEffect(() => { setCursor(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const choose = useCallback((cmd: Command) => { onClose(); run(cmd); }, [onClose]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const c = results[cursor]; if (c) choose(c); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  if (!open) return null;

  let idx = -1;
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div className="absolute left-1/2 -translate-x-1/2 top-[8vh] w-[min(640px,calc(100vw-24px))] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 border-b border-slate-800">
          <span className="text-slate-500 text-sm" aria-hidden>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Go to a tab, base, board, country, person, doc, setting… or an action"
            aria-label="Search commands"
            className="flex-1 bg-transparent py-3 text-sm text-slate-100 placeholder-slate-600 outline-none"
          />
          {loading && <span className="text-[10px] text-slate-500">loading…</span>}
          <kbd className="hidden sm:inline text-[10px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <p className="px-4 py-6 text-xs text-slate-500 text-center">Nothing matches.</p>
          )}
          {groups.map((g) => (
            <div key={g.group}>
              <p className="px-4 pt-2 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-600">{GROUP_LABEL[g.group]}</p>
              {g.items.map((c) => {
                idx++;
                const i = idx;
                const active = i === cursor;
                return (
                  <button
                    key={c.id}
                    data-idx={i}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(c)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left ${active ? "bg-emerald-500/10" : ""}`}
                  >
                    <span className={`text-[13px] truncate ${active ? "text-emerald-300" : "text-slate-200"}`}>{c.label}</span>
                    {c.hint && <span className="text-[10px] text-slate-500 truncate">{c.hint}</span>}
                    {active && <span className="ml-auto text-[10px] text-slate-600 flex-shrink-0">↵</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="px-4 py-1.5 border-t border-slate-800 text-[10px] text-slate-600 flex gap-3">
          <span>↑↓ move</span><span>↵ open</span><span className="ml-auto">⌘K / Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
