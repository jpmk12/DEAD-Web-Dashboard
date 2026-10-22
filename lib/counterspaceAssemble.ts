// The counterspace CATALOGUE read — SERVER-ONLY, per actor (RUS / CHN),
// cached an hour, bounded. Judgement lives in lib/counterspace.ts (pure,
// tested); this file owns the fetches, the SGP4 propagator (satellite.js —
// pure JS plus an inlined wasm, no install script, no esbuild) and the two
// daily series. The REPORTING half (GDELT + own sources through the
// counterspace grammar) is gathered beside it in lib/spectrumSensors, so the
// board's indicator reads catalogue + wire, and this module answers "what
// did the fleet DO".
//
// One pass per actor: resolve the fleet's ids (satcat, by exact name) and
// the declared assets' objects (satcat, by name prefix), pull the fleet's
// element-set history (35 d) and the assets' current sets, then the pure
// maths — manoeuvres per object, plane matches against every asset,
// a 48-h range sweep for the pairs worth sweeping. Only when Space-Track
// answered are the series written: `rpo:<actor>` (manoeuvres detected
// today, peak) and `prox:<actor>` (closest range to a declared asset, min).

import * as satellite from "satellite.js";
import {
  detectManoeuvres, coPlanar, worthSweeping, rangeSweep, assetFor, semiMajorAxisKm, INSPECTOR_FLEET,
  type ElementSet, type Manoeuvre, type CoPlanarEvent, type ProximityEvent, type Propagator, type SpaceActor, type AssetOfInterest, type FleetEntry,
} from "./counterspace";
import { fleetHistory, currentSets, resolveFleet, resolveAssets, spaceTrackConfigured } from "./spaceTrack";
import { getMissionProfile } from "./missionProfileApply";
import { recordSensorDay, getSensorSeries, getSensorBaseline } from "./sensorStore";
import { sensorKey } from "./sensorKeys";
import type { SeriesPoint } from "./series";

export interface FleetRow {
  name: string;
  noradId: number;
  programme: string;
  note: string;
  /** Latest element set's epoch, or null when the catalogue carried none. */
  epoch: string | null;
  altitudeKm: number | null;
  inclination: number | null;
  lastManoeuvre: Manoeuvre | null;
  /** Nearest declared asset over the sweep, when one was swept. */
  nearest: { asset: string; assetClass: AssetOfInterest["cls"]; minRangeKm: number; atISO: string } | null;
  coPlanarWith: string[];
}

export interface CounterspaceCatalogue {
  actor: SpaceActor;
  generatedAt: string;
  /** Space-Track answered this pass (or the hour's cache did). */
  live: boolean;
  configured: boolean;
  reason: string | null;
  fleet: FleetRow[];
  unresolvedFleet: string[];
  assets: { declared: number; resolvedObjects: number; unresolved: string[] };
  manoeuvres: Manoeuvre[];
  manoeuvres14: number;
  /** Mean manoeuvres per 14 d over the trailing 90 observed days (null = forming). */
  cadencePer14: number | null;
  cadenceSamples: number;
  coPlanar: CoPlanarEvent[];
  proximity: ProximityEvent[];
  /** Closest range to a declared asset this pass (km), null when nothing swept. */
  closestKm: number | null;
  /** The prox: series — the distance trend the card draws. */
  proxSeries: SeriesPoint[];
}

const TTL = 60 * 60_000;
const cache = new Map<SpaceActor, { at: number; body: CounterspaceCatalogue }>();
const inflight = new Map<SpaceActor, Promise<CounterspaceCatalogue>>();

function stub(actor: SpaceActor, reason: string, configured: boolean): CounterspaceCatalogue {
  return {
    actor, generatedAt: new Date().toISOString(), live: false, configured, reason,
    fleet: [], unresolvedFleet: [], assets: { declared: 0, resolvedObjects: 0, unresolved: [] },
    manoeuvres: [], manoeuvres14: 0, cadencePer14: null, cadenceSamples: 0, coPlanar: [], proximity: [], closestKm: null, proxSeries: [],
  };
}

/** SGP4 through satellite.js; null when the set has no TLE lines or the
 *  propagation fails (decayed, bad element set). */
const sgp4: Propagator = (set, atMs) => {
  if (!set.line1 || !set.line2) return null;
  try {
    const rec = satellite.twoline2satrec(set.line1, set.line2);
    const out = satellite.propagate(rec, new Date(atMs)) as { position?: unknown } | null;
    const p = out?.position;
    if (!p || typeof p !== "object") return null;
    const v = p as { x: number; y: number; z: number };
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? { x: v.x, y: v.y, z: v.z } : null;
  } catch { return null; }
}

export async function getCounterspaceCatalogue(actor: SpaceActor, opts: { maxWaitMs?: number } = {}): Promise<CounterspaceCatalogue> {
  const c = cache.get(actor);
  if (c && Date.now() - c.at < TTL) return c.body;
  let p = inflight.get(actor);
  if (!p) {
    p = compute(actor).then((b) => { cache.set(actor, { at: Date.now(), body: b }); return b; })
      .catch((e) => stub(actor, `assembly failed: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`, spaceTrackConfigured()))
      .finally(() => inflight.delete(actor));
    inflight.set(actor, p);
  }
  if (opts.maxWaitMs == null) return p;
  const settled = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), opts.maxWaitMs))]);
  return settled ?? c?.body ?? stub(actor, "assembling", spaceTrackConfigured());
}

export function resetCounterspaceCache(): void { cache.clear(); }

async function compute(actor: SpaceActor): Promise<CounterspaceCatalogue> {
  const configured = spaceTrackConfigured();
  const profile = await getMissionProfile().catch(() => null);
  const declared: AssetOfInterest[] = profile?.spectrum?.assetsOfInterest ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  if (!configured) return { ...stub(actor, "Space-Track not configured (SPACETRACK_USER / SPACETRACK_PASS)", false), assets: { declared: declared.length, resolvedObjects: 0, unresolved: [] } };

  const [fleetR, assetsR] = await Promise.all([resolveFleet(), resolveAssets(declared)]);
  const fleetEntries = fleetR.fleet.entries.filter((f) => f.actor === actor);
  if (!fleetR.live && !fleetEntries.length) return { ...stub(actor, fleetR.reason ?? "satcat unreachable", true), assets: { declared: declared.length, resolvedObjects: 0, unresolved: assetsR.assets.unresolved } };

  const [histR, assetSetsR] = await Promise.all([
    fleetHistory(fleetEntries.map((f) => f.noradId), 35),
    currentSets(assetsR.assets.objects.map((o) => o.noradId)),
  ]);
  const live = histR.live;
  const reason = live ? null : histR.reason ?? "gp_history unreachable";

  // Per-object histories and latest sets.
  const byId = new Map<number, ElementSet[]>();
  for (const s of histR.data) (byId.get(s.noradId) ?? byId.set(s.noradId, []).get(s.noradId)!).push(s);
  const manoeuvres: Manoeuvre[] = [];
  const latest = new Map<number, ElementSet>();
  for (const [id, sets] of byId) {
    const sorted = [...sets].sort((a, b) => a.epoch.localeCompare(b.epoch));
    latest.set(id, sorted[sorted.length - 1]);
    manoeuvres.push(...detectManoeuvres(sorted));
  }
  manoeuvres.sort((a, b) => b.atISO.localeCompare(a.atISO));
  const manoeuvres14 = manoeuvres.filter((m) => nowMs - Date.parse(m.atISO) <= 14 * 86_400_000).length;
  const manoeuvresToday = manoeuvres.filter((m) => m.atISO.slice(0, 10) === today).length;

  // Plane matches and sweeps against the declared assets.
  const coPlanarEvents: CoPlanarEvent[] = [];
  const proximity: ProximityEvent[] = [];
  const assetObjects = assetSetsR.live ? assetSetsR.data : [];
  const assetByObject = new Map(assetsR.assets.objects.map((o) => [o.noradId, o.asset]));
  const nearestByFleet = new Map<number, FleetRow["nearest"]>();
  const coPlanarByFleet = new Map<number, string[]>();
  let closestKm: number | null = null;
  for (const f of fleetEntries) {
    const insp = latest.get(f.noradId);
    if (!insp) continue;
    for (const target of assetObjects) {
      const asset = assetByObject.get(target.noradId) ?? assetFor(target.name, target.noradId, declared);
      const declaredAsset = !!asset;
      const cp = coPlanar(insp, target);
      if (cp.match) {
        coPlanarEvents.push({ inspector: f.name, asset: target.name, assetClass: asset?.cls ?? "other", declared: declaredAsset, dRaanDeg: cp.dRaanDeg, dIncDeg: cp.dIncDeg, dAltKm: cp.dAltKm });
        (coPlanarByFleet.get(f.noradId) ?? coPlanarByFleet.set(f.noradId, []).get(f.noradId)!).push(target.name);
      }
      if (!worthSweeping(insp, target)) continue;
      const r = rangeSweep(insp, target, sgp4, nowMs - 24 * 3600_000, 48, 60);
      if (!r) continue;
      if (r.minRangeKm <= 50) {
        proximity.push({ inspector: f.name, asset: target.name, assetClass: asset?.cls ?? "other", declared: declaredAsset, minRangeKm: r.minRangeKm, hoursWithin50: r.hoursWithin50, hoursWithin5: r.hoursWithin5, atISO: r.atISO });
      }
      const prev = nearestByFleet.get(f.noradId);
      if (!prev || r.minRangeKm < prev.minRangeKm) nearestByFleet.set(f.noradId, { asset: target.name, assetClass: asset?.cls ?? "other", minRangeKm: r.minRangeKm, atISO: r.atISO });
      if (declaredAsset && (closestKm == null || r.minRangeKm < closestKm)) closestKm = r.minRangeKm;
    }
  }
  proximity.sort((a, b) => a.minRangeKm - b.minRangeKm);

  // Series: written only from a live catalogue (a dead feed writes nothing).
  if (live) {
    recordSensorDay(sensorKey("rpo", actor), today, manoeuvresToday).catch(() => {});
    if (closestKm != null) recordSensorDay(sensorKey("prox", actor), today, closestKm).catch(() => {});
  }
  const [rpoBase, proxSeries] = await Promise.all([
    getSensorBaseline(sensorKey("rpo", actor), today, 90).catch(() => ({ mean: null as number | null, samples: 0 })),
    getSensorSeries(sensorKey("prox", actor), 30).catch(() => [] as SeriesPoint[]),
  ]);
  const cadencePer14 = rpoBase.mean != null && rpoBase.samples >= 14 ? rpoBase.mean * 14 : null;

  const fleet: FleetRow[] = fleetEntries.map((f: FleetEntry & { noradId: number }) => {
    const l = latest.get(f.noradId) ?? null;
    return {
      name: f.name, noradId: f.noradId, programme: f.programme, note: f.note,
      epoch: l?.epoch ?? null,
      altitudeKm: l ? Math.round(semiMajorAxisKm(l.meanMotion) - 6378.137) : null,
      inclination: l ? Math.round(l.inclination * 100) / 100 : null,
      lastManoeuvre: manoeuvres.find((m) => m.noradId === f.noradId) ?? null,
      nearest: nearestByFleet.get(f.noradId) ?? null,
      coPlanarWith: coPlanarByFleet.get(f.noradId) ?? [],
    };
  });

  return {
    actor, generatedAt: new Date().toISOString(), live, configured, reason,
    fleet, unresolvedFleet: fleetR.fleet.unresolved.filter((n) => INSPECTOR_ACTOR(n) === actor),
    assets: { declared: declared.length, resolvedObjects: assetsR.assets.objects.length, unresolved: assetsR.assets.unresolved },
    manoeuvres: manoeuvres.slice(0, 40), manoeuvres14, cadencePer14, cadenceSamples: rpoBase.samples,
    coPlanar: coPlanarEvents, proximity, closestKm, proxSeries,
  };
}

const INSPECTOR_ACTOR = (name: string): SpaceActor | null => INSPECTOR_FLEET.find((f) => f.name === name)?.actor ?? null;

/** The heartbeat's warm-up: every actor the catalogue tracks, bounded by
 *  the caller. Spends no model tokens; makes the day's three Space-Track
 *  queries if the hour's cache is cold. */
export async function warmCounterspace(): Promise<void> {
  await Promise.all((["RUS", "CHN"] as SpaceActor[]).map((a) => getCounterspaceCatalogue(a).catch(() => null)));
}
