"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import dynamic from "next/dynamic";
import { Crosshair } from "@/lib/icons";
import { fetchUiState, patchUiState, UI_KEYS } from "@/lib/clientUiState";
import GroundTruthTab from "@/components/ground/GroundTruthTab";
import SitrepPanel from "@/components/osint/SitrepPanel";
import WarningBoard from "@/components/osint/WarningBoard";
import XImportCard from "@/components/osint/XImportCard";
import CaptureStatusCard from "@/components/osint/CaptureStatusCard";

// Leaflet uses window/document at import time, so we have to load the map
// component client-only. Without ssr: false the build fails with a
// "window is not defined" error during static analysis.
const CrisisMap = dynamic(() => import("./CrisisMap"), {
  ssr: false,
  loading: () => (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl flex items-center justify-center text-slate-600 text-xs font-mono h-[58vh] min-h-[360px] lg:h-[600px]">
      Loading map…
    </div>
  ),
});

interface OsintItem {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  summary: string;
  feedId: string;
  feedLabel: string;
  feedKind: string;
}

interface FeedSummary {
  id: string;
  label: string;
  kind: string;
  count: number;
  ok?: boolean;       // last fetch succeeded
  fetchedAt?: number;
}

type Pane = "all" | "social" | "telegram" | "news" | "crisis" | "ground" | "sitrep" | "iw";
type Priority = "High" | "Medium" | "Low";

const PRIORITY_PILL: Record<Priority, string> = {
  High:   "bg-red-500/15 text-red-300 border-red-500/40",
  Medium: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  Low:    "bg-slate-700/30 text-slate-500 border-slate-700",
};

const KIND_BADGE: Record<string, string> = {
  social:   "bg-sky-500/15 text-sky-300 border-sky-500/40",
  telegram: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
  news:     "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  other:    "bg-slate-700/40 text-slate-300 border-slate-600",
};

function timeAgo(s: string): string {
  try {
    const d = parseISO(s);
    if (isNaN(d.getTime())) return "";
    return formatDistanceToNow(d, { addSuffix: true });
  } catch { return ""; }
}

const PRIORITY_RANK: Record<Priority, number> = { High: 3, Medium: 2, Low: 1 };
// A story carried by this many distinct feeds is treated as corroborated /
// "developing" — independent reporting is itself an importance signal.
const CORROBORATION_MIN = 3;
const POLL_MS = 90_000;

interface SignalDigest { title: string; priority: string; reason: string; sources: number }

interface OSINTTabProps {
  active?: boolean;
  previousSeen?: number;            // server-recorded last-visit timestamp (ms)
  onSignalCount?: (n: number) => void; // report new-signal count up for the nav badge
  onTopSignals?: (items: SignalDigest[]) => void; // feed the morning brief
}

export default function OSINTTab({ active = true, previousSeen = 0, onSignalCount, onTopSignals }: OSINTTabProps) {
  const [items, setItems] = useState<OsintItem[]>([]);
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [pane, setPane] = useState<Pane>("all");
  const [loading, setLoading] = useState(true);

  // Deep-link: other surfaces (e.g. the Glance Force Protection alert) can jump
  // straight to a specific pane via window event after switching to this tab.
  useEffect(() => {
    const onSetPane = (e: Event) => {
      const p = (e as CustomEvent<string>).detail;
      if (p === "crisis" || p === "all" || p === "social" || p === "telegram" || p === "news" || p === "ground" || p === "sitrep" || p === "iw") setPane(p as Pane);
    };
    window.addEventListener("osint:set-pane", onSetPane);
    return () => window.removeEventListener("osint:set-pane", onSetPane);
  }, []);
  const [homeLat, setHomeLat] = useState<number>(38.85);
  const [homeLon, setHomeLon] = useState<number>(-104.8);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [timeWindow, setTimeWindow] = useState<"all" | "4h" | "24h" | "7d">("all");

  useEffect(() => {
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        // Coerce to numbers defensively before they're used to query the
        // aircraft/ship feeds for AOR-contact awareness.
        const lat = Number(prefs?.localLat);
        const lon = Number(prefs?.localLon);
        if (Number.isFinite(lat)) setHomeLat(lat);
        if (Number.isFinite(lon)) setHomeLon(lon);
        if (Array.isArray(prefs?.watchlist)) setWatchlist(prefs.watchlist);
      })
      .catch(() => {});
  }, []);

  // Keep the feed live: fetch on mount, then poll. Re-fetching swaps in new
  // items; the triage effect (keyed on items) re-runs and only spends tokens
  // on ids it hasn't already cached, so polling stays cheap.
  const loadFeed = useCallback(() => {
    fetch("/api/osint/feed")
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setFeeds(d.feeds ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadFeed();
    const id = setInterval(loadFeed, POLL_MS);
    const onFocus = () => loadFeed();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [loadFeed]);

  const filtered = useMemo(() => {
    let base: OsintItem[];
    if (pane === "all") base = items;
    else if (pane === "crisis" || pane === "ground" || pane === "sitrep" || pane === "iw") base = [];
    else base = items.filter((i) => i.feedKind === pane);

    if (timeWindow === "all") return base;
    const windowMs = timeWindow === "4h" ? 4 * 3600_000
                   : timeWindow === "24h" ? 24 * 3600_000
                   : 7 * 24 * 3600_000;
    const cutoff = Date.now() - windowMs;
    return base.filter((i) => {
      if (!i.pubDate) return false;
      const t = Date.parse(i.pubDate);
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [items, pane, timeWindow]);

  // Pre-compile lowercase watchlist terms once per render so the per-item
  // match check is just an indexOf scan.
  const watchTerms = useMemo(
    () => watchlist.map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2),
    [watchlist],
  );
  const matchesWatchlist = (item: OsintItem) => {
    if (watchTerms.length === 0) return false;
    const hay = `${item.title} ${item.summary}`.toLowerCase();
    return watchTerms.some((t) => hay.includes(t));
  };

  // Cluster near-duplicate headlines so the same story appearing across
  // multiple feeds collapses into one row. The dedupe key strips punctuation,
  // lowercases, collapses whitespace, and truncates to the first ~60 chars —
  // long enough to disambiguate distinct stories but short enough that minor
  // wording differences between sources still cluster. Each cluster is
  // sorted newest-first; clusters themselves are sorted by the freshest
  // item's pubDate.
  const clusters = useMemo(() => {
    const map = new Map<string, OsintItem[]>();
    for (const item of filtered) {
      const key = item.title
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
      const k = key || item.id; // fall back to item id so empty titles never collapse together
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return Array.from(map.entries())
      .map(([k, group]) => ({
        key: k,
        items: [...group].sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || "")),
      }))
      .sort((a, b) => (b.items[0].pubDate || "").localeCompare(a.items[0].pubDate || ""));
  }, [filtered]);

  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [clusterSaveState, setClusterSaveState] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});

  // Per-cluster dismiss (P10) — clear the read pile. Keyed by the cluster's
  // normalized-title key (stable across polls, so a dismissed story stays
  // dismissed as feeds refresh). localStorage like the newsletter dismissals;
  // entries expire after 14 days so an old dismissal can't hide a re-erupting
  // story forever, and the list stays bounded.
  const LS_OSINT_DISMISSED = "osint-dismissed-v1";
  const DISMISS_TTL_MS = 14 * 24 * 3600_000;
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [showDismissed, setShowDismissed] = useState(false);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_OSINT_DISMISSED) || "{}") as Record<string, number>;
      const cutoff = Date.now() - DISMISS_TTL_MS;
      const live = Object.fromEntries(Object.entries(raw).filter(([, ts]) => Number(ts) > cutoff));
      setDismissed(live);
      localStorage.setItem(LS_OSINT_DISMISSED, JSON.stringify(live));
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dismissCluster = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed((prev) => {
      const next = { ...prev, [key]: Date.now() };
      try { localStorage.setItem(LS_OSINT_DISMISSED, JSON.stringify(next)); } catch { /* ignore */ }
      patchUiState({ [UI_KEYS.osintDismissed]: next });
      return next;
    });
  };
  const restoreCluster = (key: string) => {
    setDismissed((prev) => {
      const next = { ...prev };
      delete next[key];
      try { localStorage.setItem(LS_OSINT_DISMISSED, JSON.stringify(next)); } catch { /* ignore */ }
      patchUiState({ [UI_KEYS.osintDismissed]: next });
      return next;
    });
  };

  // Overlay server-synced dismissed clusters on top of the per-device
  // localStorage values so they follow the user across devices (unioned — don't
  // un-dismiss something hidden on another device).
  useEffect(() => {
    fetchUiState().then((st) => {
      const sd = st[UI_KEYS.osintDismissed];
      if (sd && typeof sd === "object" && !Array.isArray(sd)) {
        const cutoff = Date.now() - DISMISS_TTL_MS;
        setDismissed((prev) => {
          const merged = { ...prev };
          for (const [k, ts] of Object.entries(sd as Record<string, unknown>)) {
            if (typeof ts === "number" && ts > cutoff) merged[k] = Math.max(merged[k] ?? 0, ts);
          }
          return merged;
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save a cluster as a new doc. Captures the primary item (title + link +
  // summary) plus a "Also seen in" list of the duplicate feeds so the user
  // knows the corroboration count. Same `link` shape as the news save path
  // — the OSINT item id rides in as an `article` link target so it shows
  // up as a backlink anywhere we surface the source item later.
  const saveClusterToDocs = async (
    cluster: { key: string; items: OsintItem[] },
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const cur = clusterSaveState[cluster.key];
    if (cur === "saving" || cur === "saved") return;
    setClusterSaveState((s) => ({ ...s, [cluster.key]: "saving" }));
    const primary = cluster.items[0];
    const dupes = cluster.items.slice(1);
    const seenLine = dupes.length > 0
      ? `**Also seen in:** ${Array.from(new Set(dupes.map((d) => d.feedLabel))).join(", ")}\n\n`
      : "";
    const t = triage[primary.id];
    const triageLine = t ? `**Triage:** ${t.priority} — ${t.reason}\n\n` : "";
    const summaryBlock = primary.summary
      ? `> ${primary.summary.replace(/\n/g, "\n> ")}\n\n`
      : "";
    const linkLine = primary.link ? `**Link:** [${primary.link}](${primary.link})\n\n` : "";
    const content =
      `# ${primary.title}\n\n` +
      `**Source:** ${primary.feedLabel}  ·  **Kind:** ${primary.feedKind}  ·  **Date:** ${primary.pubDate.slice(0, 10)}\n\n` +
      seenLine +
      triageLine +
      linkLine +
      summaryBlock +
      `---\n\n## Notes\n\n_(your notes here)_\n`;
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `OSINT: ${primary.title}`.slice(0, 240),
          content,
          tags: ["osint", primary.feedKind].filter(Boolean),
          link: { type: "article", id: primary.id, title: primary.title },
        }),
      });
      if (!res.ok) throw new Error();
      setClusterSaveState((s) => ({ ...s, [cluster.key]: "saved" }));
      setTimeout(() => setClusterSaveState((s) => ({ ...s, [cluster.key]: "idle" })), 1800);
    } catch {
      setClusterSaveState((s) => ({ ...s, [cluster.key]: "error" }));
      setTimeout(() => setClusterSaveState((s) => ({ ...s, [cluster.key]: "idle" })), 1800);
    }
  };

  const [triage, setTriage] = useState<Record<string, { priority: Priority; reason: string }>>({});
  const [triaging, setTriaging] = useState(false);

  // Fire triage once items are loaded. Each cluster's primary id is what
  // gets surfaced to the user; non-primary dupes inherit the cluster's
  // priority pill so we don't need to triage them separately.
  useEffect(() => {
    if (items.length === 0) return;
    const payload = items.slice(0, 120).map((i) => ({
      id: i.id, title: i.title, summary: i.summary, feedKind: i.feedKind, feedLabel: i.feedLabel,
    }));
    setTriaging(true);
    fetch("/api/osint/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: payload }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.triage) setTriage(d.triage); })
      .catch(() => {})
      .finally(() => setTriaging(false));
  }, [items]);

  const toggleCluster = (key: string) => setExpandedClusters((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const dupesSaved = filtered.length - clusters.length;
  // Dismissals that apply to clusters currently in view (stale keys don't count).
  const dismissedCount = clusters.filter((c) => dismissed[c.key]).length;

  const counts = useMemo(() => ({
    all: items.length,
    social: items.filter((i) => i.feedKind === "social").length,
    telegram: items.filter((i) => i.feedKind === "telegram").length,
    news: items.filter((i) => i.feedKind === "news").length,
  }), [items]);

  // ── Situational awareness: "what's new and what matters since I last looked" ──

  // Baseline timestamp for "new" detection. Follows the server's last-visit
  // time until the user dwells on the tab, at which point it advances to now so
  // the signals they've seen stop counting as new (and the nav badge clears).
  const [baseline, setBaseline] = useState(previousSeen);
  const advanced = useRef(false);
  useEffect(() => { if (!advanced.current) setBaseline(previousSeen); }, [previousSeen]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      advanced.current = true;
      setBaseline(Date.now());
      fetch("/api/surface-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "osint" }),
      }).catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [active]);

  const [signalsOnly, setSignalsOnly] = useState(false);
  const [bannerDismissedAt, setBannerDismissedAt] = useState(0);

  // Enrich each cluster with the signals an analyst cares about: priority,
  // watchlist hit, corroboration (distinct feeds), recency vs. the baseline.
  const enriched = useMemo(() => {
    return clusters.filter((c) => showDismissed || !dismissed[c.key]).map((c) => {
      const primary = c.items[0];
      const t = triage[primary.id];
      const priority = t?.priority;
      const watch = matchesWatchlist(primary);
      const distinctFeeds = new Set(c.items.map((i) => i.feedLabel)).size;
      const corroborated = distinctFeeds >= CORROBORATION_MIN;
      const newest = c.items.reduce((mx, i) => Math.max(mx, Date.parse(i.pubDate) || 0), 0);
      const isNew = newest > baseline;
      const isSignal = priority === "High" || watch || corroborated;
      return { ...c, primary, t, priority, watch, distinctFeeds, corroborated, newest, isNew, isSignal };
    });
  }, [clusters, triage, watchTerms, baseline, dismissed, showDismissed]); // eslint-disable-line react-hooks/exhaustive-deps

  type Enriched = (typeof enriched)[number];

  // Attention strip: signals first, ranked by priority then recency.
  const signals = useMemo(() =>
    enriched
      .filter((e) => e.isSignal)
      .sort((a, b) =>
        (PRIORITY_RANK[b.priority ?? "Low"] - PRIORITY_RANK[a.priority ?? "Low"]) ||
        (b.newest - a.newest))
      .slice(0, 12),
  [enriched]);

  const rest = useMemo(() => enriched.filter((e) => !e.isSignal), [enriched]);
  const newSignalCount = useMemo(() => enriched.filter((e) => e.isSignal && e.isNew).length, [enriched]);

  // AI "Situation now" — a one-line read of the current signals. Fetched only
  // while the user is on the tab, and only when the signal set actually changes
  // (hash guard), so a quiet day or a background poll doesn't spend tokens.
  const [situation, setSituation] = useState("");
  const [situationOff, setSituationOff] = useState(false);
  const lastSitHash = useRef("");
  useEffect(() => {
    if (!active || signals.length === 0) return;
    const hash = signals.map((s) => s.primary.id).join("|");
    if (hash === lastSitHash.current) return;
    lastSitHash.current = hash;
    const ctrl = new AbortController();
    fetch("/api/osint/situation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: signals.slice(0, 15).map((s) => ({
          title: s.primary.title, feed: s.primary.feedLabel, kind: s.primary.feedKind,
          priority: s.priority ?? "", reason: s.t?.reason ?? "", sources: s.distinctFeeds,
        })),
      }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => {
        setSituationOff(!!d.disabled);
        if (typeof d.situation === "string" && d.situation) setSituation(d.situation);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [active, signals]);

  // Feed the top signals up to the morning brief so OSINT surfaces there too.
  useEffect(() => {
    onTopSignals?.(signals.slice(0, 8).map((s) => ({
      title: s.primary.title, priority: s.priority ?? "Medium",
      reason: s.t?.reason ?? "", sources: s.distinctFeeds,
    })));
  }, [signals, onTopSignals]);

  // Browser notifications: alert on genuinely new feed signals when the user
  // isn't already looking. Permission is opt-in via the header button.
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => {
    if (typeof Notification === "undefined") setNotifPerm("unsupported");
    else setNotifPerm(Notification.permission);
  }, []);
  const notifiedIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const fresh = enriched.filter((e) => e.isSignal && e.isNew && !notifiedIds.current.has(e.primary.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => notifiedIds.current.add(e.primary.id));
    // Don't notify about what they're already watching.
    if (active && !document.hidden) return;
    try {
      new Notification(`OSINT — ${fresh.length} new signal${fresh.length > 1 ? "s" : ""}`, {
        body: fresh[0].primary.title.slice(0, 140),
        tag: "osint-signals",
      });
    } catch { /* notification blocked */ }
  }, [enriched, active]);

  // Map-contact awareness: while on a feed pane, poll the aircraft/maritime
  // feeds so military activity and watchlisted contacts in the AOR show up
  // here too (no token cost — these are the same free endpoints the maps use).
  const [contacts, setContacts] = useState<{ mil: number; vessels: number; watched: string[] }>({ mil: 0, vessels: 0, watched: [] });
  useEffect(() => {
    if (!active || pane === "crisis" || pane === "ground" || pane === "sitrep" || pane === "iw") return;
    if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [ac, sh] = await Promise.all([
          fetch(`/api/osint/aircraft?lat=${homeLat}&lon=${homeLon}&radius=250`).then((r) => r.json()).catch(() => ({})),
          fetch(`/api/osint/ships?lat=${homeLat}&lon=${homeLon}&radius=200`).then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        const aircraft: { callsign?: string; isMilitary?: boolean }[] = Array.isArray(ac.aircraft) ? ac.aircraft : [];
        const ships: { name?: string }[] = Array.isArray(sh.ships) ? sh.ships : [];
        const watched: string[] = [];
        for (const a of aircraft) {
          const cs = (a.callsign ?? "").trim();
          if (cs && watchTerms.some((t) => cs.toLowerCase().includes(t))) watched.push(`✈ ${cs}`);
        }
        for (const v of ships) {
          const nm = (v.name ?? "").trim();
          if (nm && watchTerms.some((t) => nm.toLowerCase().includes(t))) watched.push(`⚓ ${nm}`);
        }
        setContacts({
          mil: aircraft.filter((a) => a.isMilitary).length,
          vessels: ships.length,
          watched: Array.from(new Set(watched)).slice(0, 6),
        });
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, pane, homeLat, homeLon, watchTerms]);

  // Report the count up for the nav badge — but only "new" matters there, and
  // only while the user isn't already looking at the tab.
  useEffect(() => { onSignalCount?.(active ? 0 : newSignalCount); }, [newSignalCount, active, onSignalCount]);

  const renderCluster = (e: Enriched) => {
    const primary = e.primary;
    const dupes = e.items.slice(1);
    const expanded = expandedClusters.has(e.key);
    const t = e.t;
    const watchHit = e.watch;
    const showReason = e.isSignal && !!t?.reason;
    const s = clusterSaveState[e.key] ?? "idle";
    return (
      <li
        key={e.key}
        className={`relative border rounded-xl px-4 py-3 transition-colors ${
          e.priority === "High"
            ? "bg-red-500/[0.04] border-red-500/30 hover:border-red-500/50"
            : watchHit
            ? "bg-orange-500/5 border-orange-500/40 hover:border-orange-500/60"
            : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
        }`}
      >
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          {e.isNew && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-300 border-emerald-500/40" title="New since you last looked">New</span>
          )}
          {watchHit && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-orange-500/15 text-orange-400 border-orange-500/40" title="Matches your watchlist">⚑ Watch</span>
          )}
          {t && (
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${PRIORITY_PILL[t.priority]}`} title={t.reason}>{t.priority}</span>
          )}
          {e.corroborated && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-300 border-amber-500/40" title={`${e.distinctFeeds} independent feeds carrying this story`}>🔥 {e.distinctFeeds} sources</span>
          )}
          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${KIND_BADGE[primary.feedKind] ?? KIND_BADGE.other}`}>{primary.feedKind}</span>
          <span className="text-[10px] font-mono text-slate-500 truncate flex-1 min-w-0">{primary.feedLabel}</span>
          <span className="text-[9px] text-slate-700 font-mono flex-shrink-0">{timeAgo(primary.pubDate)}</span>
          <button
            type="button"
            onClick={(ev) => saveClusterToDocs(e, ev)}
            disabled={s === "saving" || s === "saved"}
            title={s === "saved" ? "Saved to Docs" : s === "error" ? "Save failed — click to retry" : "Save to Docs"}
            className={`w-5 h-5 flex items-center justify-center rounded transition-all text-[11px] flex-shrink-0 ${
              s === "saved" ? "text-emerald-400 bg-emerald-500/10"
              : s === "error" ? "text-red-400 bg-red-500/10"
              : s === "saving" ? "text-slate-500 cursor-wait"
              : "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10"
            }`}
          >
            {s === "saved" ? "✓" : s === "error" ? "!" : "▤"}
          </button>
          {dismissed[e.key] ? (
            <button
              type="button"
              onClick={(ev) => { ev.stopPropagation(); restoreCluster(e.key); }}
              title="Restore — stop hiding this story"
              className="w-5 h-5 flex items-center justify-center rounded transition-all text-[11px] flex-shrink-0 text-amber-400 hover:bg-amber-500/10"
            >
              ↺
            </button>
          ) : (
            <button
              type="button"
              onClick={(ev) => dismissCluster(e.key, ev)}
              title="Dismiss — hide this story (auto-expires after 14 days)"
              className="w-5 h-5 flex items-center justify-center rounded transition-all text-[11px] flex-shrink-0 text-slate-600 hover:text-red-400 hover:bg-red-500/10"
            >
              ✕
            </button>
          )}
        </div>
        {primary.link ? (
          <a href={primary.link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-slate-100 hover:text-emerald-400 transition-colors block leading-snug mb-1">{primary.title}</a>
        ) : (
          <p className="text-sm font-semibold text-slate-100 leading-snug mb-1">{primary.title}</p>
        )}
        {showReason && <p className="text-[10px] text-emerald-300/70 italic mb-1">↳ {t!.reason}</p>}
        {primary.summary && (
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{primary.summary}</p>
        )}
        {dupes.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => toggleCluster(e.key)}
              className="text-[10px] font-mono text-slate-500 hover:text-emerald-400 transition-colors"
              title={expanded ? "Hide duplicates" : "Show duplicate posts from other feeds"}
            >
              {expanded ? "▴ hide" : "▾"} +{dupes.length} more from{" "}
              {Array.from(new Set(dupes.map((d) => d.feedLabel))).slice(0, 3).join(", ")}
              {new Set(dupes.map((d) => d.feedLabel)).size > 3 ? "…" : ""}
            </button>
            {expanded && (
              <ul className="mt-2 pl-3 border-l border-slate-800 space-y-1.5">
                {dupes.map((d) => (
                  <li key={d.id} className="text-[11px] flex items-baseline gap-2">
                    <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">{d.feedLabel}</span>
                    {d.link ? (
                      <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-emerald-400 transition-colors truncate">{d.title}</a>
                    ) : (
                      <span className="text-slate-400 truncate">{d.title}</span>
                    )}
                    <span className="text-[9px] text-slate-700 font-mono flex-shrink-0 ml-auto">{timeAgo(d.pubDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-violet-500/10 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
            <Crosshair size={15} strokeWidth={2.25} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">OSINT</h2>
            <p className="text-[10px] text-slate-600 font-mono">
              {feeds.length} feeds · {items.length} items · live aircraft &amp; maritime
              {triaging && <span className="ml-2 text-emerald-500/70 animate-pulse">· triaging…</span>}
            </p>
          </div>
        </div>

        {/* Opt-in browser alerts on new high-priority signals. */}
        {notifPerm !== "unsupported" && (
          <button
            type="button"
            onClick={() => {
              if (notifPerm === "default") Notification.requestPermission().then(setNotifPerm).catch(() => {});
            }}
            disabled={notifPerm !== "default"}
            title={
              notifPerm === "granted" ? "You'll get a browser alert when a new high-priority signal arrives"
              : notifPerm === "denied" ? "Alerts blocked — enable notifications for this site in your browser"
              : "Get a browser alert when a new high-priority signal arrives"
            }
            className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-all ${
              notifPerm === "granted"
                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                : notifPerm === "denied"
                ? "text-slate-600 border-slate-800 cursor-not-allowed"
                : "text-slate-400 border-slate-700 hover:border-emerald-500/40 hover:text-emerald-400"
            }`}
          >
            {notifPerm === "granted" ? "🔔 Alerts on" : notifPerm === "denied" ? "🔔 Blocked" : "🔔 Enable alerts"}
          </button>
        )}
      </div>

      {/* Pane selector */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { id: "all",       label: "All",      n: counts.all       },
          { id: "social",    label: "Social",   n: counts.social    },
          { id: "telegram",  label: "Telegram", n: counts.telegram  },
          { id: "news",      label: "News",     n: counts.news      },
          { id: "crisis",    label: "Crisis",   n: null             },
          { id: "ground",    label: "Regional", n: null             },
          { id: "sitrep",    label: "SITREP",   n: null             },
          { id: "iw",        label: "I&W",      n: null             },
        ] as const).map((p) => (
          <button
            key={p.id}
            onClick={() => setPane(p.id)}
            className={`px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all border ${
              pane === p.id
                ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                : "bg-slate-800/80 text-slate-500 border-slate-700/80 hover:border-slate-600 hover:text-slate-300"
            }`}
          >
            {p.label}
            {p.n !== null && (
              <span className="ml-1.5 text-[9px] font-mono opacity-70">{p.n}</span>
            )}
          </button>
        ))}
      </div>

      {/* Time-window filter — only meaningful for the feed-list panes, hidden
          on the map panes where there are no items to filter. */}
      {pane !== "crisis" && pane !== "ground" && pane !== "sitrep" && pane !== "iw" && (
        <div className="flex items-center gap-1.5 -mt-2 text-[10px]">
          <span className="text-slate-600 font-mono uppercase tracking-wider mr-1">Window</span>
          {(["all", "4h", "24h", "7d"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setTimeWindow(w)}
              className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider border transition-all ${
                timeWindow === w
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                  : "text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
              }`}
            >
              {w === "all" ? "All" : w}
            </button>
          ))}
        </div>
      )}

      {/* Crisis / situation map — disasters + hub weather + tropical + AMC hubs.
          Live military aircraft (ADS-B) and maritime vessels (AIS) are layers on
          this map now — the standalone Aircraft/Maritime panes were retired. */}
      {pane === "crisis" && <CrisisMap />}

      {/* Ground Truth — per-country situation room for the Force Protection watch */}
      {pane === "ground" && <GroundTruthTab active={active} />}
      {pane === "sitrep" && <SitrepPanel active={active && pane === "sitrep"} />}
      {pane === "iw" && <WarningBoard active={active && pane === "iw"} />}

      {/* Feed list pane */}
      {pane !== "crisis" && pane !== "ground" && pane !== "sitrep" && pane !== "iw" && (
        <>
          {/* X capture import — upload dead-x-capture JSON files (bookmarklet
              output); imported posts ride the feed as kind "social". */}
          {pane === "social" && <XImportCard onImported={loadFeed} />}
          {pane === "social" && <CaptureStatusCard onChanged={loadFeed} />}

          {loading && (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {!loading && feeds.length === 0 && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 text-center">
              <p className="text-xs text-slate-400 mb-2">No OSINT feeds configured yet.</p>
              <p className="text-[11px] text-slate-600 font-mono leading-relaxed max-w-md mx-auto">
                Add RSS / Atom URLs in <span className="text-emerald-400">Preferences → OSINT Feeds</span>.
                Suggested starting points:
              </p>
              <ul className="text-[11px] text-slate-500 font-mono mt-2 space-y-0.5">
                <li>Bluesky: <code className="text-emerald-400">https://bsky.app/profile/HANDLE/rss</code></li>
                <li>Reddit: <code className="text-emerald-400">https://www.reddit.com/r/SUB/.rss</code></li>
                <li>Telegram channel: <code className="text-emerald-400">https://t.me/s/CHANNEL</code></li>
              </ul>
            </div>
          )}

          {!loading && feeds.length > 0 && filtered.length === 0 && (() => {
            const kindFeeds = pane === "all" ? feeds : feeds.filter((f) => f.kind === pane);
            const failing = kindFeeds.filter((f) => f.ok === false);
            const isBridgeKind = pane === "social" || pane === "telegram";
            if (kindFeeds.length === 0) {
              return (
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 text-center text-[11px] text-slate-500 font-mono">
                  No {pane === "all" ? "" : pane + " "}feeds configured. Add them in{" "}
                  <span className="text-emerald-400">Preferences → OSINT Feeds</span>.
                </div>
              );
            }
            return (
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2 text-[11px] text-slate-400 leading-relaxed">
                <p className="text-slate-300">
                  {kindFeeds.length} {pane === "all" ? "" : pane + " "}feed{kindFeeds.length === 1 ? "" : "s"} configured, but nothing came through
                  {failing.length > 0 ? ` — ${failing.length} failed to fetch.` : " right now."}
                </p>
                {failing.length > 0 && (
                  <ul className="font-mono text-[10px] text-red-400/70 space-y-0.5">
                    {failing.slice(0, 6).map((f) => <li key={f.id}>✗ {f.label}</li>)}
                  </ul>
                )}
                {pane === "social" && (
                  <p className="text-slate-500">
                    X / Twitter has no working live feed (X blocks scrapers + datacenter IPs and killed free API access) —
                    use the <span className="text-sky-300">𝕏 Capture import</span> card above to bring in posts from your own browser.
                    For live sources, use platforms with native RSS — they don&apos;t depend on a bridge and don&apos;t rate-limit:
                    Bluesky (<span className="font-mono text-slate-400">bsky.app/profile/&lt;handle&gt;/rss</span>),
                    Mastodon (<span className="font-mono text-slate-400">&lt;instance&gt;/@user.rss</span>),
                    Reddit (<span className="font-mono text-slate-400">reddit.com/r/&lt;sub&gt;/.rss</span>).
                  </p>
                )}
                <div className="text-slate-500">
                  <span className="text-slate-400 font-semibold">Make them reliable:</span>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    <li>Hit the <span className="text-emerald-400">Test</span> button on each feed in <span className="text-emerald-400">Preferences → OSINT Feeds</span> to see the exact failure and try an alternate.</li>
                    {isBridgeKind && (
                      <li>Open <span className="text-emerald-400">Preferences → OSINT Feeds → 💡 Suggested feeds</span> for one-click Bluesky / Mastodon / Reddit / Telegram sources that work from this host.</li>
                    )}
                  </ul>
                </div>
              </div>
            );
          })()}

          {/* Situation line — one-glance read of what matters right now. */}
          {!loading && signals.length > 0 && !situationOff && (
            <div className="bg-violet-500/5 border border-violet-500/30 rounded-lg px-3 py-2 flex items-start gap-2.5">
              <span className="text-violet-400 text-[10px] font-bold uppercase tracking-widest mt-0.5 flex-shrink-0">Situation</span>
              <p className="text-xs text-slate-200 leading-snug">
                {situation || <span className="text-slate-500 italic">Reading the room…</span>}
              </p>
            </div>
          )}
          {!loading && feeds.length > 0 && filtered.length > 0 && signals.length === 0 && (
            <p className="text-[11px] text-slate-600 font-mono">All quiet — no high-priority signals right now.</p>
          )}

          {/* AOR contacts — cross-domain awareness from the live maps without
              having to open the map pane. Watchlisted contacts called out. */}
          {!loading && (contacts.mil > 0 || contacts.vessels > 0 || contacts.watched.length > 0) && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-1.5">
              <span className="text-slate-600 font-mono uppercase tracking-wider text-[10px]">AOR contacts</span>
              {contacts.mil > 0 && <span className="text-slate-300">✈ {contacts.mil} military</span>}
              {contacts.vessels > 0 && <span className="text-slate-500">⚓ {contacts.vessels} vessels</span>}
              {contacts.watched.map((w) => (
                <span key={w} className="text-orange-400 font-semibold border border-orange-500/40 bg-orange-500/10 rounded px-1.5 py-0.5">⚑ {w}</span>
              ))}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setPane("crisis")}
                className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-emerald-400 transition-colors"
              >
                View map ↗
              </button>
            </div>
          )}

          {/* New-signal banner — the proactive "something happened" nudge. */}
          {!loading && newSignalCount > 0 && bannerDismissedAt !== newSignalCount && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
              <span className="text-red-400 text-sm leading-none animate-pulse">▲</span>
              <span className="text-[11px] text-red-200 font-semibold">
                {newSignalCount} new signal{newSignalCount === 1 ? "" : "s"} since you last looked
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setBannerDismissedAt(newSignalCount)}
                className="text-[10px] text-red-300/70 hover:text-red-200 uppercase font-bold tracking-wider"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Needs-attention strip: High / watchlist / corroborated, ranked. */}
          {!loading && signals.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-red-400/80">⚑ Needs attention</span>
                <span className="text-[9px] font-mono text-slate-600">
                  {signals.length} signal{signals.length === 1 ? "" : "s"}
                </span>
                <div className="flex-1 h-px bg-slate-800" />
                {rest.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSignalsOnly((v) => !v)}
                    className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border transition-all ${
                      signalsOnly
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                        : "text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
                    }`}
                    title="Hide everything that isn't a signal"
                  >
                    {signalsOnly ? "Signals only ✓" : "Signals only"}
                  </button>
                )}
              </div>
              <ul className="space-y-2">{signals.map(renderCluster)}</ul>
            </div>
          )}

          {!loading && (dupesSaved > 0 || dismissedCount > 0) && (
            <p className="text-[10px] font-mono text-slate-600 text-right">
              {dismissedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowDismissed((v) => !v)}
                  className="mr-3 text-slate-500 hover:text-amber-400 transition-colors"
                  title={showDismissed ? "Hide dismissed stories again" : "Show dismissed stories (↺ to restore)"}
                >
                  {dismissedCount} dismissed · {showDismissed ? "hide" : "show"}
                </button>
              )}
              {clusters.length} clusters · {dupesSaved} duplicate{dupesSaved === 1 ? "" : "s"} folded in
            </p>
          )}

          {/* The rest, newest-first. Hidden when "Signals only" is on. */}
          {!loading && !signalsOnly && rest.length > 0 && (
            <>
              {signals.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Everything else</span>
                  <div className="flex-1 h-px bg-slate-800/60" />
                </div>
              )}
              <ul className="space-y-2">{rest.map(renderCluster)}</ul>
            </>
          )}
        </>
      )}

      <p className="text-[10px] text-slate-700 text-right">
        Maps via user-selectable community providers · feeds bridged via user-configured RSS endpoints
      </p>
    </div>
  );
}
