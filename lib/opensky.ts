// OpenSky Network — server-only fetch of anonymous `states/all` for one
// bounding box, rationed. The I&W mobility sensor calls this ONLY when the
// keyless community military mirrors are down (lib/warningSensors) — it is
// the fallback, never the first source, because a state vector carries no
// aircraft type (lib/openskySignals says what that costs). Parsing and the
// credit table live in lib/openskySignals.ts (pure, tested).
//
// Rationing: OpenSky's anonymous tier is 400 credits per day per IP; each
// bbox query costs 1–4 by area. `OPENSKY_DAILY_BUDGET` caps what this
// module will spend in a UTC day (in-process; a deploy resets it, which is
// safe — it can only under-spend), cached 10 min per bbox so a board polled
// every few minutes pays once. Over budget or refused → `live:false` with
// the reason, never a fake empty sky.

import { fetchWithTimeout } from "./fetchTimeout";
import { parseOpenSkyStates, bboxCredits, bboxKey, OPENSKY_DAILY_BUDGET, type Bbox, type OpenSkyState } from "./openskySignals";

export const OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all";

export interface OpenSkyBody {
  live: boolean;
  states: OpenSkyState[];
  reason: string | null;
  /** Credits this call cost (0 on a cache hit or a refusal). */
  credits: number;
  fetchedAt: string;
}

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; body: OpenSkyBody }>();
const inflight = new Map<string, Promise<OpenSkyBody>>();
let budget: { day: string; spent: number } = { day: "", spent: 0 };

export function openSkySpentToday(): { day: string; spent: number; budget: number } {
  const day = new Date().toISOString().slice(0, 10);
  if (budget.day !== day) budget = { day, spent: 0 };
  return { day, spent: budget.spent, budget: OPENSKY_DAILY_BUDGET };
}

export function resetOpenSkyCache(): void { cache.clear(); budget = { day: "", spent: 0 }; }

export async function getOpenSkyStates(bbox: Bbox): Promise<OpenSkyBody> {
  const key = bboxKey(bbox);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.body, credits: 0 };
  const running = inflight.get(key);
  if (running) return running;
  const p = load(bbox).then((b) => { if (b.live) cache.set(key, { at: Date.now(), body: b }); return b; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function load(bbox: Bbox): Promise<OpenSkyBody> {
  const fetchedAt = new Date().toISOString();
  const cost = bboxCredits(bbox);
  const { spent } = openSkySpentToday();
  if (spent + cost > OPENSKY_DAILY_BUDGET) return { live: false, states: [], reason: `daily OpenSky budget spent (${spent}/${OPENSKY_DAILY_BUDGET} credits)`, credits: 0, fetchedAt };
  const u = new URL(OPENSKY_STATES_URL);
  u.searchParams.set("lamin", bbox.latMin.toFixed(3));
  u.searchParams.set("lamax", bbox.latMax.toFixed(3));
  u.searchParams.set("lomin", bbox.lonMin.toFixed(3));
  u.searchParams.set("lomax", bbox.lonMax.toFixed(3));
  try {
    budget.spent += cost;
    const res = await fetchWithTimeout(u.toString(), { headers: { Accept: "application/json", "User-Agent": "DEAD-Dashboard/1.0" }, cache: "no-store" }, 10_000);
    if (res.status === 429) return { live: false, states: [], reason: "OpenSky rate limit (429)", credits: cost, fetchedAt };
    if (!res.ok) return { live: false, states: [], reason: `OpenSky HTTP ${res.status}`, credits: cost, fetchedAt };
    const states = parseOpenSkyStates(await res.json());
    return { live: true, states, reason: null, credits: cost, fetchedAt };
  } catch (e) {
    return { live: false, states: [], reason: e instanceof Error ? e.message : String(e), credits: cost, fetchedAt };
  }
}
