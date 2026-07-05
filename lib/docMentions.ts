// Unlinked-mention scanning + snippet extraction for the Docs tab. PURE —
// imported by client components and by the server backlink builder; no
// node:*, no fetch, no DB.

export interface MentionCandidate {
  id: string;      // target doc id
  title: string;   // target doc's real title
  names: string[]; // title + aliases — the strings that count as a mention
}

export interface UnlinkedMention {
  targetId: string;
  targetTitle: string;
  name: string;    // the exact name that matched (title or alias)
  index: number;   // char offset of the occurrence in content
  snippet: string; // surrounding context for display
}

// Character ranges the scanner must ignore: existing [[wiki links]] (already
// linked) and fenced code blocks (code isn't prose).
function excludedRanges(content: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const m of content.matchAll(/\[\[[^\[\]\n]{1,300}\]\]/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  // Fenced blocks — pair up fence lines; an unclosed fence extends to EOF.
  const fenceStarts: number[] = [];
  for (const m of content.matchAll(/^[ \t]*(```|~~~).*$/gm)) fenceStarts.push(m.index);
  for (let i = 0; i < fenceStarts.length; i += 2) {
    const start = fenceStarts[i];
    const end = i + 1 < fenceStarts.length
      ? fenceStarts[i + 1] + (content.slice(fenceStarts[i + 1]).match(/^.*$/m)?.[0].length ?? 0)
      : content.length;
    ranges.push([start, end]);
  }
  return ranges;
}

function inRanges(idx: number, len: number, ranges: [number, number][]): boolean {
  return ranges.some(([a, b]) => idx < b && idx + len > a);
}

// Word-boundary check that works for titles containing punctuation: the
// characters immediately before/after the match must not be letters/digits.
function isWordBounded(content: string, idx: number, len: number): boolean {
  const before = idx > 0 ? content[idx - 1] : "";
  const after = idx + len < content.length ? content[idx + len] : "";
  const wordish = /[\p{L}\p{N}]/u;
  return !(before && wordish.test(before)) && !(after && wordish.test(after));
}

// Context window around an occurrence, trimmed to whole words, ellipsised.
export function snippetAround(content: string, index: number, matchLen: number, radius = 70): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + matchLen + radius);
  let snip = content.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snip = "…" + snip;
  if (end < content.length) snip = snip + "…";
  return snip;
}

// Scan `content` for candidate names appearing as plain text (not already
// wiki-linked, not in code). Case-insensitive, word-bounded, names under
// 3 chars skipped (too noisy). One mention per target doc — the first
// occurrence wins — and self-mentions are the caller's job to exclude by
// omitting the current doc from `candidates`. `dismissedNames` (lowercase)
// filters names the user has said to stop suggesting.
export function findUnlinkedMentions(
  content: string,
  candidates: MentionCandidate[],
  dismissedNames: Set<string> = new Set(),
): UnlinkedMention[] {
  if (!content) return [];
  const ranges = excludedRanges(content);
  const lower = content.toLowerCase();
  const out: UnlinkedMention[] = [];
  const seenTargets = new Set<string>();

  for (const c of candidates) {
    if (seenTargets.has(c.id)) continue;
    let best: UnlinkedMention | null = null;
    for (const name of c.names) {
      const needle = name.trim().toLowerCase();
      if (needle.length < 3 || dismissedNames.has(needle)) continue;
      let from = 0;
      while (true) {
        const idx = lower.indexOf(needle, from);
        if (idx === -1) break;
        from = idx + 1;
        if (inRanges(idx, needle.length, ranges)) continue;
        if (!isWordBounded(content, idx, needle.length)) continue;
        const hit: UnlinkedMention = {
          targetId: c.id,
          targetTitle: c.title,
          name: content.slice(idx, idx + needle.length),
          index: idx,
          snippet: snippetAround(content, idx, needle.length),
        };
        if (!best || idx < best.index) best = hit;
        break; // first valid occurrence of this name
      }
    }
    if (best) {
      out.push(best);
      seenTargets.add(c.id);
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// Wrap the mention occurrence in [[ ]] (short form — the matched text itself
// becomes the link; alias resolution maps it to the target doc). Returns the
// new content, or null if the text at that offset no longer matches (doc
// changed since the scan).
export function linkifyMention(content: string, mention: UnlinkedMention): string | null {
  const at = content.slice(mention.index, mention.index + mention.name.length);
  if (at.toLowerCase() !== mention.name.toLowerCase()) return null;
  return (
    content.slice(0, mention.index) +
    `[[${at}]]` +
    content.slice(mention.index + mention.name.length)
  );
}
