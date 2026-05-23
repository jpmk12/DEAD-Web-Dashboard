import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { anthropic } from "@/lib/claude";
import { EmailMessage, ActionItem } from "@/lib/types";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are an email action item extractor. For the provided emails, identify concrete tasks, decisions, or follow-ups required from the user. Only include emails that genuinely require action — skip informational, promotional, or automated emails.

Return ONLY a JSON array with no markdown. Each object:
{
  "emailId": "<exact email id>",
  "from": "<sender name or address>",
  "subject": "<email subject>",
  "action": "<specific action required in one clear sentence>",
  "dueDate": "<date string if mentioned, otherwise omit>"
}

If no action items are found, return an empty array [].`;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!checkRateLimit("gmail-actions", 10_000)) {
    return NextResponse.json({ actions: [] }); // silent fallback — return empty rather than error
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 200_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { emails } = body as { emails?: EmailMessage[] };
  if (!Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ actions: [] });
  }

  // Only process High and Medium priority emails (Low are typically automated)
  const actionable = emails
    .filter((e) => e.priority === "High" || e.priority === "Medium")
    .slice(0, 20);

  if (!actionable.length) return NextResponse.json({ actions: [] });

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify(
            actionable.map(({ id, subject, from, date, summary, priority }) => ({
              id,
              subject: String(subject ?? "").replace(/[\n\r]/g, " ").slice(0, 200),
              from: String(from ?? "").replace(/[\n\r]/g, " ").slice(0, 100),
              date,
              summary: String(summary ?? "").slice(0, 300),
              priority,
            }))
          ),
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text : "[]";
    const actions: ActionItem[] = JSON.parse(raw);
    return NextResponse.json({ actions: Array.isArray(actions) ? actions : [] });
  } catch (err) {
    console.error("Action extraction failed:", err);
    return NextResponse.json({ actions: [] });
  }
}
