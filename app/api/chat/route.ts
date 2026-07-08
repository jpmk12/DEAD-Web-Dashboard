import { anthropic } from "@/lib/claude";
import { auth } from "@/lib/auth";
import { CalendarEvent, ChatMessage, GoogleTask, NewsItem, NewsletterSummary } from "@/lib/types";
import { getUserPrefs, buildUserContext } from "@/lib/userPrefs";
import { getMemory, buildMemoryContext, updateMemoryFromChat } from "@/lib/userMemory";
import { normEmail } from "@/lib/allowlist";
import { getRecentDocsForContext } from "@/lib/documents";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { logCall } from "@/lib/anthropicLog";
import { checkRateLimit } from "@/lib/rateLimit";
import { formatInTz, timeInTz, formatFloatingDate, longDateInTz } from "@/lib/date";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 4000;
const VALID_ROLES = new Set(["user", "assistant"]);

// Event times are rendered in the USER's timezone — without it, formatting falls
// back to the server's tz (UTC in production) and every time is shifted (e.g.
// 08:30 CDT shown as 13:30), which had the assistant misreading the calendar.
function isValidTz(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

function formatEvents(events: CalendarEvent[], tz: string): string {
  if (!events.length) return "No upcoming events found.";
  // Each event gets a [N] handle (1-based, matching the order the client sent)
  // so the assistant can reference a specific one in a MOVE/EDIT/DELETE action.
  return events
    .map((e, i) => {
      const start = e.isAllDay ? formatFloatingDate(e.start) : formatInTz(e.start, tz);
      const end = e.isAllDay ? "" : ` – ${timeInTz(e.end, tz)}`;
      const location = e.location ? ` @ ${String(e.location).slice(0, 80)}` : "";
      const desc = e.description ? ` — ${String(e.description).slice(0, 150)}` : "";
      const acct = e.account ? ` {${e.account}}` : "";
      return `[${i + 1}] ${String(e.title).slice(0, 100)} on ${start}${end}${location}${desc}${acct}`;
    })
    .join("\n");
}

function formatTasks(tasks: GoogleTask[]): string {
  if (!tasks.length) return "No pending tasks.";
  return tasks
    .map((t) => {
      const due = t.due ? ` (due ${t.due.substring(0, 10)})` : "";
      return `• ${String(t.title).slice(0, 100)}${due}`;
    })
    .join("\n");
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!checkRateLimit(`chat:${normEmail(session.user?.email)}`, 2_000)) {
    return new Response("Rate limited — wait 2 s between messages", { status: 429 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 400_000) return new Response("Payload too large", { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return new Response("Invalid request body", { status: 400 });
  }

  const { messages, calendarContext, tasks, articles, newsletters, tz: bodyTz } = body as Record<string, unknown>;

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("messages must be a non-empty array", { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return new Response("Too many messages", { status: 400 });
  }

  const sanitizedMessages: ChatMessage[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") return new Response("Invalid message", { status: 400 });
    const { role, content } = msg as Record<string, unknown>;
    if (!VALID_ROLES.has(role as string)) return new Response("Invalid message role", { status: 400 });
    if (typeof content !== "string" || content.length === 0) return new Response("Invalid message content", { status: 400 });
    sanitizedMessages.push({
      role: role as "user" | "assistant",
      content: content.slice(0, MAX_CONTENT_LENGTH),
    });
  }

  const sanitizedContext: CalendarEvent[] = Array.isArray(calendarContext)
    ? (calendarContext as CalendarEvent[]).slice(0, 50)
    : [];

  const sanitizedTasks: GoogleTask[] = Array.isArray(tasks)
    ? (tasks as GoogleTask[]).slice(0, 50)
    : [];

  const safeArticles = Array.isArray(articles) ? (articles as NewsItem[]).slice(0, 20) : [];
  const safeNewsletters = Array.isArray(newsletters) ? (newsletters as NewsletterSummary[]).slice(0, 10) : [];

  const userEmail = normEmail(session.user?.email);
  const [userPrefs, memory, recentDocs] = await Promise.all([
    getUserPrefs(userEmail),
    getMemory(userEmail).catch(() => null),
    getRecentDocsForContext(5).catch(() => []),
  ]);
  const userContext = buildUserContext(userPrefs);
  const memoryContext = memory ? buildMemoryContext(memory) : "";

  // Surface the 5 most-recently-updated notes as background context so the
  // assistant can reference them when relevant. Cap each at ~800 chars so
  // a verbose note doesn't crowd out the rest of the system block.
  const docsContext = recentDocs.length > 0
    ? "\n\nRecent notes from the user's Docs tab (most recent first; reference by title when relevant):\n" +
      recentDocs.map((d) => `### ${d.title}\n${d.content.slice(0, 800)}`).join("\n\n")
    : "";

  const newsContext = safeArticles.length
    ? "\n\nRecent news the user has been reading:\n" +
      safeArticles.map((a) => `• [${a.source}] ${a.title}`).join("\n")
    : "";

  const newsletterContext = safeNewsletters.length
    ? "\n\nRecent newsletter highlights:\n" +
      safeNewsletters.flatMap((n) => n.bullets.slice(0, 3).map((b) => `• ${b}`)).join("\n")
    : "";

  // Timezone resolution — SAME contract as /api/briefing: "pinned" → the
  // saved pref wins; "auto" (default) → the device zone the client sent wins,
  // so scheduling chat follows where the user actually is (a stale Chicago
  // default was making the assistant second-guess Eastern-time adds).
  const requestTz = typeof bodyTz === "string" && isValidTz(bodyTz) ? bodyTz : "";
  const tz =
    userPrefs.timezoneMode === "pinned"
      ? userPrefs.timezone || requestTz || "America/Chicago"
      : requestTz || userPrefs.timezone || "America/Chicago";
  const today = longDateInTz(tz);

  // The system prompt splits into a cacheable "rules + identity + user
  // preferences + long-term memory" block (stable across turns within a
  // session) and a dynamic per-turn block (calendar / tasks / news /
  // newsletters / today's date / tz). Anthropic prompt caching cuts the
  // input cost of the cacheable block by ~90% on warm reads. With memory +
  // user_context typically running 1-2k tokens, this is a real saving on
  // every chat turn after the first.
  const cacheableBlock = `You are a personal scheduling and productivity assistant.${userContext}${memoryContext}${docsContext}

You can:
- Find free time slots and detect conflicts / double-bookings in the calendar
- Add events to the calendar, and MOVE, EDIT, or DELETE existing ones
- Suggest meeting times, reschedules, and ways to resolve conflicts
- Create tasks and to-do items

Each upcoming calendar event is listed with a [N] handle. To act on an EXISTING event, reference it by that exact handle.

TO ADD A CALENDAR EVENT: When the user asks you to schedule or add something, end your response with this on its own line (valid JSON, always include timeZone using the user's timezone):
[ADD_EVENT:{"summary":"Event title","start":"2026-05-20T10:00:00","end":"2026-05-20T11:00:00","timeZone":"<USER_TZ>"}]

TO MOVE / RESCHEDULE AN EVENT (keep the original duration unless the user says otherwise):
[MOVE_EVENT:{"ref":N,"start":"2026-05-20T14:00:00","end":"2026-05-20T15:00:00","timeZone":"<USER_TZ>"}]

TO EDIT AN EVENT'S DETAILS (any subset of title / location / description):
[EDIT_EVENT:{"ref":N,"summary":"New title","location":"New place"}]

TO DELETE / CANCEL AN EVENT:
[DELETE_EVENT:{"ref":N}]

TO CREATE A TASK: When the user asks you to create a task or reminder, end your response with this on its own line (valid JSON only):
[ADD_TASK:{"title":"Task description","due":"2026-05-20"}]

Rules:
- Only emit an action block when you have enough information — ask first if you need a date/time
- Reference existing events ONLY by the [N] handle shown in the calendar list — never invent an id
- If it's unclear which event the user means (e.g. several could match), ask which one rather than guessing
- When you spot a conflict or double-booking, point it out and offer to move one of them
- The user reviews and confirms every change before it happens, so propose the specific change directly rather than asking "should I?"
- Check for conflicts before suggesting a time slot
- The "due" field for tasks is optional; "description" and "location" for events are also optional
- Include only one action block per response; if several changes are needed, do them one at a time`;

  // Authoritative weekday reference for the next 10 weeks. LLMs are unreliable
  // at calendar arithmetic: when the user types a bare date ("14 Jul 0800")
  // the model would otherwise derive the weekday itself and sometimes get it
  // wrong (announcing a Tuesday event as "Sunday") even while the calendar add
  // lands correctly. Event-context lines already carry computed weekdays; this
  // table covers NEW dates the user mentions. ~400 tokens, correctness-critical.
  const weekdayTable = (() => {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const rows: string[] = [];
    for (let d = 0; d < 70; d++) {
      const t = new Date(Date.now() + d * 86_400_000);
      rows.push(`${fmt.format(t)}=${wd.format(t)}`);
    }
    return rows.join(" ");
  })();

  const dynamicBlock = `Today is ${today}. User's timezone: ${tz}.

DATE→WEEKDAY REFERENCE (next 70 days, ${tz}). NEVER compute a weekday yourself — when you state a weekday for ANY date, look it up here or in the calendar lines below; if a date is outside this table, omit the weekday rather than guessing:
${weekdayTable}

USER'S UPCOMING CALENDAR:
${formatEvents(sanitizedContext, tz)}

USER'S PENDING TASKS:
${formatTasks(sanitizedTasks)}${newsContext}${newsletterContext}`;

  // AI feature gate. Returns a one-chunk stream so the client doesn't need
  // to know about a different response shape.
  if (!isFeatureEnabled("chat", userPrefs)) {
    const msg = "Chat is disabled in Preferences → AI Controls. Toggle it back on (or flip the master switch) to resume.";
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(msg));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const stream = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2048,
    stream: true,
    system: [
      { type: "text" as const, text: cacheableBlock, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: dynamicBlock },
    ],
    messages: sanitizedMessages.map((m) => ({ role: m.role, content: m.content })),
  }).catch((err: unknown) => {
    if (isOverloaded(err)) return null;
    throw err;
  });

  if (!stream) {
    return new Response("The AI is temporarily busy — please try again in a moment.", { status: 503 });
  }

  const readableStream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let assistantText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreation = 0;
      let cacheRead = 0;
      try {
        for await (const chunk of stream) {
          if (chunk.type === "message_start") {
            const u = chunk.message.usage;
            inputTokens   = u?.input_tokens ?? 0;
            cacheCreation = u?.cache_creation_input_tokens ?? 0;
            cacheRead     = u?.cache_read_input_tokens ?? 0;
          }
          if (chunk.type === "message_delta" && chunk.usage) {
            // The final output_tokens count arrives on the last message_delta.
            outputTokens = chunk.usage.output_tokens ?? outputTokens;
          }
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            const text = chunk.delta.text;
            assistantText += text;
            controller.enqueue(enc.encode(text));
          }
        }
        controller.close();
        // Log usage after the stream resolved successfully.
        logCall({
          route: "chat",
          user: userEmail,
          model: "claude-opus-4-7",
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreation,
            cache_read_input_tokens: cacheRead,
          },
        }).catch(() => {});
      } catch (err) {
        // Don't call controller.error — send a readable message instead so the pipe doesn't crash
        const msg = isOverloaded(err)
          ? "The AI is temporarily busy — please try again in a moment."
          : "Something went wrong. Please try again.";
        try { controller.enqueue(enc.encode(msg)); } catch { /* already closed */ }
        controller.close();
      }

      // Background memory consolidation. Runs after the response is delivered;
      // failures are logged but never surfaced to the user. Skipped when the
      // assistant reply is empty (overload path).
      if (assistantText.trim()) {
        updateMemoryFromChat(userEmail, sanitizedMessages, assistantText).catch((err) =>
          console.error("Memory update failed:", err)
        );
      }
    },
  });

  return new Response(readableStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function isOverloaded(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("overloaded");
}
