// Server assembly for proposed themes — the PURE lib/themeProposals over the
// declaration (Mission Profile, ★ must-tracks, watchlist, priority topics),
// the user's open-tracking (ordering only), the declared register and the
// stored own-source pool. No model call, no new fetch.
//
// Cached per user for 30 min against a signature of the inputs that are
// cheap to read (profile, themes, declined keys, watchlist) — so a change to
// any of them recomputes at once, and a quiet day reuses the read.

import { getMissionProfile } from "./missionProfileApply";
import { getUserPrefs } from "./userPrefs";
import { getOwnPlaces } from "./ownPlaces";
import { listOpens } from "./surfaceOpens";
import { openBoosts } from "./openSignal";
import { listThemes, listProposalDismissed } from "./themeStore";
import { getTuningPool } from "./themesAssemble";
import { profileSeeds, proposeThemes, type ProposeResult, type SeedInput } from "./themeProposals";
import { THEME_MAX } from "./themes";
import { withTimeout } from "@/lib/withTimeout";

export interface ProposalsBody extends ProposeResult {
  generatedAt: string;
  /** False when the own-source pool, the register or the declined list did not answer — nothing is proposed then. */
  answered: boolean;
  registryFull: boolean;
}

const TTL = 30 * 60 * 1000;
const cache = new Map<string, { at: number; sig: string; body: ProposalsBody }>();

export function resetThemeProposalsCache(): void { cache.clear(); }

const empty = (note: string, answered = false, registryFull = false): ProposalsBody => ({
  generatedAt: new Date().toISOString(), proposals: [], considered: 0, skipped: [], note, answered, registryFull,
});

export async function getThemeProposals(email: string): Promise<ProposalsBody> {
  const [profile, prefs, themes, dismissed, places] = await Promise.all([
    withTimeout(getMissionProfile(), 6_000),
    withTimeout(getUserPrefs(email || undefined), 6_000),
    withTimeout(listThemes(), 6_000),
    withTimeout(listProposalDismissed(), 6_000),
    withTimeout(getOwnPlaces(), 6_000),
  ]);
  if (!themes) return empty("the theme store did not answer — no proposals this pass");
  if (!dismissed) return empty("the declined-proposals list did not answer — nothing proposed, so nothing you declined comes back");
  if (themes.length >= THEME_MAX) return empty(`the register holds ${THEME_MAX} themes — remove one to see proposals`, true, true);

  const own = (places ?? []);
  const label = (icao: string) => own.find((p) => p.icao === icao)?.label ?? "";
  const input: SeedInput = {
    hub: profile?.homeIcao ? { icao: profile.homeIcao, label: profile.home?.label || label(profile.homeIcao.toUpperCase()) } : null,
    spokes: (profile?.spokes ?? []).map((s) => ({ icao: s.icao, label: s.label || label(s.icao) })),
    starFields: [
      ...(profile?.mustTrack.icaos ?? []).map((i) => ({ icao: i, label: label(i) })),
      ...own.filter((p) => p.star).map((p) => ({ icao: p.icao, label: p.label })),
    ],
    starCountries: profile?.mustTrack.countries ?? [],
    aois: (profile?.aois ?? []).map((a) => ({ name: a.name, intensity: a.intensity, countries: a.countries, chokepointIds: a.chokepointIds })),
    watchlist: prefs?.watchlist ?? [],
    topics: prefs?.priorityTopics ?? [],
  };
  const seeds = profileSeeds(input);
  const sig = JSON.stringify([
    profile?.updatedAt ?? "", seeds.map((s) => s.key),
    themes.map((t) => [t.id, t.phrases, t.exclude ?? []]), dismissed.size,
  ]);
  const hit = cache.get(email);
  if (hit && hit.sig === sig && Date.now() - hit.at < TTL) return hit.body;

  const pool = await getTuningPool(12_000);
  if (!pool.answered) return { ...empty(pool.note ?? "your sources did not answer"), considered: seeds.length };

  const opens = await withTimeout(listOpens(email), 4_000);
  const boosts: Record<string, number> = {};
  for (const [k, v] of Object.entries(openBoosts(opens ?? []))) boosts[k.toLowerCase()] = v;

  const res = proposeThemes(seeds, pool.rows, themes, { dismissed, boosts });
  const body: ProposalsBody = { ...res, generatedAt: new Date().toISOString(), answered: true, registryFull: false };
  cache.set(email, { at: Date.now(), sig, body });
  return body;
}
