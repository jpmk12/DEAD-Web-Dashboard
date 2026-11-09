import { gmail as gmailApi, gmail_v1 } from "@googleapis/gmail";
import { OAuth2Client } from "google-auth-library";
import { EmailMessage } from "./types";
import { runLimited } from "./concurrency";
import { gmailFailure, isGmailRateLimit } from "./gmailErrors";
import { markReadWithFallback } from "./gmailMark";

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
    .replace(/(\n>[^\n]*){3,}[\s\S]*$/, "")    // long quoted-reply chains ([\s\S] avoids the ES2018 /s flag)
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

/** Unread inbox mail read per load, per account (was 25 — the list held
 *  the newest 25 and "mark all read" then had to be pressed again for the
 *  next 25; 2026-11-09). */
export const UNREAD_FETCH_MAX = 100;
const GET_CONCURRENCY = 6;

export interface UnreadInbox {
  emails: EmailMessage[];
  /** Gmail's own estimate of unread inbox mail (may exceed what was read). */
  total: number;
  /** Messages listed but not fetched (refused twice) — named, not dropped silently. */
  failed: number;
}

export async function getUnreadEmails(
  accessToken: string,
  account: EmailMessage["account"],
  accountEmail = "",
  max = UNREAD_FETCH_MAX,
): Promise<UnreadInbox> {
  const gmail = buildClient(accessToken);

  // Page the list (100 ids per page is Gmail's own ceiling for one call).
  const messageRefs: string[] = [];
  let total = 0;
  let pageToken: string | undefined;
  do {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX", "UNREAD"],
      maxResults: Math.min(100, max - messageRefs.length),
      ...(pageToken ? { pageToken } : {}),
    });
    total = Math.max(total, listRes.data.resultSizeEstimate ?? 0);
    for (const r of listRes.data.messages ?? []) if (r.id) messageRefs.push(r.id);
    pageToken = listRes.data.nextPageToken ?? undefined;
  } while (pageToken && messageRefs.length < max);
  total = Math.max(total, messageRefs.length);
  if (!messageRefs.length) return { emails: [], total, failed: 0 };

  // Partition into cache hits and the ids we still need to fetch.
  const hits: EmailMessage[] = [];
  const need: string[] = [];
  for (const id of messageRefs) {
    const cached = msgCacheGet(account, id);
    if (cached) hits.push(cached); else need.push(id);
  }

  // A few at a time, each retried once on a rate limit. One refused message
  // used to reject the whole Promise.all — and the caller's catch turned that
  // into an EMPTY inbox for the account.
  let failed = 0;
  const fetched = await runLimited(need, GET_CONCURRENCY, async (id) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data;
      } catch (err) {
        if (attempt === 0 && isGmailRateLimit(err)) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        break;
      }
    }
    failed++;
    return null;
  });

  const parsed: EmailMessage[] = fetched.flatMap((msg) => {
    if (!msg?.id) return [];
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
  const emails = messageRefs.map((id) => byId.get(id)).filter((m): m is EmailMessage => !!m);
  if (failed) console.error(`getUnreadEmails: ${failed}/${need.length} messages not fetched`);
  return { emails, total, failed };
}

/** Message ids only — one messages.list call, no message bodies. The Family
 *  tab's new-mail check (REVIEW-2026-10 F4) compares this against the ids
 *  the last digest read, so the model runs only when mail actually changed. */
export async function listMessageIds(accessToken: string, query: string, maxResults = 30): Promise<string[]> {
  const gmail = buildClient(accessToken);
  const listRes = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
  return (listRes.data.messages ?? []).map((r) => r.id).filter((id): id is string => !!id);
}

export async function fetchNewsletterEmails(
  accessToken: string,
  query: string,
  maxResults = 8
): Promise<{ id: string; subject: string; date: string; body: string; from: string; unread: boolean }[]> {
  const gmail = buildClient(accessToken);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const refs = (listRes.data.messages ?? []).filter((r) => r.id);
  if (!refs.length) return [];

  // Chunked rather than one big Promise.all: messages.get costs 5 quota units
  // and the per-user ceiling is 250/sec, so a 30-message fan-out in a single
  // burst sits right on the limit and 429s under any concurrency. Ten at a
  // time is well inside it and costs a few hundred ms.
  const full: { data: gmail_v1.Schema$Message }[] = [];
  for (let i = 0; i < refs.length; i += 10) {
    full.push(...await Promise.all(
      refs.slice(i, i + 10).map((ref) =>
        gmail.users.messages.get({ userId: "me", id: ref.id!, format: "full" })
      )
    ));
  }

  return full.flatMap((res) => {
    const msg = res.data;
    if (!msg.id) return [];
    const payload = msg.payload ?? {};
    const body = extractLongBody(payload) || msg.snippet || "";
    return [{
      id: msg.id,
      subject: header(msg, "Subject") || "(no subject)",
      // Needed by the Family digest to attribute a message to a roster person.
      from: header(msg, "From") || "",
      unread: (msg.labelIds ?? []).includes("UNREAD"),
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

// ── Reply drafting (P8) ──────────────────────────────────────────────────────

export interface ReplyContext {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;            // long extraction for drafting context
  messageIdHeader: string; // RFC 822 Message-ID — threads the reply
  references: string;
}

// Full message with the headers a threaded reply needs.
// Headers ONLY — format:"metadata" with an explicit header allow-list, so the
// Gmail API never returns a body at all. Used by sender discovery, which is the
// one search in this app that looks outside the declared roster: the guarantee
// that it cannot read message content needs to be enforced by the request
// shape, not by a promise in a comment.
export async function fetchMessageHeaders(
  accessToken: string,
  query: string,
  maxResults = 60,
): Promise<{ id: string; from: string; subject: string; date: string }[]> {
  const gmail = buildClient(accessToken);
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: Math.max(1, Math.min(200, maxResults)),
  });
  const refs = (listRes.data.messages ?? []).filter((r) => r.id);
  if (!refs.length) return [];

  // Chunked for the same quota reason as fetchNewsletterEmails.
  const out: { id: string; from: string; subject: string; date: string }[] = [];
  for (let i = 0; i < refs.length; i += 10) {
    const chunk = refs.slice(i, i + 10);
    const got = await Promise.all(chunk.map((r) =>
      gmail.users.messages.get({
        userId: "me",
        id: r.id as string,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      }).catch(() => null)));
    for (const g of got) {
      if (!g?.data) continue;
      const hs = g.data.payload?.headers ?? [];
      const h = (n: string) => hs.find((x) => (x.name ?? "").toLowerCase() === n)?.value ?? "";
      out.push({ id: String(g.data.id ?? ""), from: h("from"), subject: h("subject"), date: h("date") });
    }
  }
  return out;
}

// The user's own labels (type "user" — never the system ones), names only.
// Used by the Family tab's "seed from label" so a roster can be filled from
// filing the user already did. Reads label metadata, never a message.
export async function listUserLabels(accessToken: string): Promise<{ id: string; name: string }[]> {
  const gmail = buildClient(accessToken);
  const res = await gmail.users.labels.list({ userId: "me" });
  return (res.data.labels ?? [])
    .filter((l) => l.type === "user" && l.id && l.name)
    .map((l) => ({ id: String(l.id), name: String(l.name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100);
}

// Find a user label by name, creating it (and any missing parents of a
// nested "A/B" name) if absent. Returns the label id. Names compare
// case-insensitively because Gmail treats "family/school" and "Family/School"
// as the same label and refuses the duplicate.
export async function ensureLabel(accessToken: string, name: string): Promise<string> {
  const gmail = buildClient(accessToken);
  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = new Map<string, string>();
  for (const l of list.data.labels ?? []) if (l.name && l.id) existing.set(l.name.toLowerCase(), l.id);

  const parts = name.split("/").map((p) => p.trim()).filter(Boolean);
  let path = "";
  let id = "";
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    const hit = existing.get(path.toLowerCase());
    if (hit) { id = hit; continue; }
    const created = await gmail.users.labels.create({
      userId: "me",
      requestBody: { name: path, labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    id = String(created.data.id ?? "");
    if (!id) throw new Error(`Could not create label ${path}`);
    existing.set(path.toLowerCase(), id);
  }
  return id;
}

/** Apply a label (by name, created if needed) to messages. allSettled so one
 *  failed modify does not abort the rest; returns how many took. */
export async function applyLabel(accessToken: string, ids: string[], name: string): Promise<{ labelId: string; applied: number }> {
  const labelId = await ensureLabel(accessToken, name);
  const gmail = buildClient(accessToken);
  const results = await Promise.allSettled(ids.map((id) =>
    gmail.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: [labelId] } }),
  ));
  return { labelId, applied: results.filter((r) => r.status === "fulfilled").length };
}

export async function getMessageForReply(accessToken: string, id: string): Promise<ReplyContext | null> {
  const gmail = buildClient(accessToken);
  const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const msg = res.data;
  if (!msg.id) return null;
  return {
    id: msg.id,
    threadId: msg.threadId ?? "",
    subject: header(msg, "Subject") || "(no subject)",
    from: header(msg, "From"),
    to: header(msg, "To"),
    date: header(msg, "Date"),
    body: extractLongBody(msg.payload ?? {}) || msg.snippet || "",
    messageIdHeader: header(msg, "Message-ID") || header(msg, "Message-Id"),
    references: header(msg, "References"),
  };
}

// Recent self-written prose from Sent — the model's voice sample. Quoted
// chains and signatures are trimmed the same way as the classifier path so
// the sample is the user's words, not the thread's.
export async function sampleSentVoice(accessToken: string, max = 5): Promise<string[]> {
  const gmail = buildClient(accessToken);
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "in:sent newer_than:60d",
    maxResults: max * 2, // headroom — some sent items are forwards/empties
  });
  const ids = (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const full = await Promise.all(
    ids.slice(0, max * 2).map((id) =>
      gmail.users.messages.get({ userId: "me", id, format: "full" }).then((r) => r.data).catch(() => null)
    )
  );
  const out: string[] = [];
  for (const msg of full) {
    if (!msg) continue;
    const raw = extractBody(msg.payload ?? {});
    const trimmed = raw
      .replace(/\r\n/g, "\n")
      .split(/\n-- ?\n/)[0]
      .split(/\nOn .{1,80}wrote:\n/)[0]
      .replace(/(\n>[^\n]*){3,}[\s\S]*$/, "")
      .trim()
      .slice(0, 600);
    if (trimmed.length >= 40) out.push(trimmed); // skip empties/one-liners
    if (out.length >= max) break;
  }
  return out;
}

// Extract just the email address from a From/To header value.
function addrOf(headerValue: string): string {
  const m = headerValue.match(/<([^>]+)>/);
  return (m ? m[1] : headerValue).trim();
}

// Create a Gmail DRAFT reply (never sends). Threading follows RFC 2822:
// In-Reply-To = original Message-ID, References = original References + that id.
export async function createDraftReply(
  accessToken: string,
  ctx: ReplyContext,
  bodyText: string,
): Promise<string | null> {
  const gmail = buildClient(accessToken);
  const to = addrOf(ctx.from); // reply goes to the original sender
  const subject = /^re:/i.test(ctx.subject) ? ctx.subject : `Re: ${ctx.subject}`;
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    ctx.messageIdHeader ? `In-Reply-To: ${ctx.messageIdHeader}` : "",
    ctx.messageIdHeader ? `References: ${[ctx.references, ctx.messageIdHeader].filter(Boolean).join(" ")}` : "",
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
  ].filter(Boolean);
  const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${bodyText}`, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw, threadId: ctx.threadId || undefined } },
  });
  return res.data.id ?? null;
}

/** Removes UNREAD from many ids in ONE call per 1,000 (batchModify, 50
 *  quota units) — the newsletter read marks a dozen sources at once and
 *  per-id modifies burst past the rate limit. All-or-nothing per chunk:
 *  returns the ids whose chunk Gmail refused. */
export async function markAsReadBatch(accessToken: string, ids: string[]): Promise<string[]> {
  const gmail = buildClient(accessToken);
  const failed: string[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    try {
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids: chunk, removeLabelIds: ["UNREAD"] } });
    } catch (err) {
      console.error(`markAsReadBatch: ${chunk.length} messages refused`, err instanceof Error ? err.message : err);
      failed.push(...chunk);
    }
  }
  return failed;
}

/** Removes UNREAD from each id. Returns the ids Gmail REFUSED — the caller
 *  must not report success for those (REVIEW-2026-10 E5). One batchModify per
 *  chunk; one-by-one only when a chunk is refused (lib/gmailMark). */
export async function markAsRead(
  accessToken: string,
  ids: string[]
): Promise<string[]> {
  const gmail = buildClient(accessToken);
  const failed = await markReadWithFallback(ids, {
    batch: async (chunk) => { await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids: chunk, removeLabelIds: ["UNREAD"] } }); },
    single: async (id) => { await gmail.users.messages.modify({ userId: "me", id, requestBody: { removeLabelIds: ["UNREAD"] } }); },
    isRate: isGmailRateLimit,
    isAuth: (err) => gmailFailure(err).cls === "auth",
  });
  if (failed.length > 0) console.error(`markAsRead: ${failed.length}/${ids.length} messages refused`);
  return failed;
}
