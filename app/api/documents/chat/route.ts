import { anthropic } from "@/lib/claude";
import { normEmail } from "@/lib/allowlist";
import { auth } from "@/lib/auth";
import { getDocument } from "@/lib/documents";
import { getUserPrefs, buildUserContext } from "@/lib/userPrefs";
import { isFeatureEnabled } from "@/lib/aiFeatures";
import { logCall } from "@/lib/anthropicLog";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const MAX_MESSAGES = 30;
const MAX_CONTENT_LENGTH = 4000;
// Cap the doc body that ships into the system block. A typical research note
// sits well under this; the cap protects against pathological cases (multi-
// hundred-KB pastes) without truncating in normal use.
const MAX_DOC_CHARS = 20_000;
const VALID_ROLES = new Set(["user", "assistant"]);

interface ChatMsg { role: "user" | "assistant"; content: string }

function isOverloaded(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; error?: { type?: string } };
  return e.status === 529 || e.error?.type === "overloaded_error";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { docId?: string; messages?: ChatMsg[] } = {};
  try { body = await request.json(); } catch { /* fall through to validation */ }

  const docId = typeof body.docId === "string" ? body.docId : "";
  if (!docId) return new Response("Missing docId", { status: 400 });

  const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
  const sanitizedMessages: ChatMsg[] = rawMessages
    .filter((m): m is ChatMsg => !!m && VALID_ROLES.has(m.role) && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT_LENGTH) }));
  if (sanitizedMessages.length === 0) {
    return new Response("Empty conversation", { status: 400 });
  }

  const [doc, prefs] = await Promise.all([
    getDocument(docId).catch(() => null),
    getUserPrefs(normEmail(session.user?.email)),
  ]);
  if (!doc) return new Response("Document not found", { status: 404 });

  if (!isFeatureEnabled("doc_chat", prefs)) {
    const msg = "Per-doc chat is disabled in Preferences → AI Controls. Toggle it back on to resume.";
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

  const userContext = buildUserContext(prefs);
  const today = format(new Date(), "EEEE, MMMM d, yyyy");
  const tagsLine = doc.tags.length ? `Tags: ${doc.tags.join(", ")}\n` : "";
  const truncatedBody = doc.content.slice(0, MAX_DOC_CHARS);
  const truncationNotice = doc.content.length > MAX_DOC_CHARS
    ? `\n\n[Note: body truncated at ${MAX_DOC_CHARS} chars; original is ${doc.content.length} chars.]`
    : "";

  // The cacheable block is stable within a session: identity, user context,
  // and the doc body. Each follow-up turn reuses the cached prefix; only the
  // dynamic block (today's date) and the messages array change.
  const cacheableBlock = `You are a research assistant helping the user reason about ONE specific document from their personal notes. ${userContext}

Your scope is the document below. When the user asks a question:
- Answer using ONLY what's written in the document, plus the user's general background context above.
- If the document doesn't contain enough to answer, say so explicitly and suggest what would be needed.
- Quote short passages from the document when citing it ("the doc says: …") rather than paraphrasing.
- For wiki-link references like [[Other Doc]], note that you can see only this document — point the user back to that linked doc if it would help.
- Keep answers tight; the user is a working analyst, not a student.

=== DOCUMENT ===
Title: ${doc.title}
${tagsLine}---
${truncatedBody}${truncationNotice}
=== END DOCUMENT ===`;

  const dynamicBlock = `Today is ${today}.`;

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
            // message_delta carries the running output_tokens total; overwrite,
            // don't accumulate.
            outputTokens = chunk.usage.output_tokens ?? outputTokens;
          }
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(enc.encode(chunk.delta.text));
          }
        }
        controller.close();
        logCall({
          route: "doc_chat",
          model: "claude-opus-4-7",
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreation,
            cache_read_input_tokens: cacheRead,
          },
        }).catch(() => {});
      } catch (err) {
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
