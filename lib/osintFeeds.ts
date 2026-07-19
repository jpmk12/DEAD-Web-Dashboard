// Shared validation for user-configured OSINT feeds — the security-critical
// sanitizer (SSRF guard + shape/caps) lives here so every write path (the full
// /api/user-prefs POST and the targeted /api/osint/feeds PUT) uses the SAME
// logic. Server-only (Buffer for the id fallback).

import type { OsintFeed } from "./types";

export const OSINT_KINDS = new Set<OsintFeed["kind"]>(["social", "telegram", "news", "other"]);

// Block obvious SSRF targets when the feeds are later fetched server-side.
// Public IP ranges + arbitrary HTTP(S) URLs are allowed; loopback, link-local,
// and RFC-1918 private space are not.
export function isSafeHostname(h: string): boolean {
  if (!h) return false;
  if (h === "localhost" || h === "broadcasthost" || h === "ip6-localhost") return false;
  if (/^127\./.test(h)) return false;
  if (/^10\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  if (/^169\.254\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^(::1|fe80:|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i.test(h)) return false;
  if (/^0\.0\.0\.0$/.test(h)) return false;
  return true;
}

export function sanitizeOsintFeeds(v: unknown): OsintFeed[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x): OsintFeed[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    const urlRaw = String(r.url ?? "").trim();
    const label = String(r.label ?? "").trim().slice(0, 60);
    if (!urlRaw || !label) return [];
    let parsed: URL;
    try { parsed = new URL(urlRaw); } catch { return []; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    if (parsed.username || parsed.password) return [];
    if (!isSafeHostname(parsed.hostname.toLowerCase())) return [];
    const id = String(r.id ?? "").slice(0, 60) || Buffer.from(urlRaw).toString("base64").slice(0, 16);
    const kind = OSINT_KINDS.has(r.kind as OsintFeed["kind"]) ? (r.kind as OsintFeed["kind"]) : "other";
    return [{ id, label, url: urlRaw.slice(0, 500), kind }];
  }).slice(0, 20);
}
