// Trend sensing (NEXT-LEVEL-PLAN P1): a deterministic, zero-AI counting layer
// over the public-source items the app already fetches. Recorder hooks in the
// news / OSINT / crisis paths call recordDailySignals() fire-and-forget; the
// velocity read (getTrendMovers) compares the last 7 days against the prior 7
// in SQL and classifies movers in pure TS so the math is unit-testable.
//
// Privacy boundary: only public-source items (news, OSINT feeds, crisis data)
// are recorded — never email-derived terms. This table has 180-day retention;
// inbox content does not belong in it.
//
// Dates are UTC. Trend windows are 7-day aggregates, where a few boundary
// hours don't change a rising/fading call, and UTC avoids a prefs lookup on
// every recorded item.

import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { extractKeywords } from "./articlePrefs";

export type SignalKind = "topic" | "category" | "watch" | "region" | "aor" | "label";
export interface SignalTerm { kind: SignalKind; term: string }
export interface SignalItem { id: string; terms: SignalTerm[] }

const COUNT_RETENTION_D = 180;
const SEEN_RETENTION_D = 14;
const PAIR_RETENTION_D = 90;
const MAX_TERMS_PER_ITEM = 10;
const MAX_PAIRS_PER_ITEM = 15;
const MAX_ITEMS_PER_CALL = 500;

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
export function utcDate(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function cleanTerm(t: string): string {
  return t.trim().toLowerCase().slice(0, 120);
}

// ── Term builders (so recorder hooks stay one-liners) ───────────────────────

export function topicTerms(title: string, max = 6): SignalTerm[] {
  const seen = new Set<string>();
  const out: SignalTerm[] = [];
  for (const w of extractKeywords(title)) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push({ kind: "topic", term: w });
    if (out.length >= max) break;
  }
  return out;
}

export function watchTermsIn(text: string, watchlist: string[]): SignalTerm[] {
  const hay = text.toLowerCase();
  const out: SignalTerm[] = [];
  for (const w of watchlist) {
    const t = w.trim().toLowerCase();
    if (t.length >= 2 && hay.includes(t)) out.push({ kind: "watch", term: cleanTerm(t) });
  }
  return out;
}

// ── Recorder ─────────────────────────────────────────────────────────────────

// Module-level prune throttle: once per process per UTC day is plenty.
let lastPruneDate = "";

async function maybePrune(pool: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const today = utcDate();
  if (lastPruneDate === today) return;
  lastPruneDate = today;
  const countCutoff = utcDate(Date.now() - COUNT_RETENTION_D * 86_400_000);
  const seenCutoff = utcDate(Date.now() - SEEN_RETENTION_D * 86_400_000);
  const pairCutoff = utcDate(Date.now() - PAIR_RETENTION_D * 86_400_000);
  await pool.execute("DELETE FROM signal_daily_counts WHERE date < ?", [countCutoff]).catch(() => {});
  await pool.execute("DELETE FROM signal_seen WHERE date < ?", [seenCutoff]).catch(() => {});
  await pool.execute("DELETE FROM signal_pair_daily WHERE date < ?", [pairCutoff]).catch(() => {});
}

// ── Pairs (PURE builder) ─────────────────────────────────────────────────────
// watch×topic and region×topic co-occurrences within ONE item. A pair key is
// "kind|term"; `a` is the watch/region side so a row reads "your term X was
// paired with topic Y". Capped per item so a long title cannot flood the table.
export function pairTermsOf(terms: SignalTerm[], max = MAX_PAIRS_PER_ITEM): { a: string; b: string }[] {
  const anchors = terms.filter((t) => t.kind === "watch" || t.kind === "region").map((t) => `${t.kind}|${cleanTerm(t.term)}`);
  const topics = terms.filter((t) => t.kind === "topic").map((t) => `topic|${cleanTerm(t.term)}`);
  const out: { a: string; b: string }[] = [];
  const seen = new Set<string>();
  for (const a of anchors) {
    for (const b of topics) {
      if (a.split("|")[1] === b.split("|")[1]) continue;      // the watch term itself is not a pairing
      const k = `${a}\u0000${b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ a, b });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// Count each item's terms exactly once, ever (the signal_seen ledger absorbs
// the 90 s polling re-fetches). Never throws — a recorder fault must not be
// able to break a user-facing response.
export async function recordDailySignals(items: SignalItem[]): Promise<void> {
  try {
    const batch = items.slice(0, MAX_ITEMS_PER_CALL).filter((it) => it.id && it.terms.length > 0);
    if (batch.length === 0) return;
    const date = utcDate();
    const pool = await getDb();

    const hashes = batch.map((it) => sha(it.id));
    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM signal_seen WHERE id IN (${hashes.map(() => "?").join(",")})`,
      hashes,
    );
    const seen = new Set(existing.map((r) => String(r.id)));
    const fresh = batch
      .map((it, i) => ({ hash: hashes[i], terms: it.terms }))
      .filter((f) => !seen.has(f.hash));
    if (fresh.length === 0) { await maybePrune(pool); return; }

    // INSERT IGNORE guards the race between the SELECT above and concurrent
    // recorder calls (two routes can see the same item in the same minute).
    const [ins] = await pool.query<import("mysql2").ResultSetHeader[]>(
      `INSERT IGNORE INTO signal_seen (id, date) VALUES ${fresh.map(() => "(?,?)").join(",")}`,
      fresh.flatMap((f) => [f.hash, date]),
    );
    // If another call won the race for every row, count nothing.
    const inserted = (ins as unknown as { affectedRows?: number }).affectedRows ?? fresh.length;
    if (inserted === 0) { await maybePrune(pool); return; }

    const agg = new Map<string, { kind: SignalKind; term: string; n: number }>();
    for (const f of fresh) {
      for (const t of f.terms.slice(0, MAX_TERMS_PER_ITEM)) {
        const term = cleanTerm(t.term);
        if (!term) continue;
        const key = `${t.kind}|${term}`;
        const cur = agg.get(key);
        if (cur) cur.n += 1;
        else agg.set(key, { kind: t.kind, term, n: 1 });
      }
    }
    if (agg.size > 0) {
      const rows = Array.from(agg.values());
      await pool.query(
        `INSERT INTO signal_daily_counts (date, kind, term, count)
         VALUES ${rows.map(() => "(?,?,?,?)").join(",")}
         ON DUPLICATE KEY UPDATE count = count + VALUES(count)`,
        rows.flatMap((r) => [date, r.kind, r.term, r.n]),
      );
    }
    // Pairs ride the same fresh set (PLAN §7 E3).
    const pairAgg = new Map<string, { a: string; b: string; n: number }>();
    for (const f of fresh) {
      for (const p of pairTermsOf(f.terms)) {
        const k = `${p.a}\u0000${p.b}`;
        const cur = pairAgg.get(k);
        if (cur) cur.n += 1; else pairAgg.set(k, { ...p, n: 1 });
      }
    }
    if (pairAgg.size > 0) {
      const rows = Array.from(pairAgg.values()).slice(0, 2000);
      await pool.query(
        `INSERT INTO signal_pair_daily (date, a, b, count)
         VALUES ${rows.map(() => "(?,?,?,?)").join(",")}
         ON DUPLICATE KEY UPDATE count = count + VALUES(count)`,
        rows.flatMap((r) => [date, r.a.slice(0, 140), r.b.slice(0, 140), r.n]),
      ).catch(() => {});
    }
    await maybePrune(pool);
  } catch (err) {
    console.error("[trends] record failed:", err);
  }
}

// ── Velocity read ────────────────────────────────────────────────────────────

export interface MoverRow { kind: SignalKind; term: string; cur: number; prev: number }
export type MoverState = "new" | "rising" | "fading" | "steady";
export interface TrendMover extends MoverRow {
  state: MoverState;
  score: number;
  /** This week's mentions above every prior 7-day window in the last 90 days
   *  (PLAN §7 E3); absent when not asked for or below HIGH_MIN_WEEKS of history. */
  high90?: boolean;
}

// ── Long-window high (PURE) ──────────────────────────────────────────────────
// The table keeps 180 days but the read was 7-vs-7. `rollingHigh` compares
// this week's sum with the max of the prior non-overlapping 7-day windows in
// the trailing `windowDays`, and only once HIGH_MIN_WEEKS of history exist
// for the term — a term first seen a fortnight ago is at its "90-day high"
// every week, which is noise.
export const HIGH_MIN_WEEKS = 5;

export function rollingHigh(counts: { date: string; count: number }[], today: string, windowDays = 90): { cur7: number; priorMax7: number | null; isHigh: boolean | null } {
  const byDate = new Map<string, number>();
  let earliest: string | null = null;
  for (const c of counts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) continue;
    byDate.set(c.date, (byDate.get(c.date) ?? 0) + Math.max(0, c.count));
    if (!earliest || c.date < earliest) earliest = c.date;
  }
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const sum = (endBack: number) => {
    let s = 0;
    for (let i = 0; i < 7; i++) s += byDate.get(new Date(t0 - (endBack + i) * 86_400_000).toISOString().slice(0, 10)) ?? 0;
    return s;
  };
  const cur7 = sum(0);
  const weeks = Math.floor(windowDays / 7);
  const ageDays = earliest ? Math.round((t0 - Date.parse(`${earliest}T00:00:00Z`)) / 86_400_000) : 0;
  if (!earliest || ageDays < HIGH_MIN_WEEKS * 7 - 1) return { cur7, priorMax7: null, isHigh: null };
  let priorMax7 = 0;
  for (let k = 1; k < weeks; k++) {
    if (k * 7 > ageDays + 6) break;                         // window predates the term's history
    priorMax7 = Math.max(priorMax7, sum(k * 7));
  }
  return { cur7, priorMax7, isHigh: cur7 > priorMax7 };
}

// ── New pairs (PURE) ─────────────────────────────────────────────────────────
export interface PairRow { date: string; a: string; b: string; count: number }
export interface NewPair { a: string; b: string; thisWeek: number; label: string }
export const PAIR_MIN_WEEK = 3;
export const PAIR_QUIET_DAYS = 60;

/** Pairs seen ≥PAIR_MIN_WEEK times in the last 7 days and never in the
 *  PAIR_QUIET_DAYS before that — a co-occurrence that is genuinely new. */
export function newPairs(rows: PairRow[], today: string): NewPair[] {
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const weekStart = new Date(t0 - 6 * 86_400_000).toISOString().slice(0, 10);
  const quietStart = new Date(t0 - (6 + PAIR_QUIET_DAYS) * 86_400_000).toISOString().slice(0, 10);
  const week = new Map<string, number>();
  const before = new Set<string>();
  for (const r of rows) {
    const k = `${r.a}\u0000${r.b}`;
    if (r.date >= weekStart && r.date <= today) week.set(k, (week.get(k) ?? 0) + r.count);
    else if (r.date >= quietStart && r.date < weekStart && r.count > 0) before.add(k);
  }
  const out: NewPair[] = [];
  for (const [k, n] of week) {
    if (n < PAIR_MIN_WEEK || before.has(k)) continue;
    const [a, b] = k.split("\u0000");
    const at = a.split("|")[1] ?? a, bt = b.split("|")[1] ?? b;
    out.push({ a, b, thisWeek: n, label: `"${at}" + "${bt}" together ${n}× this week — first time in ${PAIR_QUIET_DAYS} d` });
  }
  return out.sort((x, y) => y.thisWeek - x.thisWeek || x.a.localeCompare(y.a)).slice(0, 12);
}

export async function getNewPairs(): Promise<NewPair[]> {
  try {
    const pool = await getDb();
    const today = utcDate();
    const cutoff = utcDate(Date.now() - (6 + PAIR_QUIET_DAYS) * 86_400_000);
    const [rows] = await pool.query<(RowDataPacket & { date: string; a: string; b: string; count: number })[]>(
      `SELECT date, a, b, count FROM signal_pair_daily WHERE date >= ?`, [cutoff],
    );
    return newPairs(rows.map((r) => ({ date: String(r.date), a: String(r.a), b: String(r.b), count: Number(r.count) })), today);
  } catch { return []; }
}

// Pure classification — unit-tested independently of the DB.
// cur = mentions in the last 7 days, prev = the 7 days before that.
export function classifyMovers(rows: MoverRow[]): TrendMover[] {
  const out: TrendMover[] = [];
  for (const r of rows) {
    const cur = Math.max(0, r.cur), prev = Math.max(0, r.prev);
    if (cur + prev < 4) continue; // noise floor
    let state: MoverState;
    if (prev === 0 && cur >= 3) state = "new";
    else if (cur >= 4 && cur >= 1.8 * prev) state = "rising";
    else if (prev >= 5 && cur <= prev / 2) state = "fading";
    else state = "steady";
    // Velocity ratio; +1 smoothing so "new" terms don't divide by zero.
    const score = (cur + 1) / (prev + 1);
    out.push({ ...r, cur, prev, state, score });
  }
  const stateRank: Record<MoverState, number> = { new: 0, rising: 0, fading: 1, steady: 2 };
  out.sort((a, b) =>
    stateRank[a.state] - stateRank[b.state] ||
    b.score - a.score ||
    b.cur - a.cur ||
    a.term.localeCompare(b.term));
  return out;
}

export async function getTrendMovers(opts: { kinds?: SignalKind[]; limit?: number; highWater?: boolean } = {}): Promise<TrendMover[]> {
  const kinds = opts.kinds ?? ["topic", "region", "aor", "watch", "label"];
  const limit = opts.limit ?? 24;
  const curStart = utcDate(Date.now() - 6 * 86_400_000);   // last 7 days incl. today
  const prevStart = utcDate(Date.now() - 13 * 86_400_000); // the 7 days before
  try {
    const pool = await getDb();
    const [rows] = await pool.query<(RowDataPacket & { kind: SignalKind; term: string; cur: number; prev: number })[]>(
      `SELECT kind, term,
              SUM(CASE WHEN date >= ? THEN count ELSE 0 END) AS cur,
              SUM(CASE WHEN date <  ? THEN count ELSE 0 END) AS prev
         FROM signal_daily_counts
        WHERE date >= ? AND kind IN (${kinds.map(() => "?").join(",")})
        GROUP BY kind, term`,
      [curStart, curStart, prevStart, ...kinds],
    );
    const movers = classifyMovers(
      rows.map((r) => ({ kind: r.kind, term: r.term, cur: Number(r.cur), prev: Number(r.prev) })),
    ).slice(0, limit);
    // 90-day high, one query for the non-steady movers only (PLAN §7 E3).
    if (opts.highWater) {
      const want = movers.filter((m) => m.state === "new" || m.state === "rising");
      if (want.length) {
        const today = utcDate();
        const since = utcDate(Date.now() - 97 * 86_400_000);
        const [hist] = await pool.query<(RowDataPacket & { kind: string; term: string; date: string; count: number })[]>(
          `SELECT kind, term, date, count FROM signal_daily_counts
            WHERE date >= ? AND (${want.map(() => "(kind = ? AND term = ?)").join(" OR ")})`,
          [since, ...want.flatMap((m) => [m.kind, m.term])],
        );
        const byKey = new Map<string, { date: string; count: number }[]>();
        for (const h of hist) (byKey.get(`${h.kind}|${h.term}`) ?? byKey.set(`${h.kind}|${h.term}`, []).get(`${h.kind}|${h.term}`)!).push({ date: String(h.date), count: Number(h.count) });
        for (const m of want) {
          const r = rollingHigh(byKey.get(`${m.kind}|${m.term}`) ?? [], today, 90);
          if (r.isHigh != null) m.high90 = r.isHigh;
        }
      }
    }
    return movers;
  } catch (err) {
    console.error("[trends] movers query failed:", err);
    return [];
  }
}

// Compact text block for AI prompts (the brief): top non-steady movers as
// one line each. Empty string when there's nothing worth saying — callers
// just omit the section.
export function formatMoversForPrompt(movers: TrendMover[], max = 6): string {
  const interesting = movers.filter((m) => m.state !== "steady").slice(0, max);
  let highs = 0;
  return interesting
    .map((m) => {
      // At most two "90-day high" notes: the brief is prose, not a chart.
      const high = m.high90 && highs < 2 ? (highs++, " (a 90-day high)") : "";
      return `${m.state.toUpperCase()} ${m.kind} "${m.term}" — ${m.cur} mentions this week vs ${m.prev} last week${high}`;
    })
    .join("\n");
}
