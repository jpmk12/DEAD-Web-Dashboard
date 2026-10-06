// Cyber signals — the grammar and the parsers. PURE, client-safe, unit-tested.
// Dependency-free beyond lib/chokepointSignals (the shared modality grader),
// so lib/economicWarfare can import the grammar for its `cyber` instrument
// without a cycle; the STATE LADDERS live in lib/spectrumRules.ts.
//
// Doctrine (docs/REVIEW-CYBER-SPACE.md §2): observed over reported. KEV
// entries, IODA outage alerts, CISA state-attributed advisories and
// ransomware.live victims are records; news about a cyberattack is graded
// text (act › threat › analysis) exactly as the economy grammar does, and
// own-source-only still caps at Watch. PHRASES, never single words —
// "hackers" appears in every story about any of these actors.
//
// Passive only: nothing in this file, or anything that feeds it, scans,
// probes or touches a network the app does not own.

import { gradeModality, hasPhrase, type Modality } from "./chokepointSignals";

// ───────────────────────────── grammar ─────────────────────────────

export type CyberClass = "disruptive" | "ransom" | "espionage" | "ddos";

export interface CyberClassMeta { label: string; weight: number; phrases: string[] }

export const CYBER_CLASSES: Record<CyberClass, CyberClassMeta> = {
  disruptive: {
    label: "disruptive / destructive", weight: 90,
    phrases: [
      "wiper malware", "wiper attack", "destructive cyberattack", "destructive cyber attack", "destructive malware",
      "cyberattack disrupted", "cyber attack disrupted", "cyberattack knocked", "cyberattack shut down", "cyber attack shut down",
      "cyberattack crippled", "cyberattack paralysed", "cyberattack paralyzed", "hackers disrupted", "hackers shut down",
      "hackers crippled", "systems were taken offline", "took systems offline", "took the systems offline",
      "cyberattack on the power grid", "cyberattack on the grid", "attack on the power grid", "grid was hacked",
      "hacked the port", "port systems were hacked", "cyberattack on the port", "cyberattack on the airport",
      "airport systems hacked", "cyberattack on the airline", "cyberattack on the pipeline", "pipeline was hacked",
      "outage caused by a cyberattack", "cyberattack caused", "sabotage of the network", "cyber sabotage",
      "attack on the water system", "water system was hacked", "cyberattack on the hospital", "hospital systems down after",
    ],
  },
  ransom: {
    label: "ransom / criminal", weight: 70,
    phrases: [
      "ransomware attack", "ransomware group", "ransomware gang", "hit by ransomware", "ransomware incident",
      "ransomware operation", "extortion attempt", "extortion campaign", "double extortion", "data was stolen",
      "stole data from", "data breach at", "breached the network", "breached the systems", "hackers stole",
      "exfiltrated data", "data exfiltration", "leaked the data", "leak site", "ransom demand", "demanded a ransom",
    ],
  },
  espionage: {
    label: "espionage / pre-positioning", weight: 75,
    phrases: [
      "pre-positioning", "pre-positioned", "prepositioning", "living off the land", "volt typhoon", "salt typhoon",
      "flax typhoon", "state-sponsored hackers", "state-backed hackers", "state-sponsored actor", "state-sponsored actors",
      "state-backed group", "state-sponsored group", "cyber espionage", "cyberespionage", "espionage campaign",
      "intrusion into", "intrusions into", "compromised the networks", "compromised networks", "infiltrated the networks",
      "infiltrated networks", "infiltrated the systems", "advanced persistent threat", "backdoor in", "implanted malware",
      "hacked into", "gained access to the network", "gained access to the networks", "long-term access",
      "persistent access", "critical infrastructure intrusions", "targeting critical infrastructure",
      "hacked the telecoms", "telecom networks were breached", "breached telecommunications",
    ],
  },
  ddos: {
    label: "DDoS / hacktivist", weight: 45,
    phrases: [
      "ddos attack", "ddos attacks", "denial-of-service attack", "denial of service attack", "distributed denial",
      "hacktivist", "hacktivists", "defaced the website", "defaced websites", "websites were defaced",
      "website was taken down", "websites were taken down", "knocked offline", "knocked the site offline",
      "flooded with traffic", "overwhelmed with traffic",
    ],
  },
};

export const CYBER_CLASS_ORDER: CyberClass[] = ["disruptive", "espionage", "ransom", "ddos"];

const MODALITY_FACTOR: Record<Modality, number> = { act: 1, threat: 0.45, analysis: 0.1, reversal: 0 };

export interface CyberRead {
  cls: CyberClass;
  modality: Modality;
  phrase: string;
  /** Points after the modality discount (0-100). */
  weight: number;
}

/** The strongest cyber read a text supports, or null when nothing
 *  cyber-shaped is present. Modality is graded by the shared markers. */
export function readCyber(text: string): CyberRead | null {
  if (!text) return null;
  const modality = gradeModality(text);
  let best: CyberRead | null = null;
  for (const cls of CYBER_CLASS_ORDER) {
    const def = CYBER_CLASSES[cls];
    const phrase = def.phrases.find((p) => hasPhrase(text, p));
    if (!phrase) continue;
    const weight = Math.round(def.weight * MODALITY_FACTOR[modality]);
    if (!best || weight > best.weight) best = { cls, modality, phrase, weight };
  }
  return best;
}

// ───────────────────────────── state attribution ─────────────────────────────

/** The state actors the open advisories name, by the ways they are written
 *  about: `group` = a named unit / APT / intrusion set (attribution on its
 *  own); `state` = the country term, which counts only beside attribution
 *  language (REVIEW-2026-10 §10 E4 — "Chinese-made routers" named China as
 *  the author of a cyber act). Order matters only for the label. */
export const STATE_ACTOR_TERMS: { country: string; group: RegExp; state: RegExp }[] = [
  { country: "China", group: /\b(volt typhoon|salt typhoon|flax typhoon|apt ?41|apt ?40|apt ?31|apt ?27|apt ?10|mustang panda|apt ?1\b|mss\b|pla unit)/i, state: /\b(china|chinese|prc|people's republic of china|beijing)\b/i },
  { country: "Russia", group: /\b(gru|svr|fsb|sandworm|apt ?28|apt ?29|fancy bear|cozy bear|nobelium|midnight blizzard|midnight blight|star blizzard|seashell blizzard|forest blizzard)\b/i, state: /\b(russia|russian|kremlin|moscow)\b/i },
  { country: "Iran", group: /\b(irgc|mois|cyberav3ngers|cyber av3ngers|apt ?33|apt ?34|apt ?35|charming kitten|muddywater|pioneer kitten|fox kitten|lemon sandstorm|mint sandstorm|peach sandstorm)\b/i, state: /\b(iran|iranian|tehran)\b/i },
  { country: "North Korea", group: /\b(dprk|lazarus|kimsuky|andariel|apt ?38|apt ?37|reconnaissance general bureau|bluenoroff|jade sleet|citrine sleet|diamond sleet)\b/i, state: /\b(north korea|north korean|pyongyang)\b/i },
];

// Attribution language — the words an advisory uses when it is SAYING who
// did it, as opposed to naming a country for any other reason (a vendor's
// nationality, a victim, a comparison).
const ATTRIBUTION = "(?:state[- ]sponsored|state[- ]backed|state[- ]linked|state[- ]affiliated|state[- ]aligned|nation[- ]state|state actors?|cyber actors?|threat actors?|\\bactors?\\b|government[- ]backed|government[- ]linked|government[- ]sponsored|government hackers|intelligence|military|affiliated|aligned|sponsored|backed|linked|apt\\s?\\d)";
const ATTR_RX = new RegExp(ATTRIBUTION, "i");

/** Which state actors a text names AS THE ACTOR (an advisory title +
 *  summary). A named group or APT is attribution by itself; a bare country
 *  term counts only within ~40 characters of attribution language. */
export function stateActorsIn(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const t of STATE_ACTOR_TERMS) {
    if (t.group.test(text)) { out.push(t.country); continue; }
    if (!t.state.test(text) || !ATTR_RX.test(text)) continue;
    const near = new RegExp(`(?:${t.state.source}[\\s\\S]{0,40}?${ATTRIBUTION}|${ATTRIBUTION}[\\s\\S]{0,40}?${t.state.source})`, "i");
    if (near.test(text)) out.push(t.country);
  }
  return out;
}

export interface AdvisoryLite { title: string; summary?: string; link?: string; pubDate?: string }

export interface NamedAdvisory extends AdvisoryLite { actors: string[]; ageDays: number | null }

const ageDays = (pubDate: string | undefined, todayMs: number): number | null => {
  if (!pubDate) return null;
  const t = Date.parse(pubDate);
  return Number.isFinite(t) ? Math.max(0, Math.round((todayMs - t) / 86_400_000)) : null;
};

/**
 * CISA / JCDC advisories that name a state actor tied to one of `countries`,
 * inside the window. An undated advisory is kept (age null) — the feed's
 * order is recency and the window is a guard, not a filter on the unknown.
 */
export function advisoriesNaming(items: AdvisoryLite[], countries: string[], todayMs: number, windowDays = 14): NamedAdvisory[] {
  const want = new Set(countries.map((c) => c.trim().toLowerCase()));
  const out: NamedAdvisory[] = [];
  for (const it of items) {
    const actors = stateActorsIn(`${it.title} ${it.summary ?? ""}`);
    const hit = actors.filter((a) => want.has(a.toLowerCase()));
    if (hit.length === 0) continue;
    const age = ageDays(it.pubDate, todayMs);
    if (age != null && age > windowDays) continue;
    out.push({ ...it, actors: hit, ageDays: age });
  }
  return out;
}

// ───────────────────────────── CISA KEV ─────────────────────────────

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;          // yyyy-mm-dd
  knownRansomwareCampaignUse: boolean;
}

/** CISA Known Exploited Vulnerabilities JSON → entries. Keyed by field
 *  NAME (the catalog is stable, but a missing field must not throw). */
export function parseKev(json: unknown): KevEntry[] {
  const arr = (json as { vulnerabilities?: unknown[] })?.vulnerabilities;
  if (!Array.isArray(arr)) return [];
  const out: KevEntry[] = [];
  for (const v of arr) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const cveID = typeof r.cveID === "string" ? r.cveID.trim() : "";
    if (!cveID) continue;
    out.push({
      cveID,
      vendorProject: typeof r.vendorProject === "string" ? r.vendorProject.trim() : "",
      product: typeof r.product === "string" ? r.product.trim() : "",
      vulnerabilityName: typeof r.vulnerabilityName === "string" ? r.vulnerabilityName.trim() : "",
      dateAdded: typeof r.dateAdded === "string" ? r.dateAdded.slice(0, 10) : "",
      knownRansomwareCampaignUse: /^known$/i.test(String(r.knownRansomwareCampaignUse ?? "")),
    });
  }
  return out;
}

export interface KevHit { entry: KevEntry; vendor: string }

const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * KEV entries added inside the window whose vendor OR product names a
 * DECLARED vendor (word-bounded, case-insensitive). KEV × declared vendors
 * is the whole exposure signal — never the NVD firehose. No vendors → no
 * hits, and the caller renders UNKNOWN, not green.
 */
export function kevHits(entries: KevEntry[], vendors: string[], todayMs: number, windowDays = 14): KevHit[] {
  const clean = vendors.map((v) => v.trim()).filter((v) => v.length >= 2);
  if (!clean.length) return [];
  const rxs = clean.map((v) => ({ vendor: v, rx: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRx(v)}(?![\\p{L}\\p{N}])`, "iu") }));
  const out: KevHit[] = [];
  for (const e of entries) {
    const t = Date.parse(`${e.dateAdded}T00:00:00Z`);
    if (!Number.isFinite(t)) continue;
    const age = (todayMs - t) / 86_400_000;
    if (age < -1 || age > windowDays) continue;
    const hay = `${e.vendorProject} ${e.product}`;
    const m = rxs.find((r) => r.rx.test(hay));
    if (m) out.push({ entry: e, vendor: m.vendor });
  }
  return out.sort((a, b) => b.entry.dateAdded.localeCompare(a.entry.dateAdded));
}

// ───────────────────────────── ransomware.live ─────────────────────────────

export interface RansomVictim {
  victim: string;
  group: string;
  /** ISO2 or a name — whatever the feed carries, upper-cased when 2 letters. */
  country: string;
  sector: string;
  /** yyyy-mm-dd when parseable, else "". */
  discovered: string;
}

const ymd = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};

/** ransomware.live recent-victims JSON → victims. The API has moved fields
 *  between versions, so every field is read by several names. */
export function parseRansomwareVictims(json: unknown): RansomVictim[] {
  const arr = Array.isArray(json) ? json : (json as { victims?: unknown[]; data?: unknown[] })?.victims ?? (json as { data?: unknown[] })?.data;
  if (!Array.isArray(arr)) return [];
  const out: RansomVictim[] = [];
  for (const v of arr) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const pick = (...keys: string[]): string => { for (const k of keys) { const x = r[k]; if (typeof x === "string" && x.trim()) return x.trim(); } return ""; };
    const victim = pick("victim", "post_title", "title", "name");
    if (!victim) continue;
    const country = pick("country", "country_code", "victim_country");
    out.push({
      victim,
      group: pick("group", "group_name", "gang"),
      country: country.length === 2 ? country.toUpperCase() : country,
      sector: pick("activity", "sector", "industry"),
      discovered: ymd(r.discovered) || ymd(r.published) || ymd(r.date) || ymd(r.attackdate),
    });
  }
  return out;
}

/** Sectors that bear on a mobility force wherever the victim sits. */
export const TRANSPORT_SECTOR_RX = /\b(transport|transportation|logistics|aviation|airline|airport|shipping|maritime|port|defen[cs]e|aerospace|energy|fuel|oil|gas|utilities|telecom)/i;

/**
 * Victims inside the window that sit in one of `countries` (ISO2 or name)
 * OR in a transport / logistics / defence sector anywhere. Undated rows are
 * dropped — a victim with no date cannot be inside any window.
 */
export function victimsRelevant(victims: RansomVictim[], countries: { iso2?: string; name: string }[], todayMs: number, windowDays = 7): RansomVictim[] {
  const iso = new Set(countries.map((c) => (c.iso2 ?? "").toUpperCase()).filter(Boolean));
  const names = new Set(countries.map((c) => c.name.trim().toLowerCase()));
  return victims.filter((v) => {
    if (!v.discovered) return false;
    const t = Date.parse(`${v.discovered}T00:00:00Z`);
    if (!Number.isFinite(t)) return false;
    const age = (todayMs - t) / 86_400_000;
    if (age < -1 || age > windowDays) return false;
    const inCountry = iso.has(v.country.toUpperCase()) || names.has(v.country.toLowerCase());
    return inCountry || TRANSPORT_SECTOR_RX.test(v.sector);
  });
}

// ───────────────────────────── IODA outage alerts ─────────────────────────────

export interface IodaAlert {
  entityType: string;       // country | region | asn
  entityName: string;
  entityCode: string;
  level: string;            // normal | warning | critical (IODA's own words)
  datasource: string;
  time: number;             // epoch seconds
}

/** IODA /v2/outages/alerts → alerts. Field names pinned from the v2
 *  signals family already in production (lib/infra.ts); anything missing
 *  reads as "" rather than throwing. */
export function parseIodaAlerts(json: unknown): IodaAlert[] {
  const data = (json as { data?: unknown })?.data;
  const arr = Array.isArray(data) ? data : Array.isArray(json) ? json : [];
  const out: IodaAlert[] = [];
  for (const a of arr) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    const ent = (r.entity && typeof r.entity === "object" ? r.entity : {}) as Record<string, unknown>;
    const time = Number(r.time ?? r.timestamp ?? 0);
    out.push({
      entityType: String(ent.type ?? r.entityType ?? ""),
      entityName: String(ent.name ?? r.entityName ?? ""),
      entityCode: String(ent.code ?? r.entityCode ?? ""),
      level: String(r.level ?? "").toLowerCase(),
      datasource: String(r.datasource ?? ""),
      time: Number.isFinite(time) ? time : 0,
    });
  }
  return out;
}

/** Country-level alerts for the named countries (loose name match), the
 *  worst level per country, deduped by country. */
export function outageAlertsFor(alerts: IodaAlert[], countries: string[]): { country: string; level: string; sources: number; latest: number }[] {
  const want = countries.map((c) => c.trim().toLowerCase()).filter(Boolean);
  const by = new Map<string, { country: string; level: string; sources: Set<string>; latest: number }>();
  const rank = (l: string) => (l === "critical" ? 2 : l === "warning" ? 1 : 0);
  for (const a of alerts) {
    if (a.entityType !== "country" || rank(a.level) === 0) continue;
    const name = a.entityName.toLowerCase();
    const hit = want.find((w) => name === w || name.includes(w) || w.includes(name));
    if (!hit) continue;
    const cur = by.get(hit);
    if (!cur) by.set(hit, { country: a.entityName, level: a.level, sources: new Set([a.datasource]), latest: a.time });
    else {
      if (rank(a.level) > rank(cur.level)) cur.level = a.level;
      cur.sources.add(a.datasource);
      cur.latest = Math.max(cur.latest, a.time);
    }
  }
  return [...by.values()].map((v) => ({ country: v.country, level: v.level, sources: v.sources.size, latest: v.latest }));
}
