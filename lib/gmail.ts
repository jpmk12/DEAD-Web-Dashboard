import { google, gmail_v1 } from "googleapis";
import { EmailMessage } from "./types";

function buildClient(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
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

  const messageRefs = (listRes.data.messages ?? []).filter((r) => r.id);
  if (!messageRefs.length) return [];

  const full = await Promise.all(
    messageRefs.map((ref) =>
      gmail.users.messages.get({ userId: "me", id: ref.id!, format: "full" })
    )
  );

  return full.flatMap((res) => {
    const msg = res.data;
    if (!msg.id) return [];
    const payload = msg.payload ?? {};
    return [{
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
    }];
  });
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
