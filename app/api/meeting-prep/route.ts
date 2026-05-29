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

  // Server-side in-memory cache so re-clicking Prep on the same meeting
  // within an hour skips the up-to-32 Gmail RPCs.
  const cacheKey = attendees.slice().sort().join("|");
  const cached = prepCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) {
    return NextResponse.json({ attendees: cached.data, cached: true });
  }

  const gmail = buildClient(session.accessToken as string);
  const PER_ATTENDEE_LIMIT = 3;
  // Cap concurrent Gmail RPCs to stay well under per-user quota.
  const CONCURRENCY = 4;

  const results: PrepAttendeeBlock[] = await mapWithConcurrency(attendees, CONCURRENCY, async (email): Promise<PrepAttendeeBlock> => {
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
      const metas = await mapWithConcurrency(ids, CONCURRENCY, (id) =>
        gmail.users.messages
          .get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date"],
          })
          .then((r) => r.data)
          .catch(() => null)
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
  });

  prepCache.set(cacheKey, { data: results, expires: Date.now() + PREP_TTL_MS });
  // Light prune so a long-running process doesn't accumulate dead entries.
  if (prepCache.size > 100) {
    for (const [k, v] of prepCache) if (v.expires < Date.now()) prepCache.delete(k);
  }
  return NextResponse.json({ attendees: results, cached: false });
}

// In-memory cache, keyed by sorted attendee list. The process is long-running
// on Node.js Hosting so the cache survives across requests. 1 h TTL.
const PREP_TTL_MS = 60 * 60 * 1000;
const prepCache = new Map<string, { data: PrepAttendeeBlock[]; expires: number }>();

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
