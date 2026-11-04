"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useSession, signOut } from "next-auth/react";
import { CloseIcon } from "@/lib/icons";
import { UserPrefs, AppTheme, NewsletterSourceRule, AiFeature } from "@/lib/types";
import { ALL_AI_FEATURES } from "@/lib/aiFeatures";
import { secondaryStartAnchorProps } from "@/lib/secondaryStartLink";
import { allKnownNewsSources } from "@/lib/newsSources";
import { clientCache } from "@/lib/clientCache";
import { applyTheme } from "@/components/ThemeApplicator";
import MissionProfileEditor from "@/components/preferences/MissionProfileEditor";
import TrackingPanel from "@/components/preferences/TrackingPanel";
import CalendarSubscription from "@/components/calendar/CalendarSubscription";
import TagInput from "@/components/preferences/TagInput";
import NewsletterSourcesEditor from "@/components/preferences/NewsletterSourcesEditor";
import NewsSourcesEditor from "@/components/preferences/NewsSourcesEditor";
import AIControlPanel from "@/components/preferences/AIControlPanel";
import MemoryPanel from "@/components/preferences/MemoryPanel";
import ThemeSelector from "@/components/preferences/ThemeSelector";
import HomeLocationEditor from "@/components/preferences/HomeLocationEditor";
import AcledCredentialsEditor from "@/components/preferences/AcledCredentialsEditor";
import TripsEditor from "@/components/preferences/TripsEditor";
import { LOCAL_FEED_OPTIONS, TIMEZONE_OPTIONS } from "@/components/preferences/prefsOptions";

// The editors live one per file in components/preferences/ (split
// 2026-11-04); this file is the drawer shell — sections, rail, save.

interface PreferencesDrawerProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function PreferencesDrawer({ open, onClose, onSaved }: PreferencesDrawerProps) {
  const { data: session } = useSession();
  const primaryEmail = session?.user?.email ?? null;

  const [role, setRole] = useState("");
  const [priorityTopics, setPriorityTopics] = useState<string[]>([]);
  const [deprioritizeTopics, setDeprioritizeTopics] = useState<string[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [vipSenders, setVipSenders] = useState<string[]>([]);
  const [muteSenders, setMuteSenders] = useState<string[]>([]);
  // Tracked places, the markets watchlist and the OSINT feeds are no longer
  // edited here (REVIEW-2026-10 §12): places on the Weather tab / Mission →
  // What you track, feeds on OSINT → Sources; the markets watchlist had no
  // consumer left. The full save omits them and the route preserves them.
  const [newsletterSources, setNewsletterSources] = useState<NewsletterSourceRule[]>([]);
  const [disabledNewsSources, setDisabledNewsSources] = useState<string[]>([]);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiFeatureToggles, setAiFeatureToggles] = useState<Partial<Record<AiFeature, boolean>>>({});
  const [localFeedKey, setLocalFeedKey] = useState("colorado");
  const [localLat, setLocalLat] = useState<number | null>(null);
  const [localLon, setLocalLon] = useState<number | null>(null);
  // Non-empty = a precise custom home the user entered (its display label).
  // Empty = home falls back to the local-news region preset's coords.
  const [localCity, setLocalCity] = useState("");
  const [theme, setTheme] = useState<AppTheme>("nightwatch");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [timezoneMode, setTimezoneMode] = useState<"auto" | "pinned">("auto");
  // The device's current IANA zone — shown as the live "Auto" value. Computed
  // once on mount (it can't change without a reload).
  const [deviceTz] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
    catch { return "UTC"; }
  });
  const [secondaryConnected, setSecondaryConnected] = useState(false);
  const [secondaryEmail, setSecondaryEmail] = useState<string | null>(null);
  const [secondaryRevoking, setSecondaryRevoking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Sectioned settings: ONE section is shown at a time, chosen from a left
  // rail (desktop) or the pill row (phone), and the choice is URL-addressable
  // as `?prefs=<key>` so a recommendation card, the palette, or a pasted link
  // can land on the exact setting. This replaced the six-collapsible flat
  // scroll: the last-open section is remembered per browser; the URL wins
  // over memory when present.
  type GroupKey = "mission" | "you" | "connections" | "email" | "sources" | "ai";
  const GROUP_KEYS: GroupKey[] = ["mission", "you", "connections", "email", "sources", "ai"];
  const isGroupKey = (v: unknown): v is GroupKey => typeof v === "string" && (GROUP_KEYS as string[]).includes(v);
  const [activeGroup, setActiveGroup] = useState<GroupKey>("you");
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("prefs");
      if (isGroupKey(fromUrl)) { setActiveGroup(fromUrl); return; }
      const remembered = localStorage.getItem("prefs-active-group");
      if (isGroupKey(remembered)) setActiveGroup(remembered);
    } catch { /* defaults */ }
  }, []);
  const writeUrl = (k: GroupKey | null) => {
    try {
      const url = new URL(window.location.href);
      if (k) url.searchParams.set("prefs", k); else url.searchParams.delete("prefs");
      window.history.replaceState(window.history.state, "", url.toString());
    } catch { /* noop */ }
  };
  const selectGroup = (k: GroupKey) => {
    setActiveGroup(k);
    try { localStorage.setItem("prefs-active-group", k); } catch { /* noop */ }
    writeUrl(k);
    setTimeout(() => {
      const el = document.getElementById(`prefs-group-${k}`);
      if (el) el.scrollIntoView({ block: "start" });
    }, 40);
  };
  // The URL carries the section only while the drawer is open.
  useEffect(() => { if (open) writeUrl(activeGroup); else writeUrl(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  // Derived view of the old collapsible model so the section markup below
  // (carets, pills, gates) keeps working: exactly one group is "open".
  const openGroups = Object.fromEntries(GROUP_KEYS.map((k) => [k, k === activeGroup])) as Record<GroupKey, boolean>;
  const toggleGroup = (k: GroupKey) => selectGroup(k);
  const openAndScrollTo = (k: GroupKey) => selectGroup(k);
  // `prefs:focus-group` (detail = group key) — the shell dispatches this just
  // after opening the drawer so the command palette can land on a section.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const k = (e as CustomEvent<string>).detail;
      if (k === "mission" || k === "you" || k === "connections" || k === "email" || k === "sources" || k === "ai") openAndScrollTo(k);
    };
    window.addEventListener("prefs:focus-group", onFocus);
    return () => window.removeEventListener("prefs:focus-group", onFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const GROUPS: { key: GroupKey; label: string }[] = [
    { key: "mission",     label: "Mission Profile" },
    { key: "you",         label: "You" },
    { key: "connections", label: "Connections & appearance" },
    { key: "email",       label: "Email rules" },
    { key: "sources",     label: "Content sources" },
    { key: "ai",          label: "AI & memory" },
  ];

  // Live-state summaries shown next to each group label. Returns
  // ReactNode (not just a string) so warnings — stale feeds, master AI
  // off — can render in amber to draw attention from the collapsed header.
  // All values derive from existing form state plus the two parent-level
  // fetches above (feedStaleCount, aiSpendTodayMicros); no extra requests.
  const groupSubtitle = (key: GroupKey) => {
    if (key === "mission") {
      return "declare your AO — the app derives the tracking";
    }
    if (key === "you") {
      const parts: string[] = [];
      if (role.trim()) parts.push("role set");
      if (priorityTopics.length) parts.push(`${priorityTopics.length} priority`);
      if (deprioritizeTopics.length) parts.push(`${deprioritizeTopics.length} deprio`);
      if (watchlist.length) parts.push(`${watchlist.length} watch`);
      return parts.length ? parts.join(" · ") : "Not configured yet";
    }
    if (key === "connections") {
      const parts: string[] = [];
      parts.push(primaryEmail ? "Primary linked" : "No primary");
      parts.push(secondaryConnected ? "Secondary linked" : "No secondary");
      parts.push(`${theme} theme`);
      return parts.join(" · ");
    }
    if (key === "email") {
      const parts: string[] = [];
      if (vipSenders.length) parts.push(`${vipSenders.length} VIP`);
      if (muteSenders.length) parts.push(`${muteSenders.length} muted`);
      return parts.length ? parts.join(" · ") : "No overrides";
    }
    if (key === "sources") {
      const parts: (string | ReactElement)[] = [];
      // News-source count: total enabled, with a muted "(N off)" only when
      // any are disabled — keeps the header quiet for the default state.
      const totalNews = allKnownNewsSources().length;
      const enabledNews = totalNews - disabledNewsSources.length;
      if (disabledNewsSources.length > 0) {
        parts.push(
          <span key="news">
            {enabledNews}/{totalNews} news{" "}
            <span className="text-amber-400">({disabledNewsSources.length} off)</span>
          </span>
        );
      } else {
        parts.push(`${totalNews} news`);
      }
      if (parts.length === 0) return "No sources configured";
      // Join string parts with " · " and React elements with separators.
      return parts.flatMap((p, i) => i === 0 ? [p] : [" · ", p]);
    }
    if (key === "ai") {
      const totalFeatures = ALL_AI_FEATURES.length;
      const enabledCount = ALL_AI_FEATURES.filter((f) => aiFeatureToggles[f] !== false).length;
      const dollars = aiSpendTodayMicros !== null ? `$${(aiSpendTodayMicros / 1_000_000).toFixed(2)} today` : null;
      if (!aiEnabled) {
        return (
          <>
            <span className="text-amber-400 font-bold">Master OFF</span>
            {dollars && <> · {dollars}</>}
          </>
        );
      }
      const parts: string[] = [`${enabledCount}/${totalFeatures} features on`];
      if (dollars) parts.push(dollars);
      return parts.join(" · ");
    }
    return "";
  };

  // Re-read the stored row on EVERY open — the drawer used to load once per
  // session and then save its stale copy of every list over edits made
  // elsewhere (a Track from the map, a SITREP add, an Apply).
  useEffect(() => {
    if (!open) return;
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }: { prefs: UserPrefs }) => {
        setRole(prefs.role ?? "");
        setPriorityTopics(prefs.priorityTopics ?? []);
        setDeprioritizeTopics(prefs.deprioritizeTopics ?? []);
        setWatchlist(prefs.watchlist ?? []);
        setVipSenders(prefs.vipSenders ?? []);
        setMuteSenders(prefs.muteSenders ?? []);
        setNewsletterSources(prefs.newsletterSources ?? []);
        setDisabledNewsSources(prefs.disabledNewsSources ?? []);
        setAiEnabled(prefs.aiEnabled !== false);
        setAiFeatureToggles(prefs.aiFeatureToggles ?? {});
        setLocalFeedKey(prefs.localFeedKey ?? "colorado");
        setLocalLat(prefs.localLat ?? null);
        setLocalLon(prefs.localLon ?? null);
        setLocalCity(prefs.localCity ?? "");
        setTheme(prefs.theme ?? "nightwatch");
        setTimezone(prefs.timezone ?? "America/Chicago");
        setTimezoneMode(prefs.timezoneMode === "pinned" ? "pinned" : "auto");
        setLoaded(true);
      })
      .catch(() => {});
  }, [open]);

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

  // Stats feeders for the group headers. OSINT feed-health and AI today's
  // spend both already have child components that fetch them, but those
  // values live in child state — we re-fetch at the parent level so the
  // collapsed headers can show stale-count and dollars-today without
  // requiring the user to expand the group. Cache means the actual HTTP
  // cost is shared with the child.
  const [aiSpendTodayMicros, setAiSpendTodayMicros] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    fetch("/api/ai-usage")
      .then((r) => r.json())
      .then((d) => {
        const micros = d?.today?.totalMicros;
        setAiSpendTodayMicros(typeof micros === "number" ? micros : null);
      })
      .catch(() => setAiSpendTodayMicros(null));
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
    // Snap home to the region's coords ONLY when no custom home is set — otherwise
    // changing the local-news region would wipe out a precise home the user entered.
    if (opt && !localCity.trim()) { setLocalLat(opt.lat); setLocalLon(opt.lon); }
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
          // Force posture / countries / METAR are edited through /api/track
          // (Preferences → Mission → What you track); absent here = preserved.
          // trackedLocations is deliberately NOT sent: the Track command writes it
          // while the drawer is open and the route preserves an absent list
          // (code review 2026-10-07 — Save used to delete a just-tracked place).
          newsletterSources,
          disabledNewsSources,
          aiEnabled, aiFeatureToggles,
          localFeedKey,
          localCity,
          localLat, localLon,
          theme, timezone, timezoneMode,
        }),
      });
      // Wipe the client-side data caches so derived views (email priorities
      // from VIP/mute rules, news sort from topics/watchlist, briefing
      // from role) re-fetch on next visit. Without this, the 10-minute
      // EmailTab cache happily serves stale priorities and a new VIP
      // entry silently doesn't apply until the cache expires.
      clientCache.clear();
      // Fire a custom event so prefetchers (digest, briefing) re-prime
      // immediately. Without this, the digest modal cold-fetches on next
      // open because nothing re-runs the prefetch after the clear.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("dashboard-cache-cleared"));
        // Nudge the Force Protection board (Crisis tab) to re-fetch with the
        // updated watched locations without a full reload.
        window.dispatchEvent(new CustomEvent("force-locations:changed"));
      }
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
      <div className="fixed top-0 right-0 h-full w-full max-w-md lg:max-w-3xl bg-slate-950 border-l border-slate-800 z-50 flex flex-col shadow-2xl">
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
              aria-label="Close"
              className="w-7 h-7 rounded-md inline-flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>

        {/* Section selector — pill row on phones (the rail below is desktop).
            One section shows at a time; the selection is in the URL. */}
        <div className="lg:hidden flex-shrink-0 border-b border-slate-800 bg-slate-950 px-5 py-2 flex items-center gap-1 overflow-x-auto">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => selectGroup(g.key)}
              aria-current={openGroups[g.key] ? "page" : undefined}
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-all border flex-shrink-0 ${
                openGroups[g.key]
                  ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                  : "border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex">
        {/* Desktop rail — the settings index, with each section's live
            one-line summary so a problem (stale feeds, AI off) is visible
            before the section is opened. */}
        <nav aria-label="Settings sections" className="hidden lg:flex flex-col w-[220px] flex-shrink-0 border-r border-slate-800 bg-slate-950 py-3 overflow-y-auto">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => selectGroup(g.key)}
              aria-current={openGroups[g.key] ? "page" : undefined}
              className={`text-left px-4 py-2.5 border-l-2 transition-colors ${
                openGroups[g.key]
                  ? "border-l-emerald-400 bg-emerald-500/[0.07]"
                  : "border-l-transparent hover:bg-slate-900"
              }`}
            >
              <span className={`block text-[11px] font-bold uppercase tracking-wider ${openGroups[g.key] ? "text-emerald-300" : "text-slate-300"}`}>{g.label}</span>
              <span className="block text-[10px] text-slate-600 truncate mt-0.5">{groupSubtitle(g.key)}</span>
            </button>
          ))}
          <p className="mt-auto px-4 pt-3 text-[9px] text-slate-500 font-mono">?prefs={activeGroup}</p>
        </nav>

        {/* Content — one section at a time; the section forms are unchanged,
            only their visibility is driven by the selector. */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          {/* ─── Mission Profile ─────────────────────────────────── */}
          <section id="prefs-group-mission" className={`border border-slate-800 rounded-lg overflow-hidden ${activeGroup === "mission" ? "" : "hidden"}`}>
            <button
              type="button"
              onClick={() => toggleGroup("mission")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">Mission Profile</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("mission")}</span>
            </button>
            {openGroups.mission && (
              <div className="px-4 py-4 border-t border-slate-800">
                <TrackingPanel />
                <MissionProfileEditor />
                <p className="mt-4 text-[10px] text-slate-500">Crew counts (team state) are kept on <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("app:navigate", { detail: "glance" })); onClose(); }} className="text-emerald-400 hover:underline">Glance → Demand horizon → Crews</button>, next to the posture line they feed.</p>
              </div>
            )}
          </section>

          {/* ─── You ─────────────────────────────────────────────── */}
          <section id="prefs-group-you" className={`border border-slate-800 rounded-lg overflow-hidden ${activeGroup === "you" ? "" : "hidden"}`}>
            <button
              type="button"
              onClick={() => toggleGroup("you")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">You</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("you")}</span>
            </button>
            {openGroups.you && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <div>
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

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Home Location
                  </label>
                  <p className="text-[10px] text-slate-600 mb-2">
                    Where YOU live — drives the Weather tab home card, the Morning Brief&apos;s home
                    forecast, local news, and the map center. Your hub/spoke AIRFIELDS are separate:
                    declare those in Mission Profile (they get posture, METAR, and SITREP treatment,
                    not forecast cards). Search an address, city, or ZIP for a precise point.
                  </p>
                  <HomeLocationEditor
                    feedKey={localFeedKey}
                    city={localCity}
                    lat={localLat}
                    lon={localLon}
                    onSetCustom={(label, la, lo) => { setLocalCity(label); setLocalLat(la); setLocalLon(lo); }}
                    onClearCustom={() => {
                      const opt = LOCAL_FEED_OPTIONS.find((o) => o.value === localFeedKey);
                      setLocalCity("");
                      setLocalLat(opt?.lat ?? null);
                      setLocalLon(opt?.lon ?? null);
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Local News Region
                  </label>
                  <p className="text-[10px] text-slate-600 mb-2">
                    Which regional feeds appear in your local news mix. Also the default home location
                    when you haven&apos;t set a precise one above.
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

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Timezone
                  </label>
                  <p className="text-[10px] text-slate-600 mb-2">
                    Sets &ldquo;today&rdquo;, schedule labels, and travel weather in your morning brief
                  </p>

                  {/* Mode toggle: Auto (follow this device) vs Pin a fixed zone */}
                  <div className="flex gap-1.5 bg-slate-900/70 border border-slate-700/70 rounded-lg p-1 mb-2">
                    <button
                      type="button"
                      onClick={() => setTimezoneMode("auto")}
                      className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-md transition-colors ${
                        timezoneMode === "auto"
                          ? "bg-slate-700 text-slate-100 shadow"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          timezoneMode === "auto" ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" : "bg-slate-600"
                        }`}
                      />
                      Auto (this device)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTimezoneMode("pinned")}
                      className={`flex-1 text-xs font-semibold px-2.5 py-2 rounded-md transition-colors ${
                        timezoneMode === "pinned"
                          ? "bg-slate-700 text-slate-100 shadow"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Pin a timezone
                    </button>
                  </div>

                  {timezoneMode === "auto" ? (
                    <>
                      <div className="flex items-center gap-2.5 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-100 truncate">{deviceTz}</div>
                          <div className="text-[10px] text-emerald-300">detected from this device</div>
                        </div>
                        <span className="ml-auto text-[9px] uppercase tracking-widest text-emerald-300 border border-emerald-400/40 rounded-full px-2 py-0.5">
                          Live
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-2">
                        Open the dashboard on a device in another zone and the brief follows it automatically.
                      </p>
                    </>
                  ) : (
                    <>
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full bg-slate-800/70 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-slate-500 transition-colors"
                      >
                        {TIMEZONE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label} — {opt.value}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-600 mt-2">
                        Every device shows this zone&rsquo;s &ldquo;today,&rdquo; even if its clock is set elsewhere.
                      </p>
                    </>
                  )}
                </div>

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

                <TagInput
                  label="Watchlist — Keyword Alerts"
                  description="Articles, newsletter bullets, OSINT items, aircraft callsigns, and ship names matching these terms get an ⚑ badge and appear first"
                  tags={watchlist}
                  onChange={setWatchlist}
                  placeholder="hypersonic, AUKUS, INDOPACOM, REACH…"
                  accent="orange"
                />

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Alerts on this device</label>
                  <p className="text-[10px] text-slate-500">Push alerts are set up on <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("app:navigate", { detail: "glance" })); onClose(); }} className="text-emerald-400 hover:underline">Glance → Alerts on this device</button>, under the status row.</p>
                </div>
              </div>
            )}
          </section>

          {/* ─── Connections & appearance ─────────────────────────── */}
          <section id="prefs-group-connections" className={`border border-slate-800 rounded-lg overflow-hidden ${activeGroup === "connections" ? "" : "hidden"}`}>
            <button
              type="button"
              onClick={() => toggleGroup("connections")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">Connections & appearance</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("connections")}</span>
            </button>
            {openGroups.connections && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
                    Accounts
                  </label>
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
                          {...secondaryStartAnchorProps()}
                          className="flex-shrink-0 text-[11px] text-emerald-500 hover:text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/60 px-2.5 py-1 rounded-lg transition-all font-mono"
                        >
                          Connect
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <CalendarSubscription />

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Appearance
                  </label>
                  <p className="text-[10px] text-slate-600 mb-3">
                    Theme previews update instantly
                  </p>
                  <ThemeSelector value={theme} onChange={handleThemeChange} />
                </div>
              </div>
            )}
          </section>

          {/* ─── Email rules ──────────────────────────────────────── */}
          <section id="prefs-group-email" className={`border border-slate-800 rounded-lg overflow-hidden ${activeGroup === "email" ? "" : "hidden"}`}>
            <button
              type="button"
              onClick={() => toggleGroup("email")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">Email rules</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("email")}</span>
            </button>
            {openGroups.email && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <p className="text-[10px] text-slate-600">
                  Force a sender to High or Low priority — bypasses the AI classifier.
                  Use a full address (<code className="text-slate-400">jane@example.com</code>) or a bare domain
                  (<code className="text-slate-400">example.com</code>, also matches subdomains).
                </p>

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
              </div>
            )}
          </section>

          {/* ─── Content sources ──────────────────────────────────── */}
          <section id="prefs-group-sources" className={`border border-slate-800 rounded-lg overflow-hidden ${activeGroup === "sources" ? "" : "hidden"}`}>
            <button
              type="button"
              onClick={() => toggleGroup("sources")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">Content sources</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("sources")}</span>
            </button>
            {openGroups.sources && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <TripsEditor />
                <p className="text-[10px] text-slate-500 -mt-2">TDY is also added and ended on the <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("app:navigate", { detail: "calendar" })); onClose(); }} className="text-emerald-400 hover:underline">Calendar</button> (＋ TDY on the Today strip; the TDY chip ends it). Civil places, bases, countries and METAR stations are edited on the <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("app:navigate", { detail: "weather" })); onClose(); }} className="text-emerald-400 hover:underline">Weather tab</button> and under <button type="button" onClick={() => selectGroup("mission")} className="text-emerald-400 hover:underline">Mission → What you track</button> — one list, every role, one ＋ Track… button.</p>
                <NewsSourcesEditor
                  value={disabledNewsSources}
                  onChange={setDisabledNewsSources}
                  currentLocalKey={localFeedKey}
                />
                <NewsletterSourcesEditor value={newsletterSources} onChange={setNewsletterSources} />
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">OSINT feeds</label>
                  <p className="text-[10px] text-slate-500">RSS and Telegram feeds are edited where they are read — <button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("app:navigate", { detail: "osint" })); setTimeout(() => window.dispatchEvent(new CustomEvent("osint:set-pane", { detail: "sources" })), 40); onClose(); }} className="text-emerald-400 hover:underline">OSINT → Sources</button> — with health dots, a tester and AO-aware suggestions.</p>
                </div>
                <AcledCredentialsEditor />
              </div>
            )}
          </section>

          {/* ─── AI & memory ──────────────────────────────────────── */}
          <section id="prefs-group-ai" className={`border border-slate-800 rounded-lg overflow-hidden ${activeGroup === "ai" ? "" : "hidden"}`}>
            <button
              type="button"
              onClick={() => toggleGroup("ai")}
              className="w-full flex items-center gap-2 px-4 py-3 bg-slate-900/60 hover:bg-slate-900 transition-colors text-left"
            >
              <span className="text-sm font-bold text-slate-200 uppercase tracking-wider">AI & memory</span>
              <span className="text-[10px] text-slate-600 font-normal normal-case tracking-normal truncate">· {groupSubtitle("ai")}</span>
            </button>
            {openGroups.ai && (
              <div className="px-4 py-4 border-t border-slate-800 space-y-5">
                <AIControlPanel
                  aiEnabled={aiEnabled}
                  onAiEnabled={setAiEnabled}
                  toggles={aiFeatureToggles}
                  onToggles={setAiFeatureToggles}
                />
                <MemoryPanel />
              </div>
            )}
          </section>
        </div>
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
