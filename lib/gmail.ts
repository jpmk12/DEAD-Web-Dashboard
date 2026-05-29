import { gmail as gmailApi, gmail_v1 } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import { EmailMessage } from "./types";

function buildClient(accessToken: string) {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  return gmailApi({ version: "v1", auth: oauth2Client });
}

// In-process cache for parsed unread emails, keyed by (account, message id).
// The /api/gmail classification cache skips Claude calls, but does NOT skip
// the underlying messages.get traffic — every dashboard refresh was
// re-fetching 25-50 full message bodies. This caches the parsed result so
// subsequent fetches inside the TTL window pay only the messages.list cost
// for ids we already have.
const MESSAGE_TTL_MS = 10 * 60 * 1000;
const messageCache = new Map<string, { msg: EmailMessage; expires: number }>();

function msgCacheGet(account: EmailMessage["account"], id: string): EmailMessage | null {
  const key = `${account}:${id}`;
  const hit = messageCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { messageCache.delete(key); return null; }
  return hit.msg;
}
function msgCachePut(account: EmailMessage["account"], id: string, msg: EmailMessage): void {
  messageCache.set(`${account}:${id}`, { msg, expires: Date.now() + MESSAGE_TTL_MS });
  // Light prune so a long-running process doesn't accumulate dead entries.
  if (messageCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of messageCache) if (v.expires < now) messageCache.delete(k);
  }
}

// Trim and de-noise a raw body for Claude classification. Strips standard
// signature blocks, mobile sigs, and long quoted-reply chains, then caps at
// 400 chars. Sent to Claude on every cache-miss classification, so noise
// removal directly cuts input-token spend.
export function trimBodyForClassifier(body: string): string {
  if (!body) return "";
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n-- ?\n/)[0]                  // standard sig delimiter
    .split(/\nSent from my /)[0]           // mobile sig
    .split(/\nOn .{1,80}wrote:\n/)[0]      // Gmail/Outlook quoted-reply preamble
    .replace(/(\n>[^\n]*){3,}.*$/s, "")    // long quoted-reply chains
    .trim()
    .slice(0, 400);
}

function decodeBase64url(s: string): string {
  try {
    const std = s.replace(/-/g, "+").replace(/_/g, "/");
    const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBody(part: gmail_v1.Schema$MessagePart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64url(part.body.data).slice(0, 2000);
  }
  for (const child of part.parts ?? []) {
    const t = extractBody(child);
    if (t) return t;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64url(part.body.data)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);
  }
  return "";
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  return (
    msg.payload?.headers?.find(
      (h) => h.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? ""
  );
}

export async function getUnreadEmails(
  accessToken: string,
  account: EmailMessage["account"],
  accountEmail = ""
): Promise<EmailMessage[]> {
  const gmail = buildClient(accessToken);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["INBOX", "UNREAD"],
    maxResults: 25,
  });

  const messageRefs = (listRes.data.messages ?? [])
    .map((r) => r.id)
    .filter((id): id is string => Boolean(id));
  if (!messageRefs.length) return [];

  // Partition into cache hits and the ids we still need to fetch.
  const hits: EmailMessage[] = [];
  const need: string[] = [];
  for (const id of messageRefs) {
    const cached = msgCacheGet(account, id);
    if (cached) hits.push(cached); else need.push(id);
  }

  if (need.length === 0) {
    // Preserve the order Gmail returned (most recent first).
    const byId = new Map(hits.map((m) => [m.id, m]));
    return messageRefs.map((id) => byId.get(id)!).filter(Boolean);
  }

  const fetched = await Promise.all(
    need.map((id) =>
      gmail.users.messages.get({ userId: "me", id, format: "full" })
    )
  );

  const parsed: EmailMessage[] = fetched.flatMap((res) => {
    const msg = res.data;
    if (!msg.id) return [];
    const payload = msg.payload ?? {};
    const m: EmailMessage = {
      id: msg.id,
      account,
      accountEmail,
      subject: header(msg, "Subject") || "(no subject)",
      from: header(msg, "From"),
      date: (() => {
        try {
          return new Date(header(msg, "Date")).toISOString();
        } catch {
          return "";
        }
      })(),
      snippet: msg.snippet ?? "",
      bodyPreview: extractBody(payload) || msg.snippet || "",
      priority: "Low" as const,
      summary: "",
    };
    msgCachePut(account, m.id, m);
    return [m];
  });

  // Re-order to match Gmail's original order; cache hits + freshly parsed.
  const byId = new Map<string, EmailMessage>([...hits, ...parsed].map((m) => [m.id, m]));
  return messageRefs.map((id) => byId.get(id)).filter((m): m is EmailMessage => !!m);
}

export async function fetchNewsletterEmails(
  accessToken: string,
  query: string,
  maxResults = 8
): Promise<{ id: string; subject: string; date: string; body: string }[]> {
  const gmail = buildClient(accessToken);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const refs = (listRes.data.messages ?? []).filter((r) => r.id);
  if (!refs.length) return [];

  const full = await Promise.all(
    refs.map((ref) =>
      gmail.users.messages.get({ userId: "me", id: ref.id!, format: "full" })
    )
  );

  return full.flatMap((res) => {
    const msg = res.data;
    if (!msg.id) return [];
    const payload = msg.payload ?? {};
    const body = extractLongBody(payload) || msg.snippet || "";
    return [{
      id: msg.id,
      subject: header(msg, "Subject") || "(no subject)",
      date: (() => {
        try { return new Date(header(msg, "Date")).toISOString(); }
        catch { return ""; }
      })(),
      body,
    }];
  });
}

// Longer body extraction for newsletters (up to 6000 chars for better summarisation)
function extractLongBody(part: gmail_v1.Schema$MessagePart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64url(part.body.data).slice(0, 6000);
  }
  for (const child of part.parts ?? []) {
    const t = extractLongBody(child);
    if (t) return t;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBase64url(part.body.data)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  }
  return "";
}

export async function markAsRead(
  accessToken: string,
  ids: string[]
): Promise<void> {
  const gmail = buildClient(accessToken);
  // allSettled so one failed modify doesn't abort the remaining ids
  const results = await Promise.allSettled(
    ids.map((id) =>
      gmail.users.messages.modify({
        userId: "me",
        id,
        requestBody: { removeLabelIds: ["UNREAD"] },
      })
    )
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.error(`markAsRead: ${failed}/${ids.length} messages failed`);
  }
}
