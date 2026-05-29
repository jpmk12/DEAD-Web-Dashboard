"use client";

import { useEffect, useState, KeyboardEvent } from "react";
import { useSession, signOut } from "next-auth/react";
import { UserPrefs, AppTheme, TrackedLocation, TickerEntry, OsintFeed, AiFeature, AiUsageSummary } from "@/lib/types";
import { ALL_AI_FEATURES, AI_FEATURE_LABELS } from "@/lib/aiFeatures";
import { applyTheme } from "@/components/ThemeApplicator";

interface PreferencesDrawerProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function TagInput({
  label,
  description,
  tags,
  onChange,
  placeholder,
  accent = "emerald",
}: {
  label: string;
  description?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
  accent?: "emerald" | "orange" | "red";
}) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setInput("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !input && tags.length) onChange(tags.slice(0, -1));
  };

  const tagColors = {
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    orange:  "bg-orange-500/15 text-orange-300 border-orange-500/30",
    red:     "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</label>
      {description && <p className="text-[10px] text-slate-600 mb-2">{description}</p>}
      <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-800/70 border border-slate-700/80 rounded-lg min-h-[44px] focus-within:border-slate-500 transition-colors">
        {tags.map((tag) => (
          <span key={tag} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border ${tagColors[accent]}`}>
            {tag}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="opacity-60 hover:opacity-100 transition-opacity leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[100px] bg-transparent text-xs text-slate-200 placeholder-slate-600 outline-none"
        />
      </div>
      <p className="text-[10px] text-slate-700 mt-1">Enter or comma to add · Backspace to remove last</p>
    </div>
  );
}

// ─── Tracked locations editor (Weather tab) ──────────────────────────────────

function TrackedLocationsEditor({ value, onChange }: { value: TrackedLocation[]; onChange: (v: TrackedLocation[]) => void; }) {
  const [label, setLabel] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  const add = () => {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (!label.trim() || !Number.isFinite(la) || !Number.isFinite(lo)) return;
    if (Math.abs(la) > 90 || Math.abs(lo) > 180) return;
    onChange([...value, { id: `${la.toFixed(2)},${lo.toFixed(2)}-${Date.now()}`, label: label.trim().slice(0, 60), lat: la, lon: lo }]);
    setLabel(""); setLat(""); setLon("");
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Tracked Locations
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Extra locations shown alongside your home on the Weather tab. Each gets a forecast card,
        active NWS alerts, and feeds the alerts aggregator. Up to 10.
      </p>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {value.map((loc) => (
            <li key={loc.id} className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5">
              <span className="text-xs text-slate-200 flex-1 min-w-0 truncate">{loc.label}</span>
              <span className="text-[10px] text-slate-500 font-mono">{loc.lat.toFixed(2)}, {loc.lon.toFixed(2)}</span>
              <button
                onClick={() => onChange(value.filter((x) => x.id !== loc.id))}
                className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1"
                title="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Kadena AB)"
          className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <input
          value={lat} onChange={(e) => setLat(e.target.value)}
          placeholder="Lat"
          className="w-16 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <input
          value={lon} onChange={(e) => setLon(e.target.value)}
          placeholder="Lon"
          className="w-16 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <button
          onClick={add}
          disabled={!label.trim() || value.length >= 10}
          className="text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Markets watchlist editor (Markets tab) ──────────────────────────────────

function MarketsWatchlistEditor({ value, onChange }: { value: TickerEntry[]; onChange: (v: TickerEntry[]) => void; }) {
  const [symbol, setSymbol] = useState("");
  const [label, setLabel] = useState("");
  const add = () => {
    const sym = symbol.trim().toUpperCase();
    const lab = label.trim().slice(0, 60);
    if (!sym || !lab) return;
    if (!/^[A-Z0-9:_!.\-]{1,32}$/.test(sym)) return;
    if (value.some((e) => e.symbol === sym)) return;
    onChange([...value, { symbol: sym, label: lab }]);
    setSymbol(""); setLabel("");
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Markets Watchlist
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        TradingView symbols shown on the Markets tab. Format: <code className="text-emerald-400">EXCHANGE:TICKER</code> (e.g.&nbsp;
        <code className="text-emerald-400">NYSE:LMT</code>, <code className="text-emerald-400">NYMEX:CL1!</code>,
        <code className="text-emerald-400">FX:USDJPY</code>). Up to 30.
      </p>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5 max-h-48 overflow-y-auto">
          {value.map((t) => (
            <li key={t.symbol} className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5">
              <span className="text-[10px] font-mono text-emerald-400 flex-shrink-0">{t.symbol}</span>
              <span className="text-xs text-slate-300 flex-1 min-w-0 truncate">{t.label}</span>
              <button
                onClick={() => onChange(value.filter((x) => x.symbol !== t.symbol))}
                className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <input
          value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="NYSE:KTOS"
          className="w-32 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Display name"
          className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <button
          onClick={add}
          disabled={!symbol.trim() || !label.trim() || value.length >= 30}
          className="text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── OSINT feeds editor ──────────────────────────────────────────────────────

interface OsintFeedHealth { id: string; count: number; fetchedAt: number; ok: boolean }

function OsintFeedsEditor({ value, onChange }: { value: OsintFeed[]; onChange: (v: OsintFeed[]) => void; }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<OsintFeed["kind"]>("social");
  const [health, setHealth] = useState<Record<string, OsintFeedHealth>>({});
  const [healthLoading, setHealthLoading] = useState(false);

  // Pull the current per-feed health (last fetch time, item count, ok flag)
  // from /api/osint/feed. Cache means this is cheap if the OSINT tab was
  // recently viewed. Re-runs whenever the configured feed list changes so
  // a freshly-added feed gets a status indicator on the next refresh.
  useEffect(() => {
    if (value.length === 0) { setHealth({}); return; }
    setHealthLoading(true);
    fetch("/api/osint/feed")
      .then((r) => r.json())
      .then((d) => {
        const arr: OsintFeedHealth[] = Array.isArray(d?.feeds) ? d.feeds : [];
        const map: Record<string, OsintFeedHealth> = {};
        for (const f of arr) map[f.id] = f;
        setHealth(map);
      })
      .catch(() => {})
      .finally(() => setHealthLoading(false));
  }, [value.length]);

  // Format the dot's title attribute — what the user sees on hover.
  const healthLabel = (h: OsintFeedHealth | undefined): { dot: string; title: string } => {
    if (!h || !h.fetchedAt) return { dot: "bg-slate-700", title: "Not fetched yet" };
    const ageMin = Math.floor((Date.now() - h.fetchedAt) / 60_000);
    const ageLabel = ageMin < 1 ? "just now" : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ago`;
    if (!h.ok) return { dot: "bg-red-500", title: `Last fetch failed · ${ageLabel}` };
    if (h.count === 0) return { dot: "bg-amber-500", title: `0 items · last fetched ${ageLabel}` };
    return { dot: "bg-emerald-500", title: `${h.count} items · last fetched ${ageLabel}` };
  };

  const add = () => {
    const trimUrl = url.trim();
    const trimLabel = label.trim().slice(0, 60);
    if (!trimUrl || !trimLabel) return;
    try {
      const u = new URL(trimUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") return;
    } catch { return; }
    onChange([...value, { id: `${kind}-${Date.now()}`, label: trimLabel, url: trimUrl.slice(0, 500), kind }]);
    setLabel(""); setUrl("");
  };

  const KIND_STYLE: Record<OsintFeed["kind"], string> = {
    social:   "bg-sky-500/15 text-sky-300 border-sky-500/40",
    telegram: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
    news:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    other:    "bg-slate-700/40 text-slate-300 border-slate-600",
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        OSINT Feeds
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        RSS / Atom URLs shown on the OSINT tab. Suggested: Nitter / rsshub.app bridges for X accounts (
        <code className="text-emerald-400">https://rsshub.app/twitter/user/USERNAME</code>) and Telegram channels (
        <code className="text-emerald-400">https://rsshub.app/telegram/channel/NAME</code>). Up to 20.
      </p>

      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5 max-h-56 overflow-y-auto">
          {value.map((f) => {
            const h = healthLabel(health[f.id]);
            return (
              <li key={f.id} className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/60 rounded-md px-2.5 py-1.5">
                <span
                  className={`flex-shrink-0 w-2 h-2 rounded-full ${h.dot} ${healthLoading ? "animate-pulse" : ""}`}
                  title={h.title}
                />
                <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${KIND_STYLE[f.kind]}`}>
                  {f.kind}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 truncate">{f.label}</p>
                  <p className="text-[9px] text-slate-600 font-mono truncate">{f.url}</p>
                </div>
                <button
                  onClick={() => onChange(value.filter((x) => x.id !== f.id))}
                  className="text-slate-500 hover:text-red-400 transition-colors leading-none px-1"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. @CSIS)"
          className="bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as OsintFeed["kind"])}
          className="bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-slate-500"
        >
          <option value="social">Social (X/Twitter)</option>
          <option value="telegram">Telegram</option>
          <option value="news">News</option>
          <option value="other">Other</option>
        </select>
        <input
          value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://rsshub.app/twitter/user/USERNAME"
          className="col-span-2 bg-slate-800/70 border border-slate-700/80 rounded-md px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-slate-500 font-mono"
        />
        <button
          onClick={add}
          disabled={!label.trim() || !url.trim() || value.length >= 20}
          className="col-span-2 text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-3 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40 disabled:bg-slate-800 disabled:text-slate-500"
        >
          Add Feed
        </button>
      </div>
    </div>
  );
}

// ─── AI control panel (toggles + spend) ──────────────────────────────────────

function formatUsd(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// Map a route name back to its human label, falling back to the raw route id
// if a new route name lands without a label entry.
const ROUTE_LABEL: Record<string, string> = Object.fromEntries(
  ALL_AI_FEATURES.map((f) => [f, AI_FEATURE_LABELS[f].label])
);

function AIControlPanel({
  aiEnabled, onAiEnabled, toggles, onToggles,
}: {
  aiEnabled: boolean;
  onAiEnabled: (v: boolean) => void;
  toggles: Partial<Record<AiFeature, boolean>>;
  onToggles: (v: Partial<Record<AiFeature, boolean>>) => void;
}) {
  const [usage, setUsage] = useState<{
    today: AiUsageSummary; last7: AiUsageSummary; last30: AiUsageSummary;
  } | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    fetch("/api/ai-usage")
      .then((r) => r.json())
      .then((d) => setUsage({ today: d.today, last7: d.last7, last30: d.last30 }))
      .catch(() => {});
  }, []);

  const setFeature = (feature: AiFeature, enabled: boolean) => {
    onToggles({ ...toggles, [feature]: enabled });
  };

  // Per-feature toggles are opt-out: missing key = enabled. Master switch
  // off greys out everything regardless of per-feature state.
  const featureEnabled = (f: AiFeature) =>
    aiEnabled && toggles[f] !== false;

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        AI Controls
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Disable Anthropic API calls per feature or globally. All features fall
        back to non-AI behaviour when off — no errors, just degraded output
        (snippets instead of summaries, etc).
      </p>

      {/* Master switch */}
      <div className={`rounded-lg border p-3 mb-3 ${
        aiEnabled ? "bg-emerald-500/10 border-emerald-500/40" : "bg-red-500/10 border-red-500/40"
      }`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onAiEnabled(!aiEnabled)}
            role="switch"
            aria-checked={aiEnabled}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
              aiEnabled ? "bg-emerald-500" : "bg-slate-700"
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              aiEnabled ? "translate-x-5" : "translate-x-0.5"
            }`} />
          </button>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-bold ${aiEnabled ? "text-emerald-300" : "text-red-300"}`}>
              {aiEnabled ? "AI features ENABLED" : "AI features DISABLED (all)"}
            </p>
            <p className="text-[10px] text-slate-500 font-mono leading-snug">
              Master kill switch. Off = no Anthropic API calls anywhere.
            </p>
          </div>
        </div>
      </div>

      {/* Per-feature toggles */}
      <ul className={`space-y-1 mb-3 ${aiEnabled ? "" : "opacity-50"}`}>
        {ALL_AI_FEATURES.map((f) => {
          const enabled = featureEnabled(f);
          const meta = AI_FEATURE_LABELS[f];
          return (
            <li key={f} className="flex items-center gap-2.5 py-1.5">
              <button
                onClick={() => setFeature(f, !(toggles[f] !== false))}
                disabled={!aiEnabled}
                role="switch"
                aria-checked={enabled}
                className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 disabled:cursor-not-allowed ${
                  enabled ? "bg-emerald-500" : "bg-slate-700"
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-200 leading-tight">{meta.label}</p>
                <p className="text-[10px] text-slate-600 font-mono leading-tight">{meta.sub}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Usage summary */}
      {usage && (
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Today's spend
            </p>
            <span className="text-[10px] text-slate-600 font-mono">
              {usage.today.totalCalls} call{usage.today.totalCalls === 1 ? "" : "s"}
            </span>
          </div>
          <p className={`text-2xl font-bold ${
            usage.today.totalMicros === 0 ? "text-slate-500" : "text-emerald-300"
          }`}>
            {formatUsd(usage.today.totalMicros)}
          </p>
          <div className="flex items-baseline justify-between gap-2 mt-1.5 pt-1.5 border-t border-slate-700/60 text-[10px] font-mono">
            <span className="text-slate-500">Last 7 days</span>
            <span className="text-slate-300">{formatUsd(usage.last7.totalMicros)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
            <span className="text-slate-500">Last 30 days</span>
            <span className="text-slate-300">{formatUsd(usage.last30.totalMicros)}</span>
          </div>

          {usage.today.byRoute.length > 0 && (
            <>
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                className="text-[10px] text-slate-500 hover:text-slate-300 font-mono mt-2 transition-colors"
              >
                {showBreakdown ? "▲ Hide" : "▼ Show"} today's breakdown
              </button>
              {showBreakdown && (
                <ul className="mt-2 space-y-0.5">
                  {usage.today.byRoute.map((r) => (
                    <li key={r.route} className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
                      <span className="text-slate-400 truncate">
                        {ROUTE_LABEL[r.route] ?? r.route}
                      </span>
                      <span className="text-slate-500 flex-shrink-0">
                        {formatUsd(r.micros)} · {r.calls}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Long-term memory panel ──────────────────────────────────────────────────

function MemoryPanel() {
  const [content, setContent] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    fetch("/api/user-memory")
      .then((r) => r.json())
      .then(({ memory }: { memory: { content: string; lastUpdated: string } }) => {
        setContent(memory?.content ?? "");
        setLastUpdated(memory?.lastUpdated ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [loaded]);

  const save = async () => {
    setBusy(true);
    try {
      await fetch("/api/user-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setLastUpdated(new Date().toISOString());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm("Clear all stored memory? This can't be undone.")) return;
    setBusy(true);
    try {
      await fetch("/api/user-memory", { method: "DELETE" });
      setContent("");
      setLastUpdated(null);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const fmtUpdated = lastUpdated && new Date(lastUpdated).getTime() > 0
    ? new Date(lastUpdated).toLocaleString()
    : "never";

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Long-term Memory
      </label>
      <p className="text-[10px] text-slate-600 mb-3">
        Auto-maintained from chat. The assistant remembers projects, upcoming events,
        people you mention, and ad-hoc notes — injected into every AI response.
        Last updated: <span className="font-mono">{fmtUpdated}</span>
      </p>

      {!editing ? (
        <>
          <div className="bg-slate-800/70 border border-slate-700/80 rounded-lg p-3 text-[11px] text-slate-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
            {content.trim() || (
              <span className="text-slate-600 italic">Memory is empty — chat a bit and it'll fill in.</span>
            )}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setEditing(true)}
              disabled={busy}
              className="flex-1 text-[11px] text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Edit
            </button>
            <button
              onClick={clear}
              disabled={busy || !content}
              className="flex-1 text-[11px] text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Clear all
            </button>
          </div>
        </>
      ) : (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="The assistant's memory of you — usually managed automatically. Edit if needed."
            className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg p-3 text-[11px] text-slate-200 placeholder-slate-600 resize-none outline-none focus:border-slate-500 transition-colors font-mono leading-relaxed"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 text-[11px] font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 px-2.5 py-1.5 rounded-md transition-all uppercase tracking-wider disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="flex-1 text-[11px] text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2.5 py-1.5 rounded-md transition-all font-mono disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── iCal subscription block ──────────────────────────────────────────────────

function CalendarSubscription() {
  const [copied, setCopied] = useState(false);
  // Built from window.location so it always reflects the current host.
  const httpsUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/calendar/ical`
    : "/api/calendar/ical";
  const webcalUrl = typeof window !== "undefined"
    ? `webcal://${window.location.host}/api/calendar/ical`
    : "";

  const copy = async () => {
    try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable */ }
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
        Apple Calendar / iCal Feed
      </label>
      <p className="text-[10px] text-slate-600 mb-2">
        Subscribe to your upcoming events in any iCal-compatible app (Apple Calendar, iOS, Outlook).
        The feed is session-authenticated — copy the URL while signed in.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-slate-800/70 border border-slate-700/80 rounded-md px-3 py-2 text-[11px] text-slate-300 font-mono truncate" title={httpsUrl}>
          {httpsUrl}
        </code>
        <button
          onClick={copy}
          className="flex-shrink-0 text-[11px] text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2.5 py-1.5 rounded-md transition-all font-mono"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {webcalUrl && (
          <a
            href={webcalUrl}
            className="flex-shrink-0 text-[11px] text-emerald-500 hover:text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/60 px-2.5 py-1.5 rounded-md transition-all font-mono"
          >
            Open in Apple Calendar
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Theme selector ───────────────────────────────────────────────────────────

const THEMES: {
  id: AppTheme;
  name: string;
  desc: string;
  bg: string;
  surface: string;
  accent: string;
  accentLabel: string;
}[] = [
  {
    id: "nightwatch",
    name: "Nightwatch",
    desc: "Deep slate / emerald",
    bg: "#020617",
    surface: "#0f172a",
    accent: "#10b981",
    accentLabel: "emerald",
  },
  {
    id: "amber",
    name: "Amber",
    desc: "Tactical terminal / phosphor",
    bg: "#0c0800",
    surface: "#160f00",
    accent: "#f59e0b",
    accentLabel: "amber",
  },
  {
    id: "arctic",
    name: "Arctic",
    desc: "Midnight navy / ice-blue",
    bg: "#03091a",
    surface: "#07112a",
    accent: "#0ea5e9",
    accentLabel: "sky",
  },
  {
    id: "mission",
    name: "Mission Brief",
    desc: "Parchment / aviation blue",
    bg: "#f5f4f0",
    surface: "#ffffff",
    accent: "#185FA5",
    accentLabel: "blue",
  },
];

function ThemeSelector({
  value,
  onChange,
}: {
  value: AppTheme;
  onChange: (t: AppTheme) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {THEMES.map((theme) => {
        const active = value === theme.id;
        return (
          <button
            key={theme.id}
            onClick={() => onChange(theme.id)}
            className={`flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all ${
              active ? "border-emerald-500/60 shadow-[0_0_14px_-2px_var(--glow-accent)]" : "border-slate-700/60 hover:border-slate-600/80"
            }`}
            title={theme.name}
          >
            {/* Mini preview */}
            <div
              className="h-14 w-full relative"
              style={{ backgroundColor: theme.bg }}
            >
              {/* Simulated card */}
              <div
                className="absolute inset-x-2 top-2 bottom-2 rounded-md flex flex-col justify-between p-1.5"
                style={{ backgroundColor: theme.surface, border: `1px solid ${theme.accent}22` }}
              >
                <div className="flex gap-1 items-center">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.accent }} />
                  <div className="h-1 rounded-full flex-1" style={{ backgroundColor: `${theme.accent}40` }} />
                </div>
                <div className="space-y-0.5">
                  <div className="h-0.5 rounded-full w-3/4" style={{ backgroundColor: `${theme.accent}60` }} />
                  <div className="h-0.5 rounded-full w-1/2" style={{ backgroundColor: `${theme.accent}30` }} />
                </div>
              </div>
              {active && (
                <div
                  className="absolute top-1 right-1 w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold"
                  style={{ backgroundColor: theme.accent, color: theme.bg }}
                >
                  ✓
                </div>
              )}
            </div>
            {/* Label */}
            <div className="px-2 py-1.5 bg-slate-800/40">
              <p className={`text-[10px] font-bold font-mono ${active ? "text-slate-100" : "text-slate-400"}`}>
                {theme.name}
              </p>
              <p className="text-[9px] text-slate-600 leading-tight">{theme.desc}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Preset locations — value = localFeedKey, lat/lon used by weather tab
const LOCAL_FEED_OPTIONS: { value: string; label: string; lat: number; lon: number }[] = [
  { value: "colorado",      label: "Colorado — Front Range / CSFS",         lat: 38.85, lon: -104.80 },
  { value: "dc",            label: "DC Metro — National Capital Region",     lat: 38.90, lon: -77.03  },
  { value: "hampton_roads", label: "Hampton Roads — Tidewater VA",           lat: 36.85, lon: -76.29  },
  { value: "illinois",      label: "Illinois — Chicago / Scott AFB",         lat: 41.88, lon: -87.63  },
  { value: "new_jersey",    label: "New Jersey — JB McGuire-Dix-Lakehurst", lat: 40.01, lon: -74.59  },
  { value: "oklahoma",      label: "Oklahoma — OKC / Altus AFB",             lat: 35.47, lon: -97.38  },
  { value: "san_antonio",   label: "San Antonio — Joint Base SA",            lat: 29.42, lon: -98.49  },
  { value: "hawaii",        label: "Hawaii — Oahu / Joint Base PHH",         lat: 21.30, lon: -157.85 },
  { value: "japan",         label: "Japan / Pacific — Okinawa (Kadena)",     lat: 26.33, lon:  127.80 },
  { value: "germany",       label: "Germany / Europe — Ramstein Area",       lat: 49.43, lon:    7.60 },
];

const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/New_York",    label: "Eastern (ET)" },
  { value: "America/Chicago",     label: "Central (CT)" },
  { value: "America/Denver",      label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage",   label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HST)" },
  { value: "Asia/Tokyo",          label: "Japan (JST)" },
  { value: "Europe/Berlin",       label: "Germany (CET/CEST)" },
  { value: "UTC",                 label: "UTC" },
];

export default function PreferencesDrawer({ open, onClose, onSaved }: PreferencesDrawerProps) {
  const { data: session } = useSession();
  const primaryEmail = session?.user?.email ?? null;

  const [role, setRole] = useState("");
  const [priorityTopics, setPriorityTopics] = useState<string[]>([]);
  const [deprioritizeTopics, setDeprioritizeTopics] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [vipSenders, setVipSenders] = useState<string[]>([]);
  const [muteSenders, setMuteSenders] = useState<string[]>([]);
  const [trackedLocations, setTrackedLocations] = useState<TrackedLocation[]>([]);
  const [marketsWatchlist, setMarketsWatchlist] = useState<TickerEntry[]>([]);
  const [osintFeeds, setOsintFeeds] = useState<OsintFeed[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiFeatureToggles, setAiFeatureToggles] = useState<Partial<Record<AiFeature, boolean>>>({});
  const [localFeedKey, setLocalFeedKey] = useState("colorado");
  const [localLat, setLocalLat] = useState<number | null>(null);
  const [localLon, setLocalLon] = useState<number | null>(null);
  const [theme, setTheme] = useState<AppTheme>("nightwatch");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [secondaryConnected, setSecondaryConnected] = useState(false);
  const [secondaryEmail, setSecondaryEmail] = useState<string | null>(null);
  const [secondaryRevoking, setSecondaryRevoking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }: { prefs: UserPrefs }) => {
        setRole(prefs.role ?? "");
        setPriorityTopics(prefs.priorityTopics ?? []);
        setDeprioritizeTopics(prefs.deprioritizeTopics ?? []);
        setWatchlist(prefs.watchlist ?? []);
        setVipSenders(prefs.vipSenders ?? []);
        setMuteSenders(prefs.muteSenders ?? []);
        setTrackedLocations(prefs.trackedLocations ?? []);
        setMarketsWatchlist(prefs.marketsWatchlist ?? []);
        setOsintFeeds(prefs.osintFeeds ?? []);
        setAiEnabled(prefs.aiEnabled !== false);
        setAiFeatureToggles(prefs.aiFeatureToggles ?? {});
        setLocalFeedKey(prefs.localFeedKey ?? "colorado");
        setLocalLat(prefs.localLat ?? null);
        setLocalLon(prefs.localLon ?? null);
        setTheme(prefs.theme ?? "nightwatch");
        setTimezone(prefs.timezone ?? "America/Chicago");
        setLoaded(true);
      })
      .catch(() => {});
  }, [open, loaded]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/auth/gmail-secondary?step=status")
      .then((r) => r.json())
      .then((d: { connected: boolean; email?: string }) => {
        setSecondaryConnected(d.connected);
        setSecondaryEmail(d.email ?? null);
      })
      .catch(() => {});
  }, [open]);

  const revokeSecondary = async () => {
    setSecondaryRevoking(true);
    await fetch("/api/auth/gmail-secondary?step=revoke", { method: "POST" }).catch(() => {});
    setSecondaryConnected(false);
    setSecondaryEmail(null);
    setSecondaryRevoking(false);
  };

  const handleThemeChange = (t: AppTheme) => {
    setTheme(t);
    applyTheme(t); // instant live preview
  };

  const handleLocationChange = (key: string) => {
    setLocalFeedKey(key);
    const opt = LOCAL_FEED_OPTIONS.find((o) => o.value === key);
    if (opt) { setLocalLat(opt.lat); setLocalLon(opt.lon); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/user-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role, priorityTopics, deprioritizeTopics, watchlist,
          vipSenders, muteSenders,
          trackedLocations, marketsWatchlist, osintFeeds,
          aiEnabled, aiFeatureToggles,
          localFeedKey,
          localZipcode: "", localCity: "",
          localLat, localLon,
          theme, timezone,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
      onClose();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full max-w-sm bg-slate-950 border-l border-slate-800 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
              <span className="text-slate-400 text-sm">⚙</span>
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-200">Preferences</h2>
              <p className="text-[9px] text-slate-600 font-mono">Personalises all AI responses</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <a
              href="/user-guide.html"
              target="_blank"
              rel="noopener noreferrer"
              title="Open the user guide in a new tab"
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/40 px-2 py-1 rounded-md transition-all"
            >
              <span className="text-sm leading-none">?</span>
              <span className="hidden sm:inline">Guide</span>
            </a>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">

          {/* Accounts */}
          <div className="mb-5">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
              Accounts
            </label>

            {/* Primary */}
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3 mb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-none mb-0.5">Primary</p>
                    <p className="text-xs text-slate-300 truncate">{primaryEmail ?? "—"}</p>
                  </div>
                </div>
                <button
                  onClick={() => signOut()}
                  className="flex-shrink-0 text-[11px] text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-2.5 py-1 rounded-lg transition-all font-mono"
                >
                  Sign out
                </button>
              </div>
            </div>

            {/* Secondary */}
            <div className="bg-slate-800/50 border border-slate-700/60 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${secondaryConnected ? "bg-blue-400" : "bg-slate-700"}`} />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 leading-none mb-0.5">Secondary</p>
                    <p className="text-xs text-slate-300 truncate">
                      {secondaryConnected && secondaryEmail ? secondaryEmail : "Not connected"}
                    </p>
                  </div>
                </div>
                {secondaryConnected ? (
                  <button
                    onClick={revokeSecondary}
                    disabled={secondaryRevoking}
                    className="flex-shrink-0 text-[11px] text-slate-500 hover:text-red-400 border border-slate-700 hover:border-red-500/50 px-2.5 py-1 rounded-lg transition-all font-mono disabled:opacity-40"
                  >
                    {secondaryRevoking ? "Removing…" : "Remove"}
                  </button>
                ) : (
                  <a
                    href="/api/auth/gmail-secondary?step=initiate"
                    className="flex-shrink-0 text-[11px] text-emerald-500 hover:text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/60 px-2.5 py-1 rounded-lg transition-all font-mono"
                  >
                    Connect
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 my-5" />

          {/* Calendar subscription (iCal feed) */}
          <CalendarSubscription />

          <div className="border-t border-slate-800 my-5" />

            {/* Theme */}
          <div className="mb-5">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
              Appearance
            </label>
            <p className="text-[10px] text-slate-600 mb-3">
              Theme previews update instantly
            </p>
            <ThemeSelector value={theme} onChange={handleThemeChange} />
          </div>

          <div className="border-t border-slate-800 my-5" />

          {/* Role */}
          <div className="mb-5">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
              Role / Context
            </label>
            <p className="text-[10px] text-slate-600 mb-2">
              Tailors all AI analysis, briefs, and chat responses to your role
            </p>
            <textarea
              value={role}
              onChange={(e) => setRole(e.target.value)}
              rows={3}
              placeholder="e.g. Defense policy analyst focused on Indo-Pacific affairs"
              className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg p-3 text-xs text-slate-200 placeholder-slate-600 resize-none outline-none focus:border-slate-500 transition-colors leading-relaxed"
            />
          </div>

          <div className="border-t border-slate-800 my-5" />

          <TagInput
            label="Priority Topics"
            description="These topics get surfaced first in briefings and analysis"
            tags={priorityTopics}
            onChange={setPriorityTopics}
            placeholder="China, Space Force, nuclear policy…"
            accent="emerald"
          />

          <TagInput
            label="Deprioritise Topics"
            description="Less emphasis in AI responses"
            tags={deprioritizeTopics}
            onChange={setDeprioritizeTopics}
            placeholder="domestic politics, sports…"
            accent="red"
          />

          <div className="border-t border-slate-800 my-5" />

          {/* Local Area */}
          <div className="mb-5">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
              Local Area
            </label>
            <p className="text-[10px] text-slate-600 mb-2">
              Selects local news feeds and sets the weather map home location
            </p>
            <select
              value={localFeedKey}
              onChange={(e) => handleLocationChange(e.target.value)}
              className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-slate-500 transition-colors"
            >
              {LOCAL_FEED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="border-t border-slate-800 my-5" />

          {/* Timezone */}
          <div className="mb-5">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
              Timezone
            </label>
            <p className="text-[10px] text-slate-600 mb-2">
              Used by the AI assistant when adding calendar events
            </p>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-slate-500 transition-colors"
            >
              {TIMEZONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label} — {opt.value}</option>
              ))}
            </select>
          </div>

          <div className="border-t border-slate-800 my-5" />

          <TagInput
            label="Watchlist — Keyword Alerts"
            description="Articles and newsletter bullets matching these terms get an ⚑ badge and appear first"
            tags={watchlist}
            onChange={setWatchlist}
            placeholder="hypersonic, AUKUS, INDOPACOM…"
            accent="orange"
          />

          <div className="border-t border-slate-800 my-5" />

          <div className="mb-1">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
              Email Triage Overrides
            </label>
            <p className="text-[10px] text-slate-600 mb-3">
              Force a sender to High or Low priority — bypasses the AI classifier.
              Use a full address (jane@example.com) or a bare domain (example.com,
              also matches subdomains).
            </p>
          </div>

          <TagInput
            label="Always High — VIP Senders"
            description="Inbound mail from these senders is always treated as High priority"
            tags={vipSenders}
            onChange={setVipSenders}
            placeholder="boss@company.com, whitehouse.gov…"
            accent="emerald"
          />

          <TagInput
            label="Always Low — Muted Senders"
            description="Inbound mail from these senders is always pushed to Low (still shown, just demoted)"
            tags={muteSenders}
            onChange={setMuteSenders}
            placeholder="noreply@marketing.com, mailchimp.com…"
            accent="red"
          />

          <div className="border-t border-slate-800 my-5" />

          <TrackedLocationsEditor value={trackedLocations} onChange={setTrackedLocations} />

          <div className="border-t border-slate-800 my-5" />

          <MarketsWatchlistEditor value={marketsWatchlist} onChange={setMarketsWatchlist} />

          <div className="border-t border-slate-800 my-5" />

          <OsintFeedsEditor value={osintFeeds} onChange={setOsintFeeds} />

          <div className="border-t border-slate-800 my-5" />

          <AIControlPanel
            aiEnabled={aiEnabled}
            onAiEnabled={setAiEnabled}
            toggles={aiFeatureToggles}
            onToggles={setAiFeatureToggles}
          />

          <div className="border-t border-slate-800 my-5" />

          <MemoryPanel />
        </div>

        {/* Save footer */}
        <div className="px-5 py-4 border-t border-slate-800 bg-slate-950">
          <button
            onClick={save}
            disabled={saving}
            className={`w-full flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest py-2.5 rounded-lg transition-all ${
              saved
                ? "bg-emerald-600 text-white"
                : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 glow-green"
            } disabled:opacity-50`}
          >
            {saved ? "✓ Saved" : saving ? "Saving…" : "Save Preferences"}
          </button>
        </div>
      </div>
    </>
  );
}
