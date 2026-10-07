// Server-only fetch guard for URLs a USER supplied (OSINT feeds, the feed
// tester). `isSafeHostname` in lib/osintFeeds.ts is a string check — it
// catches a literal 127.0.0.1 but not a hostname that RESOLVES there, an
// IPv4-mapped IPv6 literal, or a public URL that redirects to loopback (code
// review 2026-10-07, finding 4). This resolves the name first and rejects any
// non-public address, then fetches with `redirect: "manual"` and re-validates
// every hop, so the app's own loopback port (and anything else the host can
// reach) is never a target. Pure node (`dns`, `net`), no new dependency.

import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { isSafeHostname } from "./osintFeeds";

const MAX_REDIRECTS = 3;

/** True when an IP (v4 or v6 textual form) is loopback, private, link-local,
 *  CGNAT, unspecified, multicast, or an IPv4-mapped form of one of those. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return true; // not an address at all → never trusted
}

function isPrivateV4(ip: string): boolean {
  const o = ip.split(".").map((n) => Number(n));
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true;            // this-net, RFC1918, loopback
  if (a === 100 && b >= 64 && b <= 127) return true;             // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                       // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return true;              // RFC1918
  if (a === 192 && b === 168) return true;                       // RFC1918
  if (a === 192 && b === 0 && o[2] === 0) return true;           // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true;          // benchmarking
  if (a >= 224) return true;                                     // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 textual form to eight hextets (a trailing dotted v4 is
 *  folded into the last two). Returns null when it does not parse. */
function hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (dotted) {
    const o = dotted.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, dotted.index) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const parts = [...left, ...Array(fill).fill("0"), ...right];
  if (parts.length !== 8) return null;
  const out = parts.map((h) => parseInt(h || "0", 16));
  return out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : out;
}

function isPrivateV6(ip: string): boolean {
  const h = hextets(ip);
  if (!h) return true;
  // IPv4-mapped (::ffff:a.b.c.d, in either spelling) → judge the v4.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return isPrivateV4(`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`);
  }
  if (h.every((n) => n === 0)) return true;                               // ::
  if (h.slice(0, 7).every((n) => n === 0) && h[7] === 1) return true;      // ::1
  const first = h[0];
  const s = ip.toLowerCase();
  if ((first & 0xfe00) === 0xfc00) return true;   // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true;   // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true;   // ff00::/8 multicast
  if (first === 0x2002) return true;              // 6to4 (embeds a v4)
  if (s.startsWith("64:ff9b:")) return true;      // NAT64 well-known prefix
  return false;
}

/** Validate a user-supplied URL: http(s) only, no credentials, hostname not
 *  a private literal, and EVERY address it resolves to public. Returns the
 *  parsed URL or null. Resolution failure → null (an unresolvable feed is
 *  not fetchable anyway). */
export async function resolvePublicUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!isSafeHostname(host)) return null;
  const literal = host.replace(/^\[|\]$/g, "");
  if (isIP(literal)) return isPrivateAddress(literal) ? null : u;
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    if (!addrs.length) return null;
    if (addrs.some((a) => isPrivateAddress(a.address))) return null;
  } catch { return null; }
  return u;
}

/** fetch() for a user-supplied URL: public-address check on the first hop and
 *  on every redirect (followed manually, at most MAX_REDIRECTS). Throws on a
 *  refused hop so the caller's existing catch treats it like any dead feed. */
export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  let url = await resolvePublicUrl(raw);
  if (!url) throw new Error("refused: not a public http(s) URL");
  for (let hop = 0; ; hop++) {
    const res = await fetch(url.toString(), { ...init, redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !loc) return res;
    if (hop >= MAX_REDIRECTS) throw new Error("refused: too many redirects");
    let next: URL;
    try { next = new URL(loc, url); } catch { throw new Error("refused: bad redirect"); }
    const ok = await resolvePublicUrl(next.toString());
    if (!ok) throw new Error("refused: redirect to a non-public address");
    url = ok;
    try { await res.body?.cancel(); } catch { /* ignore */ }
  }
}
