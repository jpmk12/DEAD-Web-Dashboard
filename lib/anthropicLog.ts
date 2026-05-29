import type { RowDataPacket } from "mysql2";
import { getDb } from "./db";
import { AiUsageRow, AiUsageSummary } from "./types";
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
export async function logCall(opts: {
  route: string;
  model: string;
  usage: AnthropicUsage;
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
         (route, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_micros, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [opts.route, opts.model, input, output, cacheCreation, cacheRead, micros, Date.now()]
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

  return {
    totalMicros: Number(totals[0]?.micros ?? 0),
    totalCalls: Number(totals[0]?.calls ?? 0),
    byRoute: byRoute.map((r) => ({ route: r.route, micros: Number(r.micros), calls: Number(r.calls) })),
    byModel: byModel.map((r) => ({ model: r.model, micros: Number(r.micros), calls: Number(r.calls) })),
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
  // Round-trip the timestamp through the tz and back to UTC to derive offset.
  const inTz = new Date(when.toLocaleString("en-US", { timeZone: tz }));
  const inUtc = new Date(when.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((inTz.getTime() - inUtc.getTime()) / 60_000);
}

export async function getUsageToday(tz: string): Promise<AiUsageSummary> {
  const start = startOfDayMs(tz, 0);
  return summaryBetween(start, Date.now());
}

export async function getUsageLastNDays(tz: string, n: number): Promise<AiUsageSummary> {
  const start = startOfDayMs(tz, n - 1);
  return summaryBetween(start, Date.now());
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
