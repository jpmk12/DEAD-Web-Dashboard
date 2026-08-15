import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { anthropic } from "@/lib/claude";
import { getUserPrefs, buildUserContext } from "@/lib/userPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { logCall } from "@/lib/anthropicLog";
import {
  getCachedOsintTriage,
  cacheOsintTriage,
  OsintPriority,
} from "@/lib/osintTriageCache";
import { extractJsonArray } from "@/lib/aiJson";

// Triage the visible OSINT items: each gets a priority + a <60-char reason
// the user can hover/read. The client POSTs the items it's currently showing
// (id + title + summary + feed metadata); the server checks the cache, runs
// Claude on misses, writes back, and returns a map keyed by id.
//
// Per-item cost: ~120 tokens in + ~20 tokens out, so a 60-item batch costs
// roughly $0.01 with claude-haiku-4-5. The cache hash includes user context
// so changing role / topics / watchlist invalidates everything in one shot.

const SYSTEM_PROMPT = `You are an OSINT relevance triage assistant. You will receive a JSON array of feed items.
For each item, return a JSON array with one object per item containing exactly these fields:
  - "id": the exact item id from the input (do not modify)
  - "priority": one of "High", "Medium", or "Low"
  - "reason": a SHORT phrase (max 60 characters) explaining the call — focus on which topic / keyword / region triggered it

Priority scoring rules:
  - High: directly relevant to the user's role / priority topics / watchlist; OR a major geopolitical event (active conflict, major political shift, significant defense / aerospace news); OR concerns the user's local AOR.
  - Medium: indirect relevance; useful background context; sector trends touching the user's stated interests; analyses worth reading even if not urgent.
  - Low: routine reporting unrelated to the user's interests; opinion / commentary far from stated topics; lifestyle / entertainment; non-substantive social posts.

Personalisation:
  - When an item touches a Priority topic or Watchlist term in title or summary, bias High unless it's pure rumour with no source.
  - When an item primarily concerns a Deprioritise topic, bias Low unless it's a major breaking event.
  - Aircraft-spotting / ship-spotting noise without context = Low; same with named hardware in the user's AOR = High.

Return ONLY the JSON array with no markdown fences, no explanation, no preamble.`;

interface InputItem {
  id: string;
  title: string;
  summary: string;
  feedKind: string;
  feedLabel: string;
}
interface TriageResult { id: string; priority: OsintPriority; reason: string }

const VALID_PRIORITIES = new Set<OsintPriority>(["High", "Medium", "Low"]);
function isValidTriage(c: unknown): c is TriageResult {
  if (!c || typeof c !== "object") return false;
  const r = c as { id?: unknown; priority?: unknown; reason?: unknown };
  return (
    typeof r.id === "string" && r.id.length > 0 &&
    typeof r.priority === "string" && VALID_PRIORITIES.has(r.priority as OsintPriority) &&
    typeof r.reason === "string"
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ triage: {} }, { status: 401 });

  let body: { items?: InputItem[] } = {};
  try { body = await req.json(); } catch { /* empty body → empty triage */ }
  const items = Array.isArray(body.items) ? body.items.slice(0, 120) : [];
  if (items.length === 0) return NextResponse.json({ triage: {} });

  const prefs = await getUserPrefs();
  const userContext = prefs ? buildUserContext(prefs) : "";
  const systemText = SYSTEM_PROMPT + userContext;
  const promptHash = createHash("sha256").update(systemText).digest("hex").slice(0, 16);

  // Cache lookup
  let cached = new Map<string, { priority: OsintPriority; reason: string }>();
  try {
    cached = await getCachedOsintTriage(items.map((i) => i.id), promptHash);
  } catch (err) {
    console.error("OSINT triage cache read failed:", err);
  }

  const uncached = items.filter((i) => !cached.has(i.id));
  const fresh = new Map<string, { priority: OsintPriority; reason: string }>();

  if (uncached.length > 0 && isFeatureEnabled("osint_triage", prefs)) {
    try {
      const modelStart = Date.now();
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        system: [{ type: "text" as const, text: systemText, cache_control: { type: "ephemeral" as const } }],
        messages: [
          {
            role: "user",
            content: JSON.stringify(
              uncached.map(({ id, title, summary, feedKind, feedLabel }) => ({
                id,
                title: String(title ?? "").replace(/[\n\r]/g, " ").slice(0, 240),
                summary: String(summary ?? "").replace(/[\n\r]/g, " ").slice(0, 320),
                feed: String(feedLabel ?? "").slice(0, 80),
                kind: String(feedKind ?? "").slice(0, 24),
              }))
            ),
          },
        ],
      });

      logCall({ route: "osint_triage", model: "claude-haiku-4-5", usage: response.usage, durationMs: Date.now() - modelStart, user: normEmail(session.user?.email) }).catch(() => {});

      const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
      // Strip ```json fences / prose the model sometimes adds before parsing.
      const parsedRaw: unknown = JSON.parse(extractJsonArray(raw));
      const parsed = Array.isArray(parsedRaw) ? parsedRaw.filter(isValidTriage) : [];
      for (const c of parsed) fresh.set(c.id, { priority: c.priority, reason: c.reason });

      const toCache = uncached
        .filter((i) => fresh.has(i.id))
        .map((i) => ({
          id: i.id,
          priority: fresh.get(i.id)!.priority,
          reason: fresh.get(i.id)!.reason,
          promptHash,
        }));
      cacheOsintTriage(toCache).catch((err) =>
        console.error("OSINT triage cache write failed:", err),
      );
    } catch (err) {
      console.error("OSINT triage failed:", err);
      // Items not classified this turn just won't appear in the triage map;
      // the client falls back to a neutral display.
    }
  }

  // Merge cache ∪ fresh into the response shape.
  const triage: Record<string, { priority: OsintPriority; reason: string }> = {};
  for (const i of items) {
    const hit = cached.get(i.id) ?? fresh.get(i.id);
    if (hit) triage[i.id] = hit;
  }
  return NextResponse.json({ triage });
}
