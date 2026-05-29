import { NextResponse } from "next/server";
import { gmail as gmailApi } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

interface PrepMail {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

interface PrepAttendeeBlock {
  email: string;
  mails: PrepMail[];
}

function buildClient(accessToken: string) {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  return gmailApi({ version: "v1", auth: oauth2Client });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!checkRateLimit("meeting-prep", 2_000)) {
    return NextResponse.json({ error: "Slow down" }, { status: 429 });
  }

  let body: { attendees?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Strict RFC-ish email regex — rejects anything that could be a Gmail
  // search operator (`:`, parens, `OR`, etc.) when interpolated into q=.
  const STRICT_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  const raw = Array.isArray(body.attendees) ? body.attendees : [];
  const attendees = Array.from(
    new Set(
      raw
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => STRICT_EMAIL.test(e))
    )
  ).slice(0, 8);

  if (attendees.length === 0) return NextResponse.json({ attendees: [] });

  const gmail = buildClient(session.accessToken as string);
  const PER_ATTENDEE_LIMIT = 3;

  const results: PrepAttendeeBlock[] = await Promise.all(
    attendees.map(async (email): Promise<PrepAttendeeBlock> => {
      try {
        const list = await gmail.users.messages.list({
          userId: "me",
          // Wrap in quotes for defense in depth: the regex above already
          // rejects operator-shaped emails, but quoting prevents any future
          // regex weakening from silently widening the query surface.
          q: `from:"${email}" newer_than:60d`,
          maxResults: PER_ATTENDEE_LIMIT,
        });
        const ids = (list.data.messages ?? [])
          .map((m) => m.id)
          .filter((id): id is string => Boolean(id));
        const metas = await Promise.all(
          ids.map((id) =>
            gmail.users.messages
              .get({
                userId: "me",
                id,
                format: "metadata",
                metadataHeaders: ["Subject", "From", "Date"],
              })
              .then((r) => r.data)
              .catch(() => null)
          )
        );
        const mails: PrepMail[] = [];
        for (const m of metas) {
          if (!m) continue;
          const get = (n: string) =>
            m.payload?.headers?.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
          mails.push({
            id: m.id ?? "",
            from: get("From"),
            subject: get("Subject"),
            date: get("Date"),
            snippet: (m.snippet ?? "").slice(0, 200),
          });
        }
        return { email, mails };
      } catch {
        return { email, mails: [] };
      }
    })
  );

  return NextResponse.json({ attendees: results });
}
