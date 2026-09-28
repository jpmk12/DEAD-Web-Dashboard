// Command palette — the ranking, PURE and unit-tested.
//
// The palette is the one place every surface in the app is reachable from by
// name: a tab, an OSINT pane, a SITREP base, an I&W board, a Regional country,
// a family member, a document, a Preferences section, or an action (brief,
// digest, capture, assistant). The component gathers those from endpoints
// that already exist and hands them here as a flat list; this module decides
// what a query matches and in what order. No fetches, no DOM.
//
// Ranking discipline: every typed token must match SOMEWHERE (label, hint or
// keywords) — an AND, so "kwri sitrep" narrows rather than widens. Matches
// at a word start beat matches mid-word, an exact label beats both, and a
// contiguous match beats a scattered one. Ties fall back to a fixed group
// order so navigation sits above documents when both fit.

export type CommandGroup = "go" | "act" | "base" | "board" | "country" | "person" | "doc" | "prefs";

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  /** One clause shown dim beside the label — and searchable. */
  hint?: string;
  /** Extra search terms not worth showing (ICAO, aliases, COCOM). */
  keywords?: string[];
  /** Keyboard hint, e.g. "⌘K". Display only. */
  shortcut?: string;
}

export const GROUP_LABEL: Record<CommandGroup, string> = {
  go: "Go to",
  act: "Actions",
  base: "SITREP bases",
  board: "I&W boards",
  country: "Regional",
  person: "Family",
  doc: "Documents",
  prefs: "Preferences",
};

/** Display and tie-break order. */
export const GROUP_ORDER: CommandGroup[] = ["go", "act", "base", "board", "country", "person", "prefs", "doc"];

export const DEFAULT_LIMIT = 14;

const norm = (s: string): string =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function tokenize(query: string): string[] {
  return norm(query).split(" ").filter(Boolean);
}

/** Score one token against one text field. 0 = no match. */
function tokenScore(token: string, text: string): number {
  if (!text) return 0;
  if (text === token) return 100;
  const idx = text.indexOf(token);
  if (idx === 0) return 60;                                   // prefix of the whole field
  if (idx > 0 && text[idx - 1] === " ") return 50;            // word start
  if (idx > 0) return 30;                                     // mid-word substring
  // Scattered subsequence — "kwr" → "k w r i". Only for tokens of 3+ chars,
  // and only when the first letter starts a word, or two-letter noise matches
  // everything.
  if (token.length < 3) return 0;
  let ti = 0;
  let startsWord = false;
  for (let i = 0; i < text.length && ti < token.length; i++) {
    if (text[i] === token[ti]) {
      if (ti === 0) startsWord = i === 0 || text[i - 1] === " ";
      ti++;
    }
  }
  return ti === token.length && startsWord ? 12 : 0;
}

export function scoreCommand(tokens: string[], cmd: Command): number {
  if (tokens.length === 0) return 1;
  const label = norm(cmd.label);
  const hint = norm(cmd.hint ?? "");
  const kws = (cmd.keywords ?? []).map(norm);
  let total = 0;
  for (const t of tokens) {
    const best = Math.max(
      tokenScore(t, label),
      tokenScore(t, hint) * 0.8,
      ...kws.map((k) => tokenScore(t, k) * 0.7),
    );
    if (best <= 0) return 0;   // AND: one token unmatched → no result
    total += best;
  }
  // Whole-query bonus: the typed phrase IS the label, or appears in it
  // contiguously. This is what lets "centcom iran" mean the board rather than
  // the country whose keywords happen to include its command.
  if (tokens.length > 1) {
    const joined = tokens.join(" ");
    if (label === joined) total += 100;
    else if (label.includes(joined)) total += 50;
  }
  return total;
}

export function rankCommands(query: string, commands: Command[], limit = DEFAULT_LIMIT): Command[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    // Nothing typed: the static navigation and actions, in group order. The
    // fetched entity lists would only be noise at that point.
    return commands
      .filter((c) => c.group === "go" || c.group === "act")
      .slice(0, limit);
  }
  const scored = commands
    .map((c) => ({ c, s: scoreCommand(tokens, c) }))
    .filter((x) => x.s > 0);
  scored.sort((a, b) =>
    b.s - a.s ||
    GROUP_ORDER.indexOf(a.c.group) - GROUP_ORDER.indexOf(b.c.group) ||
    a.c.label.localeCompare(b.c.label),
  );
  return scored.slice(0, limit).map((x) => x.c);
}

/** Group consecutive results for headed rendering, preserving rank order. */
export function groupResults(items: Command[]): { group: CommandGroup; items: Command[] }[] {
  const out: { group: CommandGroup; items: Command[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.group === it.group) last.items.push(it);
    else out.push({ group: it.group, items: [it] });
  }
  return out;
}
