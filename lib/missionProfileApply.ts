// Mission Profile persistence + the materializer — SERVER-ONLY (imports the
// DB). The pure model/derivation lives in lib/missionProfile.ts.
//
// applyMissionProfile() is the materialize path: the PURE plan
// (lib/missionApplyPlan.ts) re-derives, detects exclusion drift
// (previously-materialized ids the user has since deleted in any editor stay
// deleted), merges AUTO items under the user's MANUAL items (manual always
// wins on natural key: country name / ICAO), enforces the existing per-list
// caps; this file saves through saveUserPrefs so every downstream consumer
// keeps reading the fields it already reads. Single-item changes go through
// lib/trackingOps.ts (the /api/track door), which uses the same lists.

import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { getUserPrefs, saveUserPrefs } from "./userPrefs";
import {
  sanitizeMissionProfile, sanitizeMustTrack, sanitizeEconomyEdits, sanitizeSpectrum, deriveTracking, sitrepBasesForStars, DEFAULT_SPECTRUM,
  type MissionProfile, type DerivedTracking, type MustTrack, type EconomyEdits, type SpectrumDependencies,
} from "./missionProfile";
import { planApply, type ApplyDiff } from "./missionApplyPlan";
import { resolveAirfield } from "./resolveAirfield";
import type { UserPrefs, SitrepBase } from "./types";

const CAPS = { countries: 40, bases: 30, metar: 12 };

interface Row extends RowDataPacket { mission_profile: unknown }

export async function getMissionProfile(): Promise<MissionProfile> {
  const pool = await getDb();
  const [rows] = await pool.query<Row[]>("SELECT mission_profile FROM user_prefs WHERE id = 1");
  const raw = rows[0]?.mission_profile;
  const parsed = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  return sanitizeMissionProfile(parsed);
}

export async function saveMissionProfile(profile: MissionProfile): Promise<void> {
  const pool = await getDb();
  await pool.execute(
    "UPDATE user_prefs SET mission_profile = CAST(? AS JSON), last_updated = NOW() WHERE id = 1",
    [JSON.stringify({ ...profile, updatedAt: new Date().toISOString() })],
  );
}

/**
 * Save a must-track change (the board's ★ taps and the editor) and keep the
 * SITREP base set in step: hub first, ★ fields next, then the current set,
 * capped at SITREP_MAX (lib/missionProfile.sitrepBasesForStars — pure). A ★
 * ICAO that is in neither list is resolved here (curated sets → OurAirports);
 * one that resolves nowhere is kept as a ★ (it still orders and pins) but
 * gets no SITREP slot. Owner-gated at the route, like every profile write.
 */
export async function patchMustTrack(raw: unknown): Promise<{ mustTrack: MustTrack; sitrepBases: SitrepBase[] }> {
  const mustTrack = sanitizeMustTrack(raw);
  const [profile, prefs] = await Promise.all([getMissionProfile(), getUserPrefs()]);
  const next: MissionProfile = { ...profile, mustTrack };
  const derived = deriveTracking(next);
  const known = new Set([...prefs.sitrepBases.map((b) => b.icao), ...derived.sitrepCandidates.map((b) => b.icao)]);
  const resolved: Record<string, SitrepBase | null> = {};
  for (const icao of mustTrack.icaos.filter((i) => !known.has(i))) {
    resolved[icao] = await resolveAirfield(icao).catch(() => null);
  }
  const hubIcao = next.home?.icao ?? next.homeIcao;
  const sitrepBases = sitrepBasesForStars(prefs.sitrepBases, derived.sitrepCandidates, mustTrack.icaos, hubIcao, resolved);
  const changed = sitrepBases.length !== prefs.sitrepBases.length || sitrepBases.some((b, i) => b.icao !== prefs.sitrepBases[i]?.icao);
  if (changed) await saveUserPrefs({ ...prefs, sitrepBases });
  await saveMissionProfile(next);
  return { mustTrack, sitrepBases };
}

/** Save the Economy actor-register overlay alone (the board's ✕ / editor
 *  taps). Owner-gated at the route; the caller resets the economy cache. */
export async function patchEconomy(raw: unknown): Promise<{ economy: EconomyEdits }> {
  const economy = sanitizeEconomyEdits(raw);
  const profile = await getMissionProfile();
  await saveMissionProfile({ ...profile, economy });
  return { economy };
}

const SPECTRUM_KEYS = ["polarRoutes", "satcom", "edgeVendors", "spaceActivity"] as const;

/**
 * Save a PARTIAL spectrum declaration (REVIEW-2026-10 §12 item 7 — "the
 * spectrum declaration is edited where it is read": the SITREP Spectrum
 * card's vendor chips and the Weather tab's polar toggle). Only the keys
 * PRESENT in the patch change; `polarRoutes: null` ("not declared") is a
 * value, so presence is `!== undefined`, not truthiness. The merge goes
 * through `sanitizeSpectrum`, so a crafted field lands as the default it
 * would land as from the editor. Owner-gated at the route; the caller drops
 * the SITREP / spectrum-summary / commands caches so the surfaces that read
 * the declaration re-assemble against the new one.
 */
export async function patchSpectrum(raw: unknown): Promise<{ spectrum: SpectrumDependencies }> {
  const profile = await getMissionProfile();
  const current = profile.spectrum ?? { ...DEFAULT_SPECTRUM };
  const patch: Record<string, unknown> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    for (const k of SPECTRUM_KEYS) if (r[k] !== undefined) patch[k] = r[k];
  }
  const spectrum = sanitizeSpectrum({ ...current, ...patch });
  await saveMissionProfile({ ...profile, spectrum });
  return { spectrum };
}

export interface ApplyResult {
  profile: MissionProfile;
  derived: DerivedTracking;
  diff: ApplyDiff;
  counts: { countries: number; bases: number; metarStations: number; sitrepBases: number; watchlistAdded: number };
  dryRun: boolean;
}

// sitrepPicks: the ICAOs the user confirmed for full SITREP treatment (≤SITREP_MAX).
// Empty array = leave the current SITREP bases untouched.
// The computation is PURE (lib/missionApplyPlan.planApply — drift
// exclusions, manual-wins merge, caps, and materializedIds = exactly the
// derived ids written); this function loads, plans and saves. `dryRun`
// returns the plan's diff without writing anything — the editor's
// confirmation screen.
export async function applyMissionProfile(rawProfile: unknown, sitrepPicks: string[], opts: { dryRun?: boolean } = {}): Promise<ApplyResult> {
  const profile = sanitizeMissionProfile(rawProfile);
  const prefs = await getUserPrefs(); // owner/shared row — apply is owner-gated at the route
  const plan = planApply({
    forceLocations: prefs.forceLocations, countriesOfInterest: prefs.countriesOfInterest, metarStations: prefs.metarStations,
    sitrepBases: prefs.sitrepBases, trackedLocations: prefs.trackedLocations, watchlist: prefs.watchlist,
  }, profile, sitrepPicks);

  if (!opts.dryRun) {
    const next: Omit<UserPrefs, "lastUpdated"> = { ...prefs, ...plan.next };
    await saveUserPrefs(next);
    await saveMissionProfile(plan.profile);
  }

  return { profile: plan.profile, derived: plan.derived, diff: plan.diff, counts: plan.counts, dryRun: !!opts.dryRun };
}
