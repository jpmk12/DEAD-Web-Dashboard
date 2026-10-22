// Counterspace posture — the inspector fleets, the assets they approach, the
// orbital maths that tells a plane change from drag, and the grammar for the
// reporting. PURE, client-safe, unit-tested; dependency-free (the SGP4
// propagator is INJECTED by the server — lib/counterspaceAssemble supplies
// satellite.js; the two-body propagator here is for tests and as a stated
// fallback, never planning-grade).
//
// The worked example (docs/PLAN-SPACE-CYBER-ASK.md §1): Kosmos 2612, one of
// six on an April 2026 launch, manoeuvred with three siblings in May into an
// orbit co-planar with ICEYE-X36 — a commercial SAR satellite imaging for
// Ukraine — and closed to ~500 m over 15–19 October (LeoLabs; Space Force
// statement). The May signal lived in two-line element history four months
// before any headline, which is why this module reads the CATALOGUE first
// and the wire second.
//
// Disciplines carried over from every other indicator:
//   · POSTURE IS THE STANDING PROGRAMME; WARNING IS THE CHANGE. Russia's
//     inspector fleet is years old. A manoeuvre, a plane match with a
//     DECLARED asset, a closing range — those earn colour; "Russia has
//     inspectors" never does.
//   · A position is observed or it is UNKNOWN. No element set → no read.
//   · Intent stays out of the deterministic layer: distance, duration, plane,
//     target class and who said what are recorded; what it MEANS is for the
//     on-tap read, with the falsifier beside it.
//   · An approach to an UNDECLARED asset caps at watching — not the user's
//     concern until declared; Starlink-class traffic is noise by design.

import { gradeModality, hasPhrase, type Modality } from "./chokepointSignals";
import type { ObservedState } from "./warning";

// ───────────────────────────── element sets ─────────────────────────────

export interface ElementSet {
  noradId: number;
  name: string;
  /** ISO epoch of the element set. */
  epoch: string;
  /** Degrees. */
  inclination: number;
  /** Right ascension of the ascending node, degrees. */
  raan: number;
  eccentricity: number;
  /** Argument of perigee, degrees. */
  argPerigee: number;
  /** Mean anomaly at epoch, degrees. */
  meanAnomaly: number;
  /** Revolutions per day. */
  meanMotion: number;
  /** The two TLE lines when the source carried them (SGP4 needs them). */
  line1?: string;
  line2?: string;
}

export const MU_KM3_S2 = 398600.4418;
export const EARTH_RADIUS_KM = 6378.137;
const J2 = 1.08262668e-3;
const DEG = Math.PI / 180;

/** Semi-major axis (km) from mean motion (rev/day). */
export function semiMajorAxisKm(meanMotionRevPerDay: number): number {
  const n = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
  return Math.cbrt(MU_KM3_S2 / (n * n));
}

/** Mean altitude above the reference sphere, km. */
export function altitudeKm(set: Pick<ElementSet, "meanMotion">): number {
  return semiMajorAxisKm(set.meanMotion) - EARTH_RADIUS_KM;
}

export type Regime = "leo" | "meo" | "geo" | "heo";

export function regimeOf(set: Pick<ElementSet, "meanMotion" | "eccentricity">): Regime {
  const alt = altitudeKm(set);
  if (set.eccentricity > 0.25) return "heo";
  if (alt < 2000) return "leo";
  if (alt > 34000 && alt < 37000) return "geo";
  return "meo";
}

/** J2 secular regression of the node, degrees per day (negative for
 *  prograde orbits — the node drifts westward). */
export function raanRateDegPerDay(set: Pick<ElementSet, "meanMotion" | "eccentricity" | "inclination">): number {
  const a = semiMajorAxisKm(set.meanMotion);
  const p = a * (1 - set.eccentricity * set.eccentricity);
  const n = (set.meanMotion * 2 * Math.PI) / 86400;               // rad/s
  const rate = -1.5 * n * J2 * (EARTH_RADIUS_KM / p) ** 2 * Math.cos(set.inclination * DEG); // rad/s
  return (rate * 86400) / DEG;
}

const wrap180 = (d: number): number => { let x = ((d + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };

/** Space-Track `gp` / `gp_history` JSON rows → element sets (rows that lack
 *  the orbital fields are dropped, never guessed). */
export function parseGpRows(json: unknown): ElementSet[] {
  const rows = Array.isArray(json) ? json : Array.isArray((json as { data?: unknown[] })?.data) ? (json as { data: unknown[] }).data : [];
  const out: ElementSet[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const num = (k: string): number | null => { const v = Number(o[k]); return Number.isFinite(v) ? v : null; };
    const id = num("NORAD_CAT_ID");
    const mm = num("MEAN_MOTION"), inc = num("INCLINATION"), raan = num("RA_OF_ASC_NODE"), ecc = num("ECCENTRICITY");
    const argp = num("ARG_OF_PERICENTER"), ma = num("MEAN_ANOMALY");
    const epochRaw = typeof o.EPOCH === "string" ? o.EPOCH : "";
    const epochMs = Date.parse(epochRaw.endsWith("Z") || /[+-]\d\d:\d\d$/.test(epochRaw) ? epochRaw : `${epochRaw}Z`);
    if (id == null || mm == null || inc == null || raan == null || ecc == null || argp == null || ma == null || !Number.isFinite(epochMs)) continue;
    if (mm <= 0 || mm > 20) continue;
    out.push({
      noradId: id,
      name: typeof o.OBJECT_NAME === "string" ? o.OBJECT_NAME.trim() : String(id),
      epoch: new Date(epochMs).toISOString(),
      inclination: inc, raan, eccentricity: ecc, argPerigee: argp, meanAnomaly: ma, meanMotion: mm,
      line1: typeof o.TLE_LINE1 === "string" ? o.TLE_LINE1 : undefined,
      line2: typeof o.TLE_LINE2 === "string" ? o.TLE_LINE2 : undefined,
    });
  }
  return out.sort((a, b) => a.noradId - b.noradId || a.epoch.localeCompare(b.epoch));
}

// ───────────────────────────── manoeuvres ─────────────────────────────

export interface Manoeuvre {
  noradId: number;
  name: string;
  /** Epoch of the element set AFTER the change. */
  atISO: string;
  /** Epoch of the element set before it. */
  fromISO: string;
  dAKm: number;
  dIncDeg: number;
  /** Node change beyond the J2 regression expected over the interval. */
  dRaanResidualDeg: number;
  kind: "altitude" | "plane" | "combined";
}

/** Thresholds, per regime — above TLE noise and routine station-keeping.
 *  GEO east–west keeping moves a by a kilometre or two and north–south by
 *  a few hundredths of a degree; neither is a manoeuvre worth a row. */
export const MANOEUVRE_THRESHOLDS: Record<Regime, { dAKm: number; dIncDeg: number; dRaanDeg: number }> = {
  leo: { dAKm: 2, dIncDeg: 0.05, dRaanDeg: 0.2 },
  meo: { dAKm: 4, dIncDeg: 0.08, dRaanDeg: 0.25 },
  geo: { dAKm: 8, dIncDeg: 0.1, dRaanDeg: 0.3 },
  heo: { dAKm: 15, dIncDeg: 0.1, dRaanDeg: 0.4 },
};

/** Detect manoeuvres in ONE object's element-set history (any order in;
 *  sorted by epoch here). A change in semi-major axis beyond the regime's
 *  envelope is an altitude manoeuvre; a change in inclination, or a node
 *  change beyond what J2 regression predicts for the interval, is a plane
 *  change. Drag lowers `a` slowly; a positive jump is never drag. */
export function detectManoeuvres(history: ElementSet[]): Manoeuvre[] {
  const sets = [...history].sort((a, b) => a.epoch.localeCompare(b.epoch));
  const out: Manoeuvre[] = [];
  for (let i = 1; i < sets.length; i++) {
    const prev = sets[i - 1], cur = sets[i];
    const dtDays = (Date.parse(cur.epoch) - Date.parse(prev.epoch)) / 86_400_000;
    if (!(dtDays > 0.01)) continue;
    const th = MANOEUVRE_THRESHOLDS[regimeOf(prev)];
    const dA = semiMajorAxisKm(cur.meanMotion) - semiMajorAxisKm(prev.meanMotion);
    const dInc = cur.inclination - prev.inclination;
    const expectedRaan = raanRateDegPerDay(prev) * dtDays;
    const dRaanRes = wrap180(wrap180(cur.raan - prev.raan) - expectedRaan);
    // Drag allowance grows with the interval; a LEO object at 400 km loses a
    // few hundred metres a day, so a long gap must not read as a burn.
    const dragAllowance = regimeOf(prev) === "leo" ? Math.min(6, 0.4 * dtDays) : 0;
    const alt = Math.abs(dA) > th.dAKm + (dA < 0 ? dragAllowance : 0);
    const plane = Math.abs(dInc) > th.dIncDeg || Math.abs(dRaanRes) > th.dRaanDeg + 0.02 * dtDays;
    if (!alt && !plane) continue;
    out.push({
      noradId: cur.noradId, name: cur.name, atISO: cur.epoch, fromISO: prev.epoch,
      dAKm: Math.round(dA * 100) / 100, dIncDeg: Math.round(dInc * 1000) / 1000, dRaanResidualDeg: Math.round(dRaanRes * 1000) / 1000,
      kind: alt && plane ? "combined" : alt ? "altitude" : "plane",
    });
  }
  return out;
}

// ───────────────────────────── co-planarity & range ─────────────────────────────

export const COPLANAR_LIMITS = { dIncDeg: 0.5, dRaanDeg: 2, dAltKm: 50 };

export interface CoPlanarRead { match: boolean; dIncDeg: number; dRaanDeg: number; dAltKm: number }

/** Is `a` in (nearly) the same orbital plane and altitude band as `b`? The
 *  May step of the worked example: four Kosmos sats matching ICEYE-X36. */
export function coPlanar(a: ElementSet, b: ElementSet): CoPlanarRead {
  const dIncDeg = Math.abs(a.inclination - b.inclination);
  const dRaanDeg = Math.abs(wrap180(a.raan - b.raan));
  const dAltKm = Math.abs(altitudeKm(a) - altitudeKm(b));
  return {
    match: dIncDeg <= COPLANAR_LIMITS.dIncDeg && dRaanDeg <= COPLANAR_LIMITS.dRaanDeg && dAltKm <= COPLANAR_LIMITS.dAltKm,
    dIncDeg: Math.round(dIncDeg * 1000) / 1000, dRaanDeg: Math.round(dRaanDeg * 1000) / 1000, dAltKm: Math.round(dAltKm * 10) / 10,
  };
}

/** Pairs worth a propagation sweep: same regime, inclination within 2° and
 *  altitude within 150 km (a plane match in the making), or already co-planar. */
export function worthSweeping(a: ElementSet, b: ElementSet): boolean {
  if (regimeOf(a) !== regimeOf(b)) return false;
  return Math.abs(a.inclination - b.inclination) <= 2 && Math.abs(altitudeKm(a) - altitudeKm(b)) <= 150;
}

export interface Eci { x: number; y: number; z: number }
export type Propagator = (set: ElementSet, atMs: number) => Eci | null;

export interface RangeRead {
  minRangeKm: number;
  atISO: string;
  /** Hours of the sweep spent inside 50 km / 5 km. */
  hoursWithin50: number;
  hoursWithin5: number;
  /** Steps that propagated for BOTH objects (null positions are skipped). */
  samples: number;
}

/** Minimum range between two objects over a window, sampled every
 *  `stepSec`. Null when fewer than half the samples propagated — a read
 *  from a propagator that mostly failed is not a read. */
export function rangeSweep(a: ElementSet, b: ElementSet, propagate: Propagator, startMs: number, hours = 48, stepSec = 60): RangeRead | null {
  const steps = Math.max(1, Math.floor((hours * 3600) / stepSec));
  let min = Infinity, atMs = startMs, samples = 0, in50 = 0, in5 = 0;
  for (let s = 0; s <= steps; s++) {
    const t = startMs + s * stepSec * 1000;
    const pa = propagate(a, t), pb = propagate(b, t);
    if (!pa || !pb) continue;
    samples++;
    const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
    if (d < min) { min = d; atMs = t; }
    if (d <= 50) in50++;
    if (d <= 5) in5++;
  }
  if (samples < steps / 2 || !Number.isFinite(min)) return null;
  const h = stepSec / 3600;
  return { minRangeKm: Math.round(min * 100) / 100, atISO: new Date(atMs).toISOString(), hoursWithin50: Math.round(in50 * h * 10) / 10, hoursWithin5: Math.round(in5 * h * 10) / 10, samples };
}

/** Two-body Kepler propagation from the element set — ECI km. For tests
 *  and as a STATED fallback only: no J2, no drag, so plane and phase drift
 *  over days. The server injects SGP4. */
export const twoBodyPropagator: Propagator = (set, atMs) => {
  const dt = (atMs - Date.parse(set.epoch)) / 1000;
  if (!Number.isFinite(dt)) return null;
  const a = semiMajorAxisKm(set.meanMotion);
  const n = Math.sqrt(MU_KM3_S2 / (a * a * a));
  const e = set.eccentricity;
  let M = (set.meanAnomaly * DEG + n * dt) % (2 * Math.PI);
  if (M < 0) M += 2 * Math.PI;
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) { const f = E - e * Math.sin(E) - M; E -= f / (1 - e * Math.cos(E)); if (Math.abs(f) < 1e-12) break; }
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));
  const xp = r * Math.cos(nu), yp = r * Math.sin(nu);
  const O = set.raan * DEG, i = set.inclination * DEG, w = set.argPerigee * DEG;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  return {
    x: (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp,
    y: (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp,
    z: (sw * si) * xp + (cw * si) * yp,
  };
};

// ───────────────────────────── the catalogue ─────────────────────────────

export type SpaceActor = "RUS" | "CHN";

export interface FleetEntry {
  actor: SpaceActor;
  /** OBJECT_NAME as the catalogue spells it (the server resolves ids by
   *  name through the satcat when `noradId` is null or stale). */
  name: string;
  noradId: number | null;
  /** What the open literature calls the programme. */
  programme: string;
  note: string;
}

/** The inspector / co-orbital fleets the open record names, as of `asOf`.
 *  Refresh quarterly (the SWF and CSIS annual counterspace reports are the
 *  reference). Ids given only where the catalogue entry is well known; a
 *  null id is resolved by name and never guessed. The 2026 launch that
 *  carried Kosmos 2612 added six objects — all resolved by name. */
export const FLEET_AS_OF = "2026-10-22";
export const INSPECTOR_FLEET: FleetEntry[] = [
  { actor: "RUS", name: "COSMOS 2519", noradId: 42798, programme: "Nivelir", note: "2017 inspector; released the Kosmos 2521 sub-satellite" },
  { actor: "RUS", name: "COSMOS 2521", noradId: 42919, programme: "Nivelir", note: "sub-satellite of Kosmos 2519" },
  { actor: "RUS", name: "COSMOS 2523", noradId: 42955, programme: "Nivelir", note: "released from Kosmos 2521, high-velocity" },
  { actor: "RUS", name: "COSMOS 2542", noradId: 44797, programme: "Nivelir", note: "2019–20 shadowing of USA 245 (NRO)" },
  { actor: "RUS", name: "COSMOS 2543", noradId: 44835, programme: "Nivelir", note: "sub-satellite of Kosmos 2542; 2020 projectile release" },
  { actor: "RUS", name: "COSMOS 2558", noradId: 53323, programme: "Nivelir", note: "2022 co-planar with USA 326 (NRO)" },
  { actor: "RUS", name: "COSMOS 2576", noradId: null, programme: "Nivelir", note: "2024, co-planar with USA 314 (NRO) — assessed counterspace by USSPACECOM" },
  { actor: "RUS", name: "COSMOS 2607", noradId: null, programme: "2026 six-sat launch", note: "one of six on the April 2026 launch" },
  { actor: "RUS", name: "COSMOS 2608", noradId: null, programme: "2026 six-sat launch", note: "one of six on the April 2026 launch" },
  { actor: "RUS", name: "COSMOS 2609", noradId: null, programme: "2026 six-sat launch", note: "one of six on the April 2026 launch" },
  { actor: "RUS", name: "COSMOS 2610", noradId: null, programme: "2026 six-sat launch", note: "one of six on the April 2026 launch" },
  { actor: "RUS", name: "COSMOS 2611", noradId: null, programme: "2026 six-sat launch", note: "one of six on the April 2026 launch" },
  { actor: "RUS", name: "COSMOS 2612", noradId: null, programme: "2026 six-sat launch", note: "May 2026 plane match with ICEYE-X36; ~500 m approach 15–19 Oct 2026 (LeoLabs)" },
  { actor: "RUS", name: "LUCH (OLYMP)", noradId: 40258, programme: "Luch / Olymp-K", note: "GEO; repeated drift stops beside Intelsat / SES / Eutelsat payloads since 2015" },
  { actor: "RUS", name: "LUCH 2 (OLYMP-K 2)", noradId: null, programme: "Luch / Olymp-K", note: "GEO, 2023" },
  { actor: "CHN", name: "SHIJIAN-17 (SJ-17)", noradId: 41838, programme: "Shijian", note: "GEO; robotic-arm RPO demonstrations" },
  { actor: "CHN", name: "SHIJIAN-21 (SJ-21)", noradId: 49330, programme: "Shijian", note: "GEO; towed a dead BeiDou to the graveyard orbit, 2022" },
  { actor: "CHN", name: "SHIYAN-7 (SY-7)", noradId: 39208, programme: "Shiyan", note: "LEO; 2013 RPO with a companion" },
  { actor: "CHN", name: "TJS-3", noradId: null, programme: "TJS", note: "GEO; released a sub-satellite, 2019" },
];

/** Fleet mentions in text → the actor, for attribution when the sentence
 *  names the satellite rather than the state ("Kosmos 2612 closed on…"). */
const FLEET_MENTION: { actor: SpaceActor; rx: RegExp }[] = [
  { actor: "RUS", rx: /\b(?:kosmos|cosmos)[ -]?2[5-6]\d{2}\b|\bluch\b|\bolymp(?:-k)?\b|\bnivelir\b|\bburevestnik\b|\bnudol\b/i },
  { actor: "CHN", rx: /\bshijian\b|\bsj-?\d{1,2}\b|\btjs-?\d{1,2}\b|\bshiyan\b|\bsy-?\d{1,2}\b/i },
];
export function fleetActorIn(text: string): SpaceActor | null {
  for (const f of FLEET_MENTION) if (f.rx.test(text)) return f.actor;
  return null;
}

export type AssetClass = "isr-commercial" | "isr-government" | "satcom-mil" | "pnt" | "ew" | "other";

export interface AssetOfInterest {
  /** A name or OBJECT_NAME prefix the satcat is searched with ("ICEYE-X" → every ICEYE-X*). */
  name: string;
  noradId: number | null;
  cls: AssetClass;
  label: string;
}

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  "isr-commercial": "commercial ISR", "isr-government": "government ISR", "satcom-mil": "military SATCOM", pnt: "PNT", ew: "EW / SIGINT", other: "other",
};

/** The seed list (decision 2, 2026-10-22): the commercial ISR operators
 *  known to support Ukraine and the mobility force's own SATCOM. Edited
 *  inline on the SITREP Spectrum card like the edge vendors. */
export const DEFAULT_ASSETS_OF_INTEREST: AssetOfInterest[] = [
  { name: "ICEYE-X", noradId: null, cls: "isr-commercial", label: "ICEYE SAR constellation" },
  { name: "WORLDVIEW", noradId: null, cls: "isr-commercial", label: "Maxar WorldView / Legion" },
  { name: "SKYSAT", noradId: null, cls: "isr-commercial", label: "Planet SkySat" },
  { name: "BLACKSKY", noradId: null, cls: "isr-commercial", label: "BlackSky Global" },
  { name: "CAPELLA", noradId: null, cls: "isr-commercial", label: "Capella SAR" },
  { name: "UMBRA", noradId: null, cls: "isr-commercial", label: "Umbra SAR" },
  { name: "USA 326", noradId: null, cls: "isr-government", label: "USA 326 (NRO) — the 2022 Kosmos 2558 target" },
  { name: "WGS", noradId: null, cls: "satcom-mil", label: "Wideband Global SATCOM" },
  { name: "MUOS", noradId: null, cls: "satcom-mil", label: "MUOS narrowband SATCOM" },
  { name: "AEHF", noradId: null, cls: "satcom-mil", label: "AEHF protected SATCOM" },
];

export const MAX_ASSETS = 40;

/** Sanitise a declared asset list (absent → the seed; present → as given,
 *  so an operator who empties it has emptied it). */
export function sanitizeAssets(raw: unknown): AssetOfInterest[] {
  if (raw === undefined) return DEFAULT_ASSETS_OF_INTEREST.map((a) => ({ ...a }));
  if (!Array.isArray(raw)) return [];
  const out: AssetOfInterest[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = (typeof o.name === "string" ? o.name : "").trim().toUpperCase().slice(0, 40);
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const id = Number(o.noradId);
    const cls = (typeof o.cls === "string" && (o.cls as AssetClass) in ASSET_CLASS_LABEL ? o.cls : "other") as AssetClass;
    out.push({ name, noradId: Number.isInteger(id) && id > 0 ? id : null, cls, label: (typeof o.label === "string" ? o.label : name).trim().slice(0, 80) || name });
    if (out.length >= MAX_ASSETS) break;
  }
  return out;
}

/** Does a catalogue OBJECT_NAME belong to a declared asset? Prefix match on
 *  the upper-cased name (ICEYE-X36 under "ICEYE-X"), exact id when given. */
export function assetFor(objectName: string, noradId: number, assets: AssetOfInterest[]): AssetOfInterest | null {
  const n = objectName.trim().toUpperCase();
  for (const a of assets) {
    if (a.noradId != null && a.noradId === noradId) return a;
    if (n === a.name || n.startsWith(a.name)) return a;
  }
  return null;
}

// ───────────────────────────── the grammar ─────────────────────────────

export type CounterspaceClass = "asat" | "rpo" | "jamming";

const CLASS_WEIGHT: Record<CounterspaceClass, number> = { asat: 95, rpo: 70, jamming: 55 };
const MODALITY_FACTOR: Record<Modality, number> = { act: 1, threat: 0.45, analysis: 0.1, reversal: 0 };

/** PHRASES, never single words: "satellite" and "orbit" are in every
 *  launch story. Names of the fleet are deliberately NOT phrases — a bare
 *  mention of Kosmos 2612 earns nothing; what it did does. */
const CLASS_PHRASES: Record<CounterspaceClass, string[]> = {
  asat: [
    "anti-satellite test", "asat test", "anti-satellite weapon", "anti-satellite missile", "direct-ascent",
    "destroyed a satellite", "satellite was destroyed", "shot down a satellite", "kinetic kill", "co-orbital weapon",
    "nuclear anti-satellite", "nuclear weapon in space", "nuclear-armed satellite", "nuclear device in orbit",
    "fired a projectile", "released a projectile", "weapon test in orbit",
  ],
  rpo: [
    "close approach", "close approaches", "inspector satellite", "inspection satellite", "co-orbital", "rendezvous and proximity",
    "proximity operations", "proximity operation", "shadowing a satellite", "shadowing the satellite", "stalking a satellite",
    "stalked a satellite", "manoeuvred close to", "maneuvered close to", "manoeuvred toward", "maneuvered toward",
    "approached a satellite", "approached the satellite", "cat-and-mouse", "cat and mouse", "within 500 meters", "within 500 metres",
    "closed to within", "came within", "same orbital plane", "co-planar", "coplanar", "matched its orbit", "trailing the satellite",
    "parked next to", "drifted next to", "drifted toward", "positioned near a", "positioned close to",
  ],
  jamming: [
    "satellite jamming", "jamming satellites", "jamming of satellite", "jammed the satellite", "starlink jamming", "jamming starlink",
    "jammed starlink", "interference with satellite", "satcom jamming", "uplink jamming", "jamming the uplink", "spoofing satellite",
    "jamming signals from", "electronic attack on a satellite", "electronic warfare against satellites",
  ],
};

export interface CounterspaceRead {
  cls: CounterspaceClass;
  modality: Modality;
  phrase: string;
  weight: number;
}

/** The strongest counterspace read a text supports, or null when nothing
 *  counterspace-shaped is said. Modality by the shared markers. */
export function readCounterspace(text: string): CounterspaceRead | null {
  if (!text) return null;
  const modality = gradeModality(text);
  let best: CounterspaceRead | null = null;
  for (const cls of Object.keys(CLASS_PHRASES) as CounterspaceClass[]) {
    const phrase = CLASS_PHRASES[cls].find((p) => hasPhrase(text, p));
    if (!phrase) continue;
    const weight = Math.round(CLASS_WEIGHT[cls] * MODALITY_FACTOR[modality]);
    if (!best || weight > best.weight) best = { cls, modality, phrase, weight };
  }
  return best;
}

/** A named tracking firm or an official voice in the text — what turns a
 *  reported approach into a corroborated one. */
const CORROBORATORS = /\b(leolabs|comspoc|slingshot|exoanalytic|space force|ussf|usspacecom|space command|18th space defense|18 sds|secure world foundation|langbroek|space-track|celestrak)\b/i;
export function hasCorroborator(text: string): boolean { return CORROBORATORS.test(text); }

// ───────────────────────────── the state ladder ─────────────────────────────

export interface ProximityEvent {
  inspector: string;
  asset: string;
  assetClass: AssetClass;
  /** False when the approached object is not on the declared list. */
  declared: boolean;
  minRangeKm: number;
  hoursWithin50: number;
  hoursWithin5: number;
  atISO: string;
}

export interface CoPlanarEvent { inspector: string; asset: string; assetClass: AssetClass; declared: boolean; dRaanDeg: number; dIncDeg: number; dAltKm: number }

export interface CounterspaceInputs {
  /** The catalogue feed answered (manoeuvre / plane / range reads exist). */
  catalogueLive: boolean;
  /** Fleet manoeuvres in the last 14 d and the actor's own 90-d cadence per 14 d (null = forming). */
  manoeuvres14: number;
  cadencePer14: number | null;
  coPlanar: CoPlanarEvent[];
  proximity: ProximityEvent[];
  /** Graded reporting attributed to the actor (act / threat / analysis), with own-source flags. */
  reported: { modality: Modality; own: boolean; corroborated: boolean; cls: CounterspaceClass }[];
  /** USSF / USSPACECOM statements in the window. */
  official: number;
}

export interface CounterspaceStateRead { state: ObservedState; confidence: number; why: string }

const RANK: Record<ObservedState, number> = { dormant: 0, watching: 1, active: 2, confirmed: 3 };
const worseOf = (a: CounterspaceStateRead, b: CounterspaceStateRead): CounterspaceStateRead => (RANK[b.state] > RANK[a.state] ? b : a);

export const RANGE_ACTIVE_KM = 50;
export const RANGE_CLOSE_KM = 5;

/** Null when nothing observed at all (UNKNOWN). The ladder of the plan §2.1. */
export function counterspaceState(i: CounterspaceInputs): CounterspaceStateRead | null {
  const anyReport = i.reported.length > 0 || i.official > 0;
  if (!i.catalogueLive && !anyReport) return null;
  let s: CounterspaceStateRead = { state: "dormant", confidence: 0, why: i.catalogueLive ? "inspector fleet on station, no plane match or approach to a declared asset" : "catalogue unreachable — reporting only" };

  if (i.catalogueLive) {
    if (i.manoeuvres14 > 0) {
      const surge = i.cadencePer14 != null && i.manoeuvres14 > Math.max(i.cadencePer14 * 1.5, i.cadencePer14 + 2);
      s = worseOf(s, { state: "watching", confidence: surge ? 0.5 : 0.4, why: `${i.manoeuvres14} fleet manoeuvre${i.manoeuvres14 === 1 ? "" : "s"} in 14d${i.cadencePer14 == null ? " (cadence forming)" : surge ? ` vs ~${i.cadencePer14.toFixed(1)} cadence — surge` : ""}` });
    }
    const declaredPlane = i.coPlanar.filter((c) => c.declared);
    if (declaredPlane.length) {
      const c = declaredPlane[0];
      s = worseOf(s, { state: "watching", confidence: 0.55, why: `${c.inspector} co-planar with ${c.asset} (${ASSET_CLASS_LABEL[c.assetClass]}) — positioning` });
    }
    const declaredProx = i.proximity.filter((p) => p.declared && p.minRangeKm <= RANGE_ACTIVE_KM).sort((a, b) => a.minRangeKm - b.minRangeKm);
    if (declaredProx.length) {
      const p = declaredProx[0];
      const close = p.minRangeKm <= RANGE_CLOSE_KM;
      const shadow = p.hoursWithin50 >= 24;
      s = worseOf(s, { state: "active", confidence: close ? 0.8 : 0.7, why: `${p.inspector} within ${p.minRangeKm < 1 ? `${Math.round(p.minRangeKm * 1000)} m` : `${p.minRangeKm.toFixed(1)} km`} of ${p.asset} (${ASSET_CLASS_LABEL[p.assetClass]})${shadow ? ` — shadowing, ${p.hoursWithin50.toFixed(0)} h inside 50 km` : ""}` });
    }
    const undeclared = i.proximity.filter((p) => !p.declared && p.minRangeKm <= RANGE_ACTIVE_KM);
    if (undeclared.length && RANK[s.state] < RANK.watching) {
      s = { state: "watching", confidence: 0.4, why: `${undeclared[0].inspector} within ${undeclared[0].minRangeKm.toFixed(1)} km of ${undeclared[0].asset} — not a declared asset (caps at watching)` };
    }
  }

  // Reporting: a wire act is active; own-source-only caps at watching; a
  // corroborated act (tracking firm / official) joins the catalogue read
  // to confirm.
  const acts = i.reported.filter((r) => r.modality === "act");
  const wireActs = acts.filter((r) => !r.own);
  const threats = i.reported.filter((r) => r.modality === "threat");
  if (wireActs.length) {
    const corroborated = wireActs.some((r) => r.corroborated);
    const lead = wireActs.find((r) => r.cls === "asat") ?? wireActs[0];
    s = worseOf(s, { state: "active", confidence: corroborated ? 0.75 : 0.6, why: `${wireActs.length} reported ${lead.cls === "asat" ? "ASAT" : lead.cls === "rpo" ? "proximity" : "jamming"} act${wireActs.length === 1 ? "" : "s"}${corroborated ? " (named tracker)" : ""}` });
  } else if (acts.length) {
    s = worseOf(s, { state: "watching", confidence: 0.45, why: "own sources only report an act — caps at watching" });
  } else if (threats.length) {
    s = worseOf(s, { state: "watching", confidence: 0.45, why: `${threats.length} declared threat${threats.length === 1 ? "" : "s"}` });
  }
  const officialOrTracker = i.official > 0 || wireActs.some((r) => r.corroborated);
  if (s.state === "active" && officialOrTracker && (i.catalogueLive ? i.proximity.some((p) => p.declared && p.minRangeKm <= RANGE_ACTIVE_KM) || i.coPlanar.some((c) => c.declared) : wireActs.length >= 2)) {
    s = { state: "confirmed", confidence: 0.85, why: `${s.why}; ${i.official > 0 ? "official statement" : "independent tracker"} corroborates` };
  }
  return s;
}
