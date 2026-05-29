"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";

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

export default function OSINTTab() {
  const [items, setItems] = useState<OsintItem[]>([]);
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [pane, setPane] = useState<Pane>("all");
  const [loading, setLoading] = useState(true);
  const [homeLat, setHomeLat] = useState<number>(38.85);
  const [homeLon, setHomeLon] = useState<number>(-104.8);

  useEffect(() => {
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        if (prefs?.localLat) setHomeLat(prefs.localLat);
        if (prefs?.localLon) setHomeLon(prefs.localLon);
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

  const filtered = useMemo(() => {
    if (pane === "all") return items;
    if (pane === "aircraft" || pane === "maritime") return [];
    return items.filter((i) => i.feedKind === pane);
  }, [items, pane]);

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

      {/* Aircraft pane — ADS-B Exchange iframe */}
      {pane === "aircraft" && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 600 }}>
          <iframe
            src={`https://globe.adsbexchange.com/?lat=${homeLat}&lon=${homeLon}&zoom=8&hideButtons&hideSidebar&mil`}
            width="100%"
            height="100%"
            frameBorder="0"
            title="ADS-B Exchange — live aircraft (military filter)"
            className="block"
          />
        </div>
      )}

      {/* Maritime pane — MarineTraffic iframe */}
      {pane === "maritime" && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden" style={{ height: 600 }}>
          <iframe
            src={`https://www.marinetraffic.com/en/ais/embed/zoom:7/centery:${homeLat}/centerx:${homeLon}/maptype:4/shownames:false/mmsi:0/shipid:0/fleet:/fleet_id:/vtypes:/showmenu:false`}
            width="100%"
            height="100%"
            frameBorder="0"
            title="MarineTraffic — live maritime"
            className="block"
          />
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

          {!loading && filtered.length > 0 && (
            <ul className="space-y-2">
              {filtered.map((item) => (
                <li key={item.id} className="bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3 hover:border-slate-700 transition-colors">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${KIND_BADGE[item.feedKind] ?? KIND_BADGE.other}`}>
                      {item.feedKind}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 truncate flex-1">{item.feedLabel}</span>
                    <span className="text-[9px] text-slate-700 font-mono flex-shrink-0">
                      {timeAgo(item.pubDate)}
                    </span>
                  </div>
                  {item.link ? (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-slate-100 hover:text-emerald-400 transition-colors block leading-snug mb-1"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <p className="text-sm font-semibold text-slate-100 leading-snug mb-1">{item.title}</p>
                  )}
                  {item.summary && (
                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">{item.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="text-[10px] text-slate-700 text-right">
        Aircraft via{" "}
        <a href="https://globe.adsbexchange.com" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline">ADS-B Exchange</a>
        {" · maritime via "}
        <a href="https://www.marinetraffic.com" target="_blank" rel="noopener noreferrer"
          className="text-slate-600 hover:text-slate-400 underline">MarineTraffic</a>
        {" · feeds bridged via user-configured RSS endpoints"}
      </p>
    </div>
  );
}
