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
const MAX_TERMS_PER_ITEM = 10;
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
  await pool.execute("DELETE FROM signal_daily_counts WHERE date < ?", [countCutoff]).catch(() => {});
  await pool.execute("DELETE FROM signal_seen WHERE date < ?", [seenCutoff]).catch(() => {});
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
    await maybePrune(pool);
  } catch (err) {
    console.error("[trends] record failed:", err);
  }
}

// ── Velocity read ────────────────────────────────────────────────────────────

export interface MoverRow { kind: SignalKind; term: string; cur: number; prev: number }
export type MoverState = "new" | "rising" | "fading" | "steady";
export interface TrendMover extends MoverRow { state: MoverState; score: number }

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

export async function getTrendMovers(opts: { kinds?: SignalKind[]; limit?: number } = {}): Promise<TrendMover[]> {
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
    return classifyMovers(
      rows.map((r) => ({ kind: r.kind, term: r.term, cur: Number(r.cur), prev: Number(r.prev) })),
    ).slice(0, limit);
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
  return interesting
    .map((m) => `${m.state.toUpperCase()} ${m.kind} "${m.term}" — ${m.cur} mentions this week vs ${m.prev} last week`)
    .join("\n");
}
