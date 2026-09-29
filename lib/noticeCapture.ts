// Pure parser/validator for a captured OFFICIAL-NOTICE stream (a government
// ministry's announcements page captured in the user's own browser — the first
// source is PRC MOFCOM's export-control / unreliable-entity / anti-dumping
// notices, which have no API). Client-safe, no DB. Counterpart to
// lib/eventCapture / lib/articleCapture.
//
// A notice is a primary-source RECORD, like a Federal Register document: the
// economic-warfare board treats it as a reported act BY the issuing actor
// (lib/economicWarfare readOfficialNotice), never as news about one.

export interface StoredNoticeDraft {
  id: string;
  url: string;
  title: string;
  body: string | null;
  /** yyyy-mm-dd when the capture found one, else null — never guessed. */
  publishedOn: string | null;
  /** Issuing host, e.g. "www.mofcom.gov.cn" — the actor join key. */
  host: string;
  source: string;      // label, e.g. "MOFCOM"
  capturedAt: string;
}

export type ParseNoticesResult =
  | { ok: true; notices: StoredNoticeDraft[]; source: string; host: string; skipped: number }
  | { ok: false; error: string };

const MAX_ITEMS = 200;
const MAX_BODY = 6000;

/** Hosts a capture may claim to be from. A crafted file cannot smuggle a
 *  notice under another government's name. */
export const NOTICE_HOST_ALLOW = [/(^|\.)mofcom\.gov\.cn$/i];

function httpsOrNull(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  try { const u = new URL(s); return u.protocol === "https:" ? u.href.slice(0, 600) : null; } catch { return null; }
}
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "nt_" + h.toString(36);
}
const ymdOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(20\d\d)-(\d\d)-(\d\d)$/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isFinite(t) ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

export function parseNoticesCapture(raw: string, nowIso = new Date().toISOString()): ParseNoticesResult {
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return { ok: false, error: "Invalid JSON." }; }
  if (j.format !== "dead-notices") return { ok: false, error: "Not a dead-notices capture." };

  const src = j.source as { label?: unknown; host?: unknown } | undefined;
  const host = (typeof src?.host === "string" ? src.host : "").trim().toLowerCase().slice(0, 120);
  if (!host || !NOTICE_HOST_ALLOW.some((rx) => rx.test(host))) return { ok: false, error: "Unsupported notice source host." };
  const source = (typeof src?.label === "string" ? src.label : "").trim().slice(0, 40) || "notices";
  const rawItems = Array.isArray(j.items) ? j.items : [];
  if (!rawItems.length) return { ok: false, error: "No notices in the capture." };

  const seen = new Set<string>();
  const notices: StoredNoticeDraft[] = [];
  let skipped = 0;
  for (const it of rawItems.slice(0, MAX_ITEMS * 2)) {
    if (notices.length >= MAX_ITEMS) break;
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const url = httpsOrNull(o.url);
    const title = (typeof o.title === "string" ? o.title : "").replace(/\s+/g, " ").trim().slice(0, 300);
    let urlHost = "";
    try { urlHost = url ? new URL(url).hostname.toLowerCase() : ""; } catch { urlHost = ""; }
    // Every permalink must live on the claimed host family — a list page
    // cannot carry links out to somewhere else under MOFCOM's name.
    if (!url || title.length < 6 || !NOTICE_HOST_ALLOW.some((rx) => rx.test(urlHost))) { skipped++; continue; }
    const id = hashId(url);
    if (seen.has(id)) { skipped++; continue; }
    seen.add(id);
    const body = typeof o.body === "string" ? o.body.replace(/\s+/g, " ").trim().slice(0, MAX_BODY) : "";
    notices.push({
      id, url, title,
      body: body.length >= 40 ? body : null,
      publishedOn: ymdOrNull(o.date) ?? ymdOrNull(o.publishedOn),
      host, source,
      capturedAt: (typeof j.capturedAt === "string" && Number.isFinite(Date.parse(j.capturedAt))) ? new Date(Date.parse(j.capturedAt)).toISOString() : nowIso,
    });
  }
  if (!notices.length) return { ok: false, error: "No valid notices (need https permalinks on the source host + titles)." };
  return { ok: true, notices, source, host, skipped };
}
