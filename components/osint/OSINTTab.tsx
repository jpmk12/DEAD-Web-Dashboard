"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import dynamic from "next/dynamic";

// Leaflet uses window/document at import time, so we have to load the map
// component client-only. Without ssr: false the build fails with a
// "window is not defined" error during static analysis.
const AircraftMap = dynamic(() => import("./AircraftMap"), {
  ssr: false,
  loading: () => (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl flex items-center justify-center text-slate-600 text-xs font-mono" style={{ height: 600 }}>
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
}

type Pane = "all" | "social" | "telegram" | "news" | "aircraft" | "maritime";
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

// Embeddable map providers. The original implementation hardcoded ADS-B
// Exchange and MarineTraffic, but both started enforcing X-Frame-Options /
// referrer checks that prevent third-party embedding. The fix is a user-
// selectable provider list — community ADS-B trackers (adsb.fi /
// airplanes.live / adsb.lol descend from open-source tar1090 and explicitly
// allow embedding) sit at the top of the aircraft list, with the now-
// restricted commercial sites kept as fallbacks. Each entry's URL builder
// takes the user's home coords; the iframe key is the provider id so
// switching providers forces a clean remount.
type ProviderDef = {
  id: string;
  label: string;
  url: (lat: number, lon: number) => string;
  note?: string;
};

const AIRCRAFT_PROVIDERS: ProviderDef[] = [
  { id: "adsbfi",        label: "adsb.fi",         url: (lat, lon) => `https://globe.adsb.fi/?lat=${lat}&lon=${lon}&zoom=8&mil` },
  { id: "airplaneslive", label: "airplanes.live",  url: (lat, lon) => `https://globe.airplanes.live/?lat=${lat}&lon=${lon}&zoom=8&mil` },
  { id: "adsblol",       label: "adsb.lol",        url: (lat, lon) => `https://globe.adsb.lol/?lat=${lat}&lon=${lon}&zoom=8&mil` },
  { id: "adsbex",        label: "ADS-B Exchange",  url: (lat, lon) => `https://globe.adsbexchange.com/?lat=${lat}&lon=${lon}&zoom=8&hideButtons&hideSidebar&mil`, note: "may block embed" },
];

const MARITIME_PROVIDERS: ProviderDef[] = [
  { id: "vesselfinder",  label: "VesselFinder",    url: (lat, lon) => `https://www.vesselfinder.com/aismap?zoom=7&lat=${lat}&lon=${lon}&width=100%25&height=100%25&names=true`, note: "may block embed" },
  { id: "marinetraffic", label: "MarineTraffic",   url: (lat, lon) => `https://www.marinetraffic.com/en/ais/embed/zoom:7/centery:${lat}/centerx:${lon}/maptype:4/shownames:false/mmsi:0/shipid:0/fleet:/fleet_id:/vtypes:/showmenu:false`, note: "may block embed" },
  { id: "openseamap",    label: "OpenSeaMap",      url: (lat, lon) => `https://map.openseamap.org/?zoom=7&lat=${lat}&lon=${lon}&mlat=${lat}&mlon=${lon}&layers=BFTFFFFFFFFFF`, note: "chart only, no live AIS" },
];

const LS_AIRCRAFT_PROVIDER = "osint-aircraft-provider";
const LS_MARITIME_PROVIDER = "osint-maritime-provider";
const LS_AIRCRAFT_SOURCE = "osint-aircraft-source"; // "self" | "embed"

export default function OSINTTab() {
  const [items, setItems] = useState<OsintItem[]>([]);
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [pane, setPane] = useState<Pane>("all");
  const [loading, setLoading] = useState(true);
  const [homeLat, setHomeLat] = useState<number>(38.85);
  const [homeLon, setHomeLon] = useState<number>(-104.8);
  const [aircraftProvider, setAircraftProvider] = useState<string>(AIRCRAFT_PROVIDERS[0].id);
  const [maritimeProvider, setMaritimeProvider] = useState<string>(MARITIME_PROVIDERS[0].id);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [timeWindow, setTimeWindow] = useState<"all" | "4h" | "24h" | "7d">("all");
  const [aircraftSource, setAircraftSource] = useState<"self" | "embed">("self");

  useEffect(() => {
    // Restore the user's previously chosen map providers. Validate against
    // the current id list so a stale localStorage value (deleted provider)
    // doesn't strand us on an unknown id.
    try {
      const a = localStorage.getItem(LS_AIRCRAFT_PROVIDER);
      const m = localStorage.getItem(LS_MARITIME_PROVIDER);
      const src = localStorage.getItem(LS_AIRCRAFT_SOURCE);
      if (a && AIRCRAFT_PROVIDERS.some((p) => p.id === a)) setAircraftProvider(a);
      if (m && MARITIME_PROVIDERS.some((p) => p.id === m)) setMaritimeProvider(m);
      if (src === "self" || src === "embed") setAircraftSource(src);
    } catch {}
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        // Defense in depth: even though the server validates lat/lon as
        // numbers, the iframe `src` below interpolates them — coerce here so
        // a future endpoint that ships non-numeric prefs can't inject into
        // the embed URL.
        const lat = Number(prefs?.localLat);
        const lon = Number(prefs?.localLon);
        if (Number.isFinite(lat)) setHomeLat(lat);
        if (Number.isFinite(lon)) setHomeLon(lon);
        if (Array.isArray(prefs?.watchlist)) setWatchlist(prefs.watchlist);
      })
      .catch(() => {});
    fetch("/api/osint/feed")
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setFeeds(d.feeds ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pickAircraft = (id: string) => {
    setAircraftProvider(id);
    try { localStorage.setItem(LS_AIRCRAFT_PROVIDER, id); } catch {}
  };
  const pickMaritime = (id: string) => {
    setMaritimeProvider(id);
    try { localStorage.setItem(LS_MARITIME_PROVIDER, id); } catch {}
  };

  const aircraftCfg = AIRCRAFT_PROVIDERS.find((p) => p.id === aircraftProvider) ?? AIRCRAFT_PROVIDERS[0];
  const maritimeCfg = MARITIME_PROVIDERS.find((p) => p.id === maritimeProvider) ?? MARITIME_PROVIDERS[0];

  const filtered = useMemo(() => {
    let base: OsintItem[];
    if (pane === "all") base = items;
    else if (pane === "aircraft" || pane === "maritime") base = [];
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

  const counts = useMemo(() => ({
    all: items.length,
    social: items.filter((i) => i.feedKind === "social").length,
    telegram: items.filter((i) => i.feedKind === "telegram").length,
    news: items.filter((i) => i.feedKind === "news").length,
  }), [items]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-violet-500/10 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-violet-400 text-xs">⊕</span>
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200">OSINT</h2>
            <p className="text-[10px] text-slate-600 font-mono">
              {feeds.length} feeds · {items.length} items · live aircraft &amp; maritime
              {triaging && <span className="ml-2 text-emerald-500/70 animate-pulse">· triaging…</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Pane selector */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { id: "all",       label: "All",      n: counts.all       },
          { id: "social",    label: "Social",   n: counts.social    },
          { id: "telegram",  label: "Telegram", n: counts.telegram  },
          { id: "news",      label: "News",     n: counts.news      },
          { id: "aircraft",  label: "Aircraft", n: null             },
          { id: "maritime",  label: "Maritime", n: null             },
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
      {pane !== "aircraft" && pane !== "maritime" && (
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

      {/* Aircraft pane — choose between self-hosted Leaflet map (OpenSky
          proxy) or one of the embeddable iframe providers as a fallback.
          Self-hosted is the default since it's the only path we fully
          control; iframe stays available for when OpenSky is unreachable. */}
      {pane === "aircraft" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
            <span className="text-slate-600 font-mono uppercase tracking-wider mr-1">Source</span>
            <button
              type="button"
              onClick={() => {
                setAircraftSource("self");
                try { localStorage.setItem(LS_AIRCRAFT_SOURCE, "self"); } catch {}
              }}
              className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider border transition-all ${
                aircraftSource === "self"
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                  : "text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
              }`}
              title="Self-hosted Leaflet map fed by OpenSky"
            >
              Self-hosted
            </button>
            <button
              type="button"
              onClick={() => {
                setAircraftSource("embed");
                try { localStorage.setItem(LS_AIRCRAFT_SOURCE, "embed"); } catch {}
              }}
              className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider border transition-all ${
                aircraftSource === "embed"
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                  : "text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
              }`}
              title="Embeddable community ADS-B iframe (no map markers, no callsign watch)"
            >
              Iframe provider
            </button>
          </div>

          {aircraftSource === "self" ? (
            <AircraftMap
              homeLat={homeLat}
              homeLon={homeLon}
              radiusKm={250}
              notableCallsigns={watchlist}
            />
          ) : (
          <>
          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
            <span className="text-slate-600 font-mono uppercase tracking-wider mr-1">Provider</span>
            {AIRCRAFT_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => pickAircraft(p.id)}
                title={p.note}
                className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider border transition-all ${
                  aircraftProvider === p.id
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                    : "text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="flex-1" />
            <a
              href={aircraftCfg.url(homeLat, homeLon)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/40 transition-all"
            >
              Open ↗
            </a>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 600 }}>
            <iframe
              key={aircraftCfg.id}
              src={aircraftCfg.url(homeLat, homeLon)}
              width="100%"
              height="100%"
              frameBorder="0"
              referrerPolicy="no-referrer"
              title={`Live aircraft — ${aircraftCfg.label}`}
              className="block"
            />
          </div>
          <p className="text-[10px] text-slate-700 leading-relaxed">
            Filter: military aircraft only. If the map is blank, the provider is refusing the embed —
            try another provider above, or use <span className="text-slate-500">Open ↗</span>. Community
            providers (adsb.fi / airplanes.live / adsb.lol) are the most reliable for embedding.
          </p>
          </>
          )}
        </div>
      )}

      {/* Maritime pane — user-selectable AIS provider */}
      {pane === "maritime" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
            <span className="text-slate-600 font-mono uppercase tracking-wider mr-1">Provider</span>
            {MARITIME_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => pickMaritime(p.id)}
                title={p.note}
                className={`px-2 py-0.5 rounded font-bold uppercase tracking-wider border transition-all ${
                  maritimeProvider === p.id
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                    : "text-slate-500 border-slate-700 hover:border-slate-500 hover:text-slate-300"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="flex-1" />
            <a
              href={maritimeCfg.url(homeLat, homeLon)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-0.5 rounded font-bold uppercase tracking-wider border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/40 transition-all"
            >
              Open ↗
            </a>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 600 }}>
            <iframe
              key={maritimeCfg.id}
              src={maritimeCfg.url(homeLat, homeLon)}
              width="100%"
              height="100%"
              frameBorder="0"
              referrerPolicy="no-referrer"
              title={`Live maritime — ${maritimeCfg.label}`}
              className="block"
            />
          </div>
          <p className="text-[10px] text-slate-700 leading-relaxed">
            Most commercial AIS sites block iframe embedding without a paid embed key. If the map is blank,
            try a different provider, or use <span className="text-slate-500">Open ↗</span>. OpenSeaMap
            always renders but shows only the base nautical chart (no live AIS).
          </p>
        </div>
      )}

      {/* Feed list pane */}
      {pane !== "aircraft" && pane !== "maritime" && (
        <>
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
                <li>X account: <code className="text-emerald-400">https://rsshub.app/twitter/user/USERNAME</code></li>
                <li>Telegram channel: <code className="text-emerald-400">https://rsshub.app/telegram/channel/NAME</code></li>
              </ul>
            </div>
          )}

          {!loading && feeds.length > 0 && filtered.length === 0 && (
            <p className="text-[11px] text-slate-600 font-mono text-center py-6">
              No items in this pane.
            </p>
          )}

          {!loading && dupesSaved > 0 && (
            <p className="text-[10px] font-mono text-slate-600 text-right -mt-2">
              {clusters.length} clusters · {dupesSaved} duplicate{dupesSaved === 1 ? "" : "s"} folded in
            </p>
          )}

          {!loading && clusters.length > 0 && (
            <ul className="space-y-2">
              {clusters.map((cluster) => {
                const primary = cluster.items[0];
                const dupes = cluster.items.slice(1);
                const expanded = expandedClusters.has(cluster.key);
                // Priority comes from the primary item's triage entry, with
                // dupes silently sharing the call so we only spend tokens
                // on the surface row.
                const t = triage[primary.id];
                const watchHit = matchesWatchlist(primary);
                return (
                  <li
                    key={cluster.key}
                    className={`relative border rounded-xl px-4 py-3 transition-colors ${
                      watchHit
                        ? "bg-orange-500/5 border-orange-500/40 hover:border-orange-500/60"
                        : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {watchHit && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-orange-500/15 text-orange-400 border-orange-500/40"
                          title="Matches your watchlist"
                        >
                          ⚑ Watch
                        </span>
                      )}
                      {t && (
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${PRIORITY_PILL[t.priority]}`}
                          title={t.reason}
                        >
                          {t.priority}
                        </span>
                      )}
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${KIND_BADGE[primary.feedKind] ?? KIND_BADGE.other}`}>
                        {primary.feedKind}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 truncate flex-1">{primary.feedLabel}</span>
                      <span className="text-[9px] text-slate-700 font-mono flex-shrink-0">
                        {timeAgo(primary.pubDate)}
                      </span>
                      {(() => {
                        const s = clusterSaveState[cluster.key] ?? "idle";
                        return (
                          <button
                            type="button"
                            onClick={(e) => saveClusterToDocs(cluster, e)}
                            disabled={s === "saving" || s === "saved"}
                            title={
                              s === "saved" ? "Saved to Docs" :
                              s === "error" ? "Save failed — click to retry" :
                              "Save to Docs"
                            }
                            className={`w-5 h-5 flex items-center justify-center rounded transition-all text-[11px] flex-shrink-0 ${
                              s === "saved"
                                ? "text-emerald-400 bg-emerald-500/10"
                                : s === "error"
                                ? "text-red-400 bg-red-500/10"
                                : s === "saving"
                                ? "text-slate-500 cursor-wait"
                                : "text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10"
                            }`}
                          >
                            {s === "saved" ? "✓" : s === "error" ? "!" : "▤"}
                          </button>
                        );
                      })()}
                    </div>
                    {primary.link ? (
                      <a
                        href={primary.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-slate-100 hover:text-emerald-400 transition-colors block leading-snug mb-1"
                      >
                        {primary.title}
                      </a>
                    ) : (
                      <p className="text-sm font-semibold text-slate-100 leading-snug mb-1">{primary.title}</p>
                    )}
                    {primary.summary && (
                      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{primary.summary}</p>
                    )}
                    {dupes.length > 0 && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => toggleCluster(cluster.key)}
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
                                  <a
                                    href={d.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-400 hover:text-emerald-400 transition-colors truncate"
                                  >
                                    {d.title}
                                  </a>
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
              })}
            </ul>
          )}
        </>
      )}

      <p className="text-[10px] text-slate-700 text-right">
        Maps via user-selectable community providers · feeds bridged via user-configured RSS endpoints
      </p>
    </div>
  );
}
