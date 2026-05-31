// Returns the URL only if it's an http(s) link, else undefined. Guards against
// rendering attacker-controlled `javascript:` / `data:` schemes from untrusted
// RSS feeds as clickable hrefs. Use as: href={safeHttpHref(item.link)}.
export function safeHttpHref(url: string | undefined): string | undefined {
  if (typeof url !== "string") return undefined;
  return /^https?:\/\//i.test(url.trim()) ? url : undefined;
}
