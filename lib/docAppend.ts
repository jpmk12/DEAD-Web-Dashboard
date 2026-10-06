// Running logs — the "append a thought to my China references" primitive
// (REVIEW-2026-10 §9 D4). PURE, client-safe, unit-tested.
//
// A log is an ordinary document (doc type `log`) whose body is a sequence of
// DATED ENTRIES, each a level-3 heading `### YYYY-MM-DD — from <source>`
// followed by the text and, when the entry came from somewhere, a source line
// (`_title_ · [source](url) · thread [[label]]`). Entries append at the END
// (chronological, the way a log reads); the landing shows the LATEST entry by
// parsing the same shape back. Nothing here guesses a date — the caller
// passes the day it appended.

export interface LogEntryInput {
  date: string;              // YYYY-MM-DD (the caller's effective day)
  text: string;              // the thought / thesis / excerpt (markdown)
  source: string;            // "News · Foreign Policy" · "OSINT" · "assistant" · "selection on Email"
  sourceTitle?: string;      // the article / email / item title
  sourceUrl?: string;        // https link, when there is one
  thread?: string;           // a News thread label → [[wiki-link]]
}

export interface LogEntry { date: string; source: string; text: string; sourceTitle?: string; sourceUrl?: string }

const ENTRY_RE = /^### (\d{4}-\d{2}-\d{2}) — from (.+)$/;

const cleanLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** The markdown for one entry (no leading blank line). */
export function entryMarkdown(e: LogEntryInput): string {
  const head = `### ${e.date} — from ${cleanLine(e.source) || "note"}`;
  const body = e.text.trim();
  const refs: string[] = [];
  if (e.sourceTitle) refs.push(`_${cleanLine(e.sourceTitle).replace(/_/g, "\\_")}_`);
  if (e.sourceUrl && /^https?:\/\//i.test(e.sourceUrl)) refs.push(`[source](${e.sourceUrl.trim()})`);
  if (e.thread) refs.push(`thread [[${cleanLine(e.thread).replace(/[\[\]|]/g, "")}]]`);
  return [head, body, refs.length ? refs.join(" · ") : ""].filter(Boolean).join("\n");
}

/** Append one entry to a doc's content. The content is never rewritten,
 *  only extended; a blank doc starts with the entry. */
export function appendEntry(content: string, e: LogEntryInput): string {
  const base = content.replace(/\s+$/, "");
  return (base ? `${base}\n\n` : "") + entryMarkdown(e) + "\n";
}

/** Every dated entry in a log, in document order. Text runs to the next
 *  `###`/`##`/`#` heading; the trailing refs line is split out when present. */
export function parseEntries(content: string): LogEntry[] {
  const lines = content.split("\n");
  const out: LogEntry[] = [];
  let cur: { date: string; source: string; body: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.body.slice();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    let sourceTitle: string | undefined, sourceUrl: string | undefined;
    const last = body[body.length - 1] ?? "";
    if (/^(_.+_|\[source\]\(|thread \[\[)/.test(last.trim()) && /(_[^_]+_|\[source\]\(https?:[^)]+\)|thread \[\[)/.test(last)) {
      const t = last.match(/^_((?:\\_|[^_])+)_/); if (t) sourceTitle = t[1].replace(/\\_/g, "_");
      const u = last.match(/\[source\]\((https?:[^)]+)\)/); if (u) sourceUrl = u[1];
      body.pop();
    }
    out.push({ date: cur.date, source: cur.source, text: body.join("\n").trim(), ...(sourceTitle ? { sourceTitle } : {}), ...(sourceUrl ? { sourceUrl } : {}) });
    cur = null;
  };
  for (const line of lines) {
    const m = line.match(ENTRY_RE);
    if (m) { flush(); cur = { date: m[1], source: m[2].trim(), body: [] }; continue; }
    if (cur) {
      if (/^#{1,3} /.test(line)) { flush(); continue; }
      cur.body.push(line);
    }
  }
  flush();
  return out;
}

/** The newest entry by date (ties → the later one in the document). */
export function latestEntry(content: string): LogEntry | null {
  const all = parseEntries(content);
  if (!all.length) return null;
  return all.reduce((best, e) => (e.date >= best.date ? e : best), all[0]);
}

export const entryCount = (content: string): number => parseEntries(content).length;

/** One line for a card: the entry's first sentence, capped. */
export function entryExcerpt(e: LogEntry, max = 180): string {
  const first = e.text.replace(/^[>#*\-\s]+/, "").split(/\n/)[0] ?? "";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}
