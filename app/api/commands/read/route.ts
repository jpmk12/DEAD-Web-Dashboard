import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normEmail } from "@/lib/allowlist";
import { anthropic } from "@/lib/claude";
import { logCall } from "@/lib/anthropicLog";
import { getUserPrefs } from "@/lib/userPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { getCommandBoard } from "@/lib/commandsAssemble";

export const dynamic = "force-dynamic";

// "✦ Read (AI)" beside the primer — a model call ONLY on tap (the AI-spend
// rule; same as the Mobility read and the Demand read). It is handed the
// DETERMINISTIC board and primer, not raw feeds, and asked for the drill
// order with the reason; it may disagree with the primer and say why. Cached
// 15 min per board fingerprint so a second tap is free.
const TTL = 15 * 60 * 1000;
let cache: { key: string; text: string; expires: number } | null = null;

export async function POST() {
  const session = await auth();
  const email = normEmail(session?.user?.email);
  if (!session?.accessToken || !email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ text: "", disabled: true });
  const prefs = await getUserPrefs(email).catch(() => null);
  if (prefs && !isFeatureEnabled("chat", prefs)) return NextResponse.json({ text: "", disabled: true });

  const body = await getCommandBoard(email).catch(() => null);
  if (!body) return NextResponse.json({ error: "board unavailable" }, { status: 502 });

  const rows = body.board.rows.map((r) =>
    `${r.star ? "★ " : ""}${r.label}: I&W ${r.iw ? `${r.iw.level.toUpperCase()} ${r.iw.anomaly >= 0 ? "+" : ""}${r.iw.anomaly.toFixed(2)} ${r.iw.trajectory}${r.iw.learning ? " (learning)" : ""}` : "no board"}; posture ${r.posture.red} red / ${r.posture.amber} amber / ${r.posture.unknown} unknown of ${r.posture.watched}${r.posture.escalated ? ` (${r.posture.escalated} escalated today)` : ""}; bases ${r.bases.count}${r.bases.red ? ` (${r.bases.red} red)` : ""}${r.bases.worse ? ` (${r.bases.worse} worse than yesterday)` : ""}; demand ${r.demand ? `${r.demand.direction.toUpperCase()} ${r.demand.score >= 0 ? "+" : ""}${r.demand.score} ${r.demand.confidence}` : "n/a"}; events 24h ${r.events.total} (${r.events.kinetic} kinetic, ${r.events.neo} NEO); since last look ${r.delta.worse} worse / ${r.delta.better} better — ${r.why}`);
  const primerLines = body.primer.items.map((p, i) => `${i + 1}. ${p.subject} ${p.text} [${p.note}] ${p.doorLabel}`);
  const key = rows.join("|") + "||" + primerLines.join("|");
  if (cache && cache.key === key && cache.expires > Date.now()) return NextResponse.json({ text: cache.text, cached: true });

  const prompt = `You are the ops analyst for a C-17 squadron's operations officer, reading the dashboard's own deterministic command board (one line per combatant command) and its ranked "where to look first" primer. Tell the officer the DRILL ORDER for the next ten minutes and why — which command, which country or airfield, what to look at there. You may disagree with the primer's order; if you do, say why in one clause. Treat UNKNOWN as a blind spot, never as clear. Treat "learning" boards as uncalibrated. No preamble. <=150 words. Format EXACTLY:

FIRST: <command › country/airfield — why — what to check>
THEN: <second — why>
THEN: <third — why>
QUIET: <commands with nothing to say, and the one caveat about them>

COMMAND BOARD:
${rows.join("\n")}

PRIMER (deterministic ranking):
${primerLines.length ? primerLines.join("\n") : "(nothing to drill into first)"}
${body.primer.footer ? `FOOTER: ${body.primer.footer}` : ""}`;

  try {
    const modelStart = Date.now();
    const resp = await anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 480, messages: [{ role: "user", content: prompt }] }, { timeout: 60_000, maxRetries: 1 });
    logCall({ route: "commands_read", model: "claude-sonnet-4-6", usage: resp.usage, durationMs: Date.now() - modelStart, user: email }).catch(() => {});
    const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
    cache = { key, text, expires: Date.now() + TTL };
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 502 });
  }
}
