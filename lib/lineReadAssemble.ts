// The line reads, server-only (docs/PLAN-MISSION-OBJECT.md §4): the lines in
// the horizon joined to readings the app already keeps — SITREP assemblies
// (10-min cache), force posture (forceProtectionCached), the TAF outlook
// (30-min cache) and OurAirports runway capability (24-h cache). No new
// fetch, no model call. Every family is bounded (`within`) and a dead one is
// NAMED on every read, never implied clear. Follows the latency rule: a
// cold pass answers what settled within the wait.

import { getUserPrefs } from "./userPrefs";
import { listLines } from "./missionLineStore";
import { linesInHorizon, todayZulu, addDaysYmd, LINE_HORIZON_DAYS, type MissionLine } from "./missionLines";
import { readLine, linesByCommand, type LineRead, type LineFieldInput, type LineCommandSummary } from "./lineRead";
import { classifyAor, type Aor } from "./aor";
import { getDemandHorizonBounded } from "./demandAssemble";
import { assembleSitrep, sitrepSummary } from "./sitrep";
import { getForceProtectionCached } from "./forceProtectionCached";
import { getTafOutlook } from "./aviationWx";
import { airfieldCapabilities } from "./ourAirports";
import { normalizeCountryName, sameCountry } from "./countryNames";
import { resolveAirfield } from "./resolveAirfield";

export interface LineReadsBody {
  today: string;
  horizonDays: number;
  /** The horizon's last day (inclusive). */
  lastDay: string;
  /** NULL when the store did not answer — UNAVAILABLE, never "no lines". */
  lines: MissionLine[] | null;
  reads: LineRead[];
  /** The reads folded per command — only commands with a line appear. */
  byCommand: Record<string, LineCommandSummary>;
  /** Source families that did not answer this pass. */
  unavailable: string[];
  atISO: string;
}

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p.catch(() => null), new Promise<null>((r) => { t = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(t)) as Promise<T | null>;
}

const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; body: LineReadsBody } | null = null;
let inflight: Promise<LineReadsBody> | null = null;

export function resetLineReadsCache(): void { cache = null; }

export async function getLineReads(opts: { maxWaitMs?: number; force?: boolean } = {}): Promise<LineReadsBody> {
  const wait = opts.maxWaitMs ?? 8_000;
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.body;
  if (!inflight) inflight = assemble(wait).then((b) => { cache = { at: Date.now(), body: b }; return b; }).finally(() => { inflight = null; });
  return inflight;
}

async function assemble(wait: number): Promise<LineReadsBody> {
  const atISO = new Date().toISOString();
  const today = todayZulu();
  const lastDay = addDaysYmd(today, LINE_HORIZON_DAYS - 1);
  const lines = await listLines(today, lastDay);
  const active = lines ? linesInHorizon(lines, today) : [];
  const empty: LineReadsBody = { today, horizonDays: LINE_HORIZON_DAYS, lastDay, lines, reads: [], byCommand: {}, unavailable: [], atISO };
  if (!active.length) return empty;

  const icaos = Array.from(new Set(active.flatMap((l) => l.fields)));
  const prefs = await within(getUserPrefs(), 3_000);
  const slots = new Map((prefs?.sitrepBases ?? []).map((b) => [b.icao.toUpperCase(), b]));

  // Place every field (country for the posture fallback, command by country
  // then coordinates) — the shared door the Track picker and the SITREP base
  // add use. Unplaceable → no country, no command.
  const placed = new Map<string, { country: string; aor: Aor } | null>();
  await Promise.all(icaos.map(async (icao) => {
    const slot = slots.get(icao);
    if (slot) {
      const country = normalizeCountryName(slot.country) || "";
      placed.set(icao, { country, aor: classifyAor({ lat: slot.lat, lon: slot.lon, name: country }) });
      return;
    }
    const r = await within(resolveAirfield(icao), 4_000);
    const country = r ? normalizeCountryName(r.country) || "" : "";
    placed.set(icao, r ? { country, aor: classifyAor({ lat: r.lat, lon: r.lon, name: country }) } : null);
  }));

  const [sitreps, fp, taf, caps] = await Promise.all([
    within(Promise.all(icaos.filter((i) => slots.has(i)).map(async (i) => {
      const p = await within(assembleSitrep(slots.get(i)!), wait);
      return [i, p] as const;
    })), wait + 500),
    prefs ? within(getForceProtectionCached(prefs.countriesOfInterest ?? [], prefs.forceLocations ?? []), wait) : Promise.resolve(null),
    within(getTafOutlook(icaos, 30), Math.min(wait, 10_000)),
    within(airfieldCapabilities(icaos), Math.min(wait, 10_000)),
  ]);

  const sitrepBy = new Map<string, NonNullable<Awaited<ReturnType<typeof assembleSitrep>>> | null>();
  for (const [i, p] of sitreps ?? []) sitrepBy.set(i, p);
  const sources = { sitrep: sitreps !== null, posture: fp !== null, taf: taf !== null, cap: caps !== null };

  const fieldInput = (icao: string): LineFieldInput => {
    const payload = sitrepBy.get(icao) ?? null;
    const sum = payload ? sitrepSummary(payload) : null;
    const place = placed.get(icao) ?? null;
    let posture: LineFieldInput["posture"] = null;
    if (fp) {
      const own = fp.assessments.find((a) => a.kind === "base" && a.icao?.toUpperCase() === icao);
      const host = !own && place?.country ? fp.assessments.find((a) => a.kind === "country" && sameCountry(a.country, place.country)) : undefined;
      const a = own ?? host;
      if (a) posture = { composite: a.composite, topDriver: a.topDriver, country: a.country, via: own ? "base" : "country" };
    }
    const c = caps?.[icao];
    return {
      icao,
      aor: place?.aor ?? null,
      sitrepSlot: slots.has(icao),
      sitrep: sum ? { status: sum.status, driver: sum.driver, worse: sum.worse, closure: payload?.ops.closure ?? null } : null,
      posture,
      taf: taf?.[icao] ? { worst: taf[icao].worst, fromISO: taf[icao].fromISO } : null,
      cap: c ? { lengthFt: c.lengthFt, surface: c.surface, cls: c.cls } : null,
    };
  };

  const reads = active.map((line) => readLine({
    line: { id: line.id, day: line.day, airframe: line.airframe, fields: line.fields, status: line.status },
    fields: line.fields.map(fieldInput),
    sources,
    today,
  }));
  // The 7-day outlook of each command a line enters — CONTEXT on the line,
  // never a driver. The horizon's own cache answers; a cold one is skipped.
  const demand = await within(getDemandHorizonBounded(3_000), 3_500);
  if (demand && !demand.pending && demand.outlooks.length) {
    const byAor = new Map(demand.outlooks.map((o) => [o.aor, o.direction]));
    for (const r of reads) {
      const ctx = r.commands.filter((a) => byAor.has(a)).map((a) => ({ aor: a, direction: byAor.get(a)! }));
      if (ctx.length) r.outlook = ctx;
    }
  }
  const unavailable = (["sitrep", "posture", "taf", "cap"] as const).filter((k) => !sources[k]).map((k) => ({ sitrep: "SITREP", posture: "force posture", taf: "TAF", cap: "runway capability" })[k]);
  return { today, horizonDays: LINE_HORIZON_DAYS, lastDay, lines, reads, byCommand: linesByCommand(reads), unavailable, atISO };
}

/** Lines per command for the demand card and the crews rule, bounded and
 *  fail-safe: null when the store did not answer, {} when nothing is
 *  declared — either way the callers show nothing extra. */
export async function getLinesByCommandBounded(maxWaitMs = 3_000): Promise<{ byCommand: Record<string, LineCommandSummary>; total: number } | null> {
  const body = await within(getLineReads({ maxWaitMs }), maxWaitMs + 500);
  if (!body || body.lines === null) return null;
  return { byCommand: body.byCommand, total: body.reads.length };
}
