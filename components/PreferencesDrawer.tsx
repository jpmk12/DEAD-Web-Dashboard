"use client";

import { useEffect, useState, KeyboardEvent } from "react";
import { useSession, signOut } from "next-auth/react";
import { UserPrefs, AppTheme } from "@/lib/types";
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
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all text-lg leading-none"
          >
            ×
          </button>
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
