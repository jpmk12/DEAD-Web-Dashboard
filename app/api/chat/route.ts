import { anthropic } from "@/lib/claude";
import { auth } from "@/lib/auth";
import { CalendarEvent, ChatMessage, GoogleTask, NewsItem, NewsletterSummary } from "@/lib/types";
import { getUserPrefs, buildUserContext } from "@/lib/userPrefs";
import { checkRateLimit } from "@/lib/rateLimit";
import { format, parseISO } from "date-fns";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 4000;
const VALID_ROLES = new Set(["user", "assistant"]);

function formatEvents(events: CalendarEvent[]): string {
  if (!events.length) return "No upcoming events found.";
  return events
    .map((e) => {
      const start = e.isAllDay
        ? format(parseISO(e.start), "MMM d, yyyy")
        : format(parseISO(e.start), "MMM d, yyyy h:mm a");
      const end = e.isAllDay
        ? ""
        : ` – ${format(parseISO(e.end), "h:mm a")}`;
      const location = e.location ? ` @ ${String(e.location).slice(0, 80)}` : "";
      const desc = e.description ? ` — ${String(e.description).slice(0, 150)}` : "";
      return `• ${String(e.title).slice(0, 100)} on ${start}${end}${location}${desc}`;
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

  if (!checkRateLimit("chat", 2_000)) {
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

  const { messages, calendarContext, tasks, articles, newsletters } = body as Record<string, unknown>;

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

  const userPrefs = await getUserPrefs();
  const userContext = buildUserContext(userPrefs);

  const newsContext = safeArticles.length
    ? "\n\nRecent news the user has been reading:\n" +
      safeArticles.map((a) => `• [${a.source}] ${a.title}`).join("\n")
    : "";

  const newsletterContext = safeNewsletters.length
    ? "\n\nRecent newsletter highlights:\n" +
      safeNewsletters.flatMap((n) => n.bullets.slice(0, 3).map((b) => `• ${b}`)).join("\n")
    : "";

  const tz = userPrefs.timezone || "America/Chicago";
  const today = format(new Date(), "EEEE, MMMM d, yyyy");

  const systemPrompt = `You are a personal scheduling and productivity assistant. Today is ${today}. User's timezone: ${tz}.${userContext}

USER'S UPCOMING CALENDAR:
${formatEvents(sanitizedContext)}

USER'S PENDING TASKS:
${formatTasks(sanitizedTasks)}${newsContext}${newsletterContext}

You can:
- Find free time slots and check for conflicts in the calendar
- Suggest meeting times and schedules
- Add events directly to the calendar
- Create tasks and to-do items

TO ADD A CALENDAR EVENT: When the user asks you to schedule or add something, end your response with this on its own line (valid JSON, always include timeZone using the user's timezone):
[ADD_EVENT:{"summary":"Event title","start":"2026-05-20T10:00:00","end":"2026-05-20T11:00:00","timeZone":"${tz}"}]

TO CREATE A TASK: When the user asks you to create a task or reminder, end your response with this on its own line (valid JSON only):
[ADD_TASK:{"title":"Task description","due":"2026-05-20"}]

Rules:
- Only emit an action block when you have enough information — ask first if you need a date/time
- Check for conflicts before suggesting a time slot
- The "due" field for tasks is optional; "description" and "location" for events are also optional
- Include only one action block per response; ask for confirmation if multiple actions are needed`;

  const stream = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2048,
    stream: true,
    system: systemPrompt,
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
      try {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(enc.encode(chunk.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        // Don't call controller.error — send a readable message instead so the pipe doesn't crash
        const msg = isOverloaded(err)
          ? "The AI is temporarily busy — please try again in a moment."
          : "Something went wrong. Please try again.";
        try { controller.enqueue(enc.encode(msg)); } catch { /* already closed */ }
        controller.close();
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
