// Strategic maritime/air chokepoints that gate mobility transit, basing access,
// and overflight. Curated points + a pure scorer that surfaces current "activity"
// from the day's news (disruption, closure, attacks, sanctions on transit). No
// new feed — reuses the articles the app already pulls. Safe to import anywhere
// (pure data + math).

import type { NewsItem } from "./types";

export interface Chokepoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  why: string;            // why it matters for mobility
  keywords: string[];     // match terms in news titles/summaries
}

export const CHOKEPOINTS: Chokepoint[] = [
  { id: "hormuz", name: "Strait of Hormuz", lat: 26.57, lon: 56.25, why: "Gulf fuel/sealift artery; closure or attacks ripple to CENTCOM basing & fuel cost", keywords: ["hormuz", "persian gulf", "strait of hormuz"] },
  { id: "babelmandeb", name: "Bab-el-Mandeb / Red Sea", lat: 12.58, lon: 43.33, why: "Red Sea–Suez approach; Houthi attacks reroute shipping around Africa", keywords: ["bab-el-mandeb", "bab el mandeb", "red sea", "houthi", "gulf of aden"] },
  { id: "suez", name: "Suez Canal", lat: 30.42, lon: 32.35, why: "Europe⇄CENTCOM sealift shortcut; blockage adds ~2 weeks via the Cape", keywords: ["suez canal", "suez"] },
  { id: "bosphorus", name: "Turkish Straits (Bosphorus)", lat: 41.12, lon: 29.08, why: "Black Sea access; Montreux/wartime closures affect EUCOM logistics", keywords: ["bosphorus", "dardanelles", "turkish strait", "montreux", "black sea"] },
  { id: "malacca", name: "Strait of Malacca", lat: 2.5, lon: 101.5, why: "INDOPACOM sealift/energy artery between Indian & Pacific oceans", keywords: ["malacca", "singapore strait"] },
  { id: "taiwan", name: "Taiwan Strait", lat: 24.5, lon: 119.5, why: "INDOPACOM flashpoint; closure/quarantine reshapes Pacific access & overflight", keywords: ["taiwan strait", "taiwan"] },
  { id: "panama", name: "Panama Canal", lat: 9.08, lon: -79.68, why: "SOUTHCOM/CONUS sealift; drought-driven draft limits cut throughput", keywords: ["panama canal", "panama"] },
  { id: "russia-ovf", name: "Russian/Belarus overflight", lat: 55.75, lon: 37.62, why: "Closed airspace forces long reroutes for Euro–INDOPACOM mobility", keywords: ["russian airspace", "overflight", "airspace closure", "russia airspace"] },
];

export interface ChokepointSignal extends Chokepoint {
  count: number;
  latest?: { title: string; link: string; source: string; pubDate: string };
}

// Score each chokepoint from the day's news (pure). Returns all points, with the
// most-active first so the UI/AI can foreground what's moving.
export function scoreChokepoints(articles: NewsItem[]): ChokepointSignal[] {
  return CHOKEPOINTS.map((cp) => {
    const hits = articles.filter((a) => {
      const hay = `${a.title} ${a.summary ?? ""}`.toLowerCase();
      return cp.keywords.some((k) => hay.includes(k));
    });
    hits.sort((a, b) => Date.parse(b.pubDate || "0") - Date.parse(a.pubDate || "0"));
    const top = hits[0];
    return {
      ...cp,
      count: hits.length,
      ...(top ? { latest: { title: top.title, link: top.link, source: top.source, pubDate: top.pubDate } } : {}),
    };
  }).sort((a, b) => b.count - a.count);
}
