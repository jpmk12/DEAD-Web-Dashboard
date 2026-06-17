// Per-country U.S. State Department travel-advisory DETAIL — the structured
// breakdown the RSS feed (lib/stateAdvisories.ts) can't give. The RSS yields a
// level + a truncated blurb for ~190 countries in one keyless call; this scrapes
// the public destination page for the ONE country a user is looking at in the
// Regional dossier, where the richer signal is worth a second fetch:
//
//   • overall advisory level (1–4) + the WORST sub-area level (the "risk bubble")
//   • the standardized risk-indicator pills ("Terrorism (T)", "Crime (C)", …)
//   • the one-line guidance ("Reconsider travel to … due to …")
//   • the advisory summary + per-region "Do Not Travel" breakdown
//   • date issued / last updated
//
// Page URL is slug-based, matching travel.state.gov's own scheme
// (…/travel-advisories/saudi-arabia.html). Keyless, HTTPS, pure fetch + regex
// (no DOM-parser dep → esbuild count stays 0). Fail-safe: any fetch/parse miss
// returns null and the dossier falls back to the RSS level — never a false
// "no advisory / safe". Server-only (used by lib/groundTruth.ts).

const BASE = "https://travel.state.gov/en/international-travel/travel-advisories";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h — advisories are reissued in days, not minutes

export interface AdvisoryRiskArea {
  name: string;
  level: number | null; // 1–4 for this specific area
  summary: string;
}

export interface AdvisoryDetail {
  country: string;
  level: number | null;          // overall advisory level (1–4)
  worstAreaLevel: number | null; // worst sub-area level (the header "risk bubble")
  indicators: string[];          // risk-indicator pills, verbatim e.g. "Terrorism (T)"
  guidance: string;              // "Reconsider travel to … due to …" (one line)
  summary: string;               // advisory-summary prose (trimmed)
  riskAreas: AdvisoryRiskArea[]; // per-region "Do Not Travel" / elevated areas
  dateIssued: string;            // e.g. "March 13, 2026"
  lastUpdated: string;           // e.g. "May 21, 2026"
  link: string;
}

// State's destination slugs are mostly lowercase-hyphenated country names, but a
// handful diverge from a naive slug of the dossier's country string. Only the
// irregular ones need an entry; everything else derives from `slugify`.
const SLUG_OVERRIDES: Record<string, string> = {
  "south korea": "south-korea",
  "korea, south": "south-korea",
  "republic of korea": "south-korea",
  "north korea": "north-korea",
  "korea, north": "north-korea",
  "myanmar": "burma",
  "myanmar (burma)": "burma",
  "democratic republic of the congo": "democratic-republic-of-the-congo",
  "dr congo": "democratic-republic-of-the-congo",
  "drc": "democratic-republic-of-the-congo",
  "republic of the congo": "republic-of-the-congo",
  "congo-brazzaville": "republic-of-the-congo",
  "cote d'ivoire": "cote-d-ivoire",
  "ivory coast": "cote-d-ivoire",
  "russia": "russia",
  "russian federation": "russia",
  "united states": "united-states",
  "czechia": "czech-republic-the",
  "czech republic": "czech-republic-the",
  "the bahamas": "bahamas-the",
  "bahamas": "bahamas-the",
  "the gambia": "gambia-the",
  "gambia": "gambia-the",
  "timor-leste": "timor-leste-east-timor",
  "east timor": "timor-leste-east-timor",
  "eswatini": "eswatini",
  "swaziland": "eswatini",
  "cabo verde": "cabo-verde",
  "cape verde": "cabo-verde",
};

export function advisorySlug(country: string): string {
  const key = country.trim().toLowerCase();
  if (SLUG_OVERRIDES[key]) return SLUG_OVERRIDES[key];
  return slugify(country);
}

function slugify(s: string): string {
  return s
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levelFromClass(html: string, cls: string): number | null {
  const m = html.match(new RegExp(`${cls}\\s+level-([1-4])`, "i"));
  return m ? Number(m[1]) : null;
}

// PURE: parse a destination advisory page's HTML. Exported for unit testing
// against a saved fixture (the sandbox can't reach travel.state.gov).
export function parseAdvisoryDetail(html: string, country: string, link: string): AdvisoryDetail | null {
  // Anchor on the advisory component; bail (→ RSS fallback) if it isn't present,
  // so a redesigned/redirected page never yields a bogus "Level null, no risks".
  if (!/cmp-traveladvisory/.test(html)) return null;

  const level =
    levelFromClass(html, "cmp-traveladvisory__header") ??
    (html.match(/travel-level[^>]*>\s*Level\s*([1-4])/i)?.[1] != null
      ? Number(html.match(/travel-level[^>]*>\s*Level\s*([1-4])/i)![1])
      : null);

  const worstAreaLevel = (() => {
    const m = html.match(/risk-bubble\s+level-([1-4])/i);
    return m ? Number(m[1]) : null;
  })();

  const indicators = Array.from(html.matchAll(/tsg-utility-risk-pill[^>]*>([^<]+)</gi))
    .map((m) => stripTags(m[1]))
    .filter(Boolean);

  // Guidance = the bold action ("Reconsider travel") + the inline reason clause.
  const action = stripTags(html.match(/guidance\s+level-[1-4][^>]*>([^<]+)</i)?.[1] ?? "");
  const inline = stripTags(html.match(/cmp-traveladvisory__inline[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const guidance = [action, inline].filter(Boolean).join(" ").trim();

  // Advisory summary = the body block that follows the "Advisory summary" heading.
  const summaryBlock = html.match(/Advisory summary<\/h3>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1]
    ?? html.match(/section-heading[^>]*>\s*Advisory summary\s*<\/h3>([\s\S]*?)(?=<div class="cmp-traveladvisory__body-container)/i)?.[1]
    ?? "";
  const summary = stripTags(summaryBlock).slice(0, 800);

  // Per-region risk areas (each "Risks in specific areas" → risk-level block).
  const riskAreas: AdvisoryRiskArea[] = [];
  for (const m of html.matchAll(/risk-level\s+level-([1-4])([\s\S]*?)(?=risk-level\s+level-[1-4]|<\/div>\s*<\/div>\s*<\/div>|$)/gi)) {
    const lvl = Number(m[1]);
    const chunk = m[2];
    const name = stripTags(chunk.match(/location-name[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    // The chunk boundary (lookahead on stacked </div>s) can end right at the
    // location-summary's own closing tag, so accept end-of-chunk as a terminator.
    const areaSummary = stripTags(chunk.match(/location-summary[^>]*>([\s\S]*?)(?:<\/div>|$)/i)?.[1] ?? "");
    if (!name) continue;
    riskAreas.push({ name, level: lvl, summary: areaSummary.slice(0, 400) });
    if (riskAreas.length >= 12) break;
  }

  const dateIssued = stripTags(html.match(/Date issued:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)?.[1] ?? "");
  const lastUpdated = stripTags(html.match(/Last Updated:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i)?.[1] ?? "");

  // A page with the component but no level AND no indicators AND no areas is
  // almost certainly a parse miss against a redesign — fail safe to RSS.
  if (level == null && indicators.length === 0 && riskAreas.length === 0) return null;

  return { country, level, worstAreaLevel, indicators, guidance, summary, riskAreas, dateIssued, lastUpdated, link };
}

const cache = new Map<string, { expires: number; value: AdvisoryDetail | null }>();

// Fetch + parse the destination page for one country. Cached 6h per slug.
// Returns null on any failure (unreachable, non-200, parse miss) so callers fall
// back to the RSS level. Server-only.
export async function getAdvisoryDetail(country: string): Promise<AdvisoryDetail | null> {
  const slug = advisorySlug(country);
  if (!slug) return null;
  const hit = cache.get(slug);
  if (hit && hit.expires > Date.now()) return hit.value;

  const link = `${BASE}/${slug}.html`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let html: string;
    try {
      const res = await fetch(link, {
        signal: controller.signal,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const parsed = parseAdvisoryDetail(html, country, link);
    // Cache successes (incl. a deliberate null-from-parse only briefly handled by
    // not caching) — only cache a real parse so transient/redesign misses retry.
    if (parsed) cache.set(slug, { expires: Date.now() + TTL_MS, value: parsed });
    return parsed;
  } catch {
    return hit?.value ?? null; // unreachable/parse failure → last good or null
  }
}

// Test/diagnostic hook.
export function resetAdvisoryDetailCache(): void { cache.clear(); }
