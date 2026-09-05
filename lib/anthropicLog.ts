import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { AiUsageRow, AiUsageSummary, AiUsageDay } from "./types";
import { costMicrosFor } from "./aiFeatures";

interface UsageRow extends RowDataPacket {
  id: number;
  route: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_micros: string | number; // BIGINT can come back as string from mysql2
  created_at: string | number;
}

// Anthropic usage shape — what response.usage looks like from the SDK.
// Cache fields are optional and only present on cached calls.
export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

// Write one usage row. Fire-and-forget at every call site so a logging
// failure can never break the user-facing response.
// durationMs = wall time of the model call itself; assemblyMs = upstream
// data-assembly time before the call (only where the route measures it).
// Both optional so existing call sites keep working unchanged.
export async function logCall(opts: {
  route: string;
  model: string;
  usage: AnthropicUsage;
  durationMs?: number;
  assemblyMs?: number;
  user?: string;      // session email for per-user cost attribution ('' = unattributed/shared)
}): Promise<void> {
  const input  = opts.usage.input_tokens  ?? 0;
  const output = opts.usage.output_tokens ?? 0;
  const cacheCreation = opts.usage.cache_creation_input_tokens ?? 0;
  const cacheRead     = opts.usage.cache_read_input_tokens     ?? 0;
  const micros = costMicrosFor(opts.model, { input, output, cacheCreation, cacheRead });

  try {
    const pool = await getDb();
    await pool.execute(
      `INSERT INTO anthropic_usage
         (route, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_micros, created_at, duration_ms, assembly_ms, user_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [opts.route, opts.model, input, output, cacheCreation, cacheRead, micros, Date.now(),
       Number.isFinite(opts.durationMs) ? Math.round(opts.durationMs!) : null,
       Number.isFinite(opts.assemblyMs) ? Math.round(opts.assemblyMs!) : null,
       (opts.user ?? "").toLowerCase()]
    );
  } catch (err) {
    console.error("anthropic_usage insert failed:", err);
  }
}

// Convert ms-epoch start/end into a summary for the UI.
async function summaryBetween(startMs: number, endMs: number): Promise<AiUsageSummary> {
  const pool = await getDb();
  const [totals] = await pool.query<(RowDataPacket & { calls: number; micros: string })[]>(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(cost_micros), 0) AS micros
     FROM anthropic_usage WHERE created_at >= ? AND created_at < ?`,
    [startMs, endMs]
  );
  const [byRoute] = await pool.query<(RowDataPacket & { route: string; calls: number; micros: string })[]>(
    `SELECT route, COUNT(*) AS calls, COALESCE(SUM(cost_micros), 0) AS micros
     FROM anthropic_usage WHERE created_at >= ? AND created_at < ?
     GROUP BY route ORDER BY micros DESC`,
    [startMs, endMs]
  );
  const [byModel] = await pool.query<(RowDataPacket & { model: string; calls: number; micros: string })[]>(
    `SELECT model, COUNT(*) AS calls, COALESCE(SUM(cost_micros), 0) AS micros
     FROM anthropic_usage WHERE created_at >= ? AND created_at < ?
     GROUP BY model ORDER BY micros DESC`,
    [startMs, endMs]
  );
  // Latency percentiles per route, computed in JS (managed MySQL lacks a
  // percentile aggregate). Single-user volume keeps the row count small;
  // duration_ms is NULL for rows written before instrumentation and for
  // streaming routes, both of which are simply skipped.
  const [durRows] = await pool.query<(RowDataPacket & { route: string; duration_ms: number })[]>(
    `SELECT route, duration_ms FROM anthropic_usage
     WHERE created_at >= ? AND created_at < ? AND duration_ms IS NOT NULL`,
    [startMs, endMs]
  );
  const byRouteDur = new Map<string, number[]>();
  for (const r of durRows) {
    if (!byRouteDur.has(r.route)) byRouteDur.set(r.route, []);
    byRouteDur.get(r.route)!.push(Number(r.duration_ms));
  }
  const pct = (sorted: number[], p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  const latency = (route: string): { p50Ms?: number; p95Ms?: number } => {
    const xs = byRouteDur.get(route);
    if (!xs || xs.length === 0) return {};
    xs.sort((a, b) => a - b);
    return { p50Ms: pct(xs, 50), p95Ms: pct(xs, 95) };
  };

  // Per-user attribution (multi-user phase 1). Rows logged before the split
  // or from shared/background routes carry '' and report as "shared".
  const [byUser] = await pool.query<(RowDataPacket & { user_email: string; calls: number; micros: string })[]>(
    `SELECT user_email, COUNT(*) AS calls, COALESCE(SUM(cost_micros), 0) AS micros
     FROM anthropic_usage WHERE created_at >= ? AND created_at < ?
     GROUP BY user_email ORDER BY micros DESC`,
    [startMs, endMs]
  );

  return {
    totalMicros: Number(totals[0]?.micros ?? 0),
    totalCalls: Number(totals[0]?.calls ?? 0),
    byRoute: byRoute.map((r) => ({ route: r.route, micros: Number(r.micros), calls: Number(r.calls), ...latency(r.route) })),
    byModel: byModel.map((r) => ({ model: r.model, micros: Number(r.micros), calls: Number(r.calls) })),
    byUser: byUser.map((r) => ({ user: r.user_email || "shared", micros: Number(r.micros), calls: Number(r.calls) })),
  };
}

// Resolve "midnight in the user's timezone, N days ago" → ms epoch.
// Get the YYYY-MM-DD string for the target day in tz, then parse it back as
// midnight in that tz using its UTC offset at that instant.
function startOfDayMs(tz: string, daysAgo: number = 0): number {
  const target = new Date(Date.now() - daysAgo * 86_400_000);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(target);
  // Construct "YYYY-MM-DDT00:00:00" in the target tz by appending the offset.
  // We compute the offset by comparing "now" formatted in tz vs UTC.
  const offsetMin = tzOffsetMinutes(tz, target);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return Date.parse(`${ymd}T00:00:00${sign}${hh}:${mm}`);
}

function tzOffsetMinutes(tz: string, when: Date): number {
  // Use the IANA timeZoneName "longOffset" formatter, which returns an exact
  // "GMT±HH:MM" string for the given instant. Survives DST transitions cleanly
  // — the previous round-trip approach via toLocaleString/Date.parse was off
  // by ~1 hour during the first/last record of a DST-changing day, because
  // the local server tz and the target tz could disagree about whether DST
  // applies at that instant.
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(when);
    const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = off.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    const sign = m[1] === "+" ? 1 : -1;
    return sign * (Number(m[2]) * 60 + Number(m[3]));
  } catch {
    return 0;
  }
}

export async function getUsageToday(tz: string): Promise<AiUsageSummary> {
  const start = startOfDayMs(tz, 0);
  return summaryBetween(start, Date.now());
}

export async function getUsageLastNDays(tz: string, n: number): Promise<AiUsageSummary> {
  const start = startOfDayMs(tz, n - 1);
  return summaryBetween(start, Date.now());
}

// Midnight on the 1st of the current month, in the user's timezone.
function startOfMonthMs(tz: string): number {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const first = `${ymd.slice(0, 7)}-01`;
  const offsetMin = tzOffsetMinutes(tz, new Date(`${first}T12:00:00Z`));
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return Date.parse(`${first}T00:00:00${sign}${hh}:${mm}`);
}

// Month-to-date spend. This is the number that matches an Anthropic Console
// MONTHLY spend threshold — "today" and "last 30 days" both answer a different
// question, and comparing either one against a monthly alert is how a routine
// accumulation gets mistaken for a spike.
export async function getUsageMonthToDate(tz: string): Promise<AiUsageSummary> {
  return summaryBetween(startOfMonthMs(tz), Date.now());
}

// Per-day spend for the last n days, oldest first, with the day's biggest
// route named. Answers "which day changed, and what changed on it" — the
// aggregates alone can't distinguish a steady rate from one expensive day.
export async function getUsageByDay(tz: string, n: number): Promise<AiUsageDay[]> {
  const pool = await getDb();
  const start = startOfDayMs(tz, n - 1);
  const [rows] = await pool.query<(RowDataPacket & {
    route: string; micros: string; calls: number; created_at: string | number;
  })[]>(
    `SELECT route, cost_micros AS micros, created_at
     FROM anthropic_usage WHERE created_at >= ?`,
    [start]
  );

  // Bucket in JS: the day label must be resolved in the user's timezone, which
  // MySQL's DATE() can't do without a named-zone table being loaded.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const byDay = new Map<string, { micros: number; calls: number; routes: Map<string, number> }>();
  for (const r of rows) {
    const day = fmt.format(new Date(Number(r.created_at)));
    let e = byDay.get(day);
    if (!e) { e = { micros: 0, calls: 0, routes: new Map() }; byDay.set(day, e); }
    const m = Number(r.micros) || 0;
    e.micros += m;
    e.calls += 1;
    e.routes.set(r.route, (e.routes.get(r.route) ?? 0) + m);
  }

  return Array.from(byDay.entries())
    .map(([day, e]) => ({
      day,
      micros: e.micros,
      calls: e.calls,
      topRoute: Array.from(e.routes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// Best-effort prune so the table doesn't grow unbounded. Keep 90 days of
// detail; older rows are summarised away (rough monthly retention is enough
// for the dashboard's purposes).
export async function pruneOldUsage(): Promise<void> {
  const cutoff = Date.now() - 90 * 86_400_000;
  try {
    const pool = await getDb();
    await pool.execute("DELETE FROM anthropic_usage WHERE created_at < ?", [cutoff]);
  } catch (err) {
    console.error("anthropic_usage prune failed:", err);
  }
}

// Detailed row dump for diagnostics (rarely used by UI).
export async function recentUsageRows(n: number = 50): Promise<AiUsageRow[]> {
  const pool = await getDb();
  const [rows] = await pool.query<UsageRow[]>(
    "SELECT id, route, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_micros, created_at FROM anthropic_usage ORDER BY created_at DESC LIMIT ?",
    [n]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    route: r.route,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationTokens: r.cache_creation_tokens,
    cacheReadTokens: r.cache_read_tokens,
    costMicros: Number(r.cost_micros),
    createdAt: Number(r.created_at),
  }));
}
