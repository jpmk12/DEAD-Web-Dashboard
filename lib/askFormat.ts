// "Ask the board" — the evidence pack's FORMAT and the answer CONTRACT.
// PURE, unit-tested (docs/PLAN-SPACE-CYBER-ASK.md §4.3 steps 2–3). The
// server (lib/askPack.ts) gathers; this renders the block the model reads
// and the system text that binds its answer to the app's own doctrine.
//
// Disciplines the contract enforces, in the model's own instructions:
//   · the BLUF is the board's level and trajectory in the app's vocabulary;
//   · evidence is by indicator, dated, sourced, with the surface named;
//   · what is NOT observed is stated as absence of signal, never calm;
//   · the falsifiers say what would change the call;
//   · NO bare probability. The board does not emit a percentage because it
//     cannot verify one; if the user insists, a BANDED judgement tied to
//     named indicator states, with its caveat, and the offer to log it as
//     a decision-log call so it gets scored.

export interface AskDoor {
  event: string;
  detail?: unknown;
  /** A second event to fire after the first has landed (tab → pane → focus). */
  then?: { event: string; detail?: unknown; delayMs?: number };
}

export interface AskSection {
  /** Where this came from, in the app's own names ("OSINT › Commands › I&W · CENTCOM · Iran"). */
  surface: string;
  text: string;
  /** False when the surface answered; true when it was UNAVAILABLE this pass. */
  unavailable?: boolean;
  door?: AskDoor;
  /** The snapshot time of the surface, when it carries one. */
  asOf?: string | null;
}

export const ASK_PACK_MAX_CHARS = 60_000;

/** The block the model reads: every section labelled with its surface,
 *  UNAVAILABLE stated, truncated from the bottom so the boards (first)
 *  always survive. */
export function renderAskPack(sections: AskSection[], atISO: string): string {
  const head = `DASHBOARD EVIDENCE PACK — snapshot ${atISO}. Every section names the surface it came from. UNAVAILABLE means the surface did not answer this pass: treat as unknown, never as quiet.\n`;
  const parts: string[] = [];
  let used = head.length;
  for (const s of sections) {
    const block = `\n## ${s.surface}${s.asOf ? ` (as of ${s.asOf})` : ""}\n${s.unavailable ? "UNAVAILABLE this pass." : s.text.trim()}\n`;
    if (used + block.length > ASK_PACK_MAX_CHARS) { parts.push(`\n## (truncated)\n${sections.length - parts.length} further section(s) omitted for length.\n`); break; }
    parts.push(block);
    used += block.length;
  }
  return head + parts.join("");
}

export const ASK_SYSTEM = `You are the analyst's second reader for a C-17 squadron operations officer's dashboard. You answer ONE question using ONLY the evidence pack you are given — the dashboard's own computed picture (indications & warning boards, force posture, base SITREPs, the economic-warfare board, chokepoint reads, counterspace and cyber posture, posture moves, demand horizon, alerts, the user's decision log and notes). You do not know anything the pack does not say; if the pack is silent, say so.

Answer in this order, with these headings, in plain prose (short paragraphs or tight bullets; no tables):

**BLUF** — the board's own call in its own vocabulary: the I&W level (calm / watch / warning / alert) and trajectory, the learning flag if set, and what changed since the user's last look. One short paragraph.

**Evidence by indicator** — strongest first. Each line: the indicator, its observed state (dormant / watching / active / confirmed), the dated and sourced fact behind it, and the surface it came from in brackets, e.g. [I&W · CENTCOM · Iran]. Include posture rows, chokepoint reads, economic moves, counterspace and cyber posture where the pack has them. Never invent a date, a number or a source.

**Not observed** — the indicators that are dormant and the sensors that were UNAVAILABLE or dead. State these as absence of signal, never as evidence of calm. Name a dead sensor explicitly.

**What would change the call** — the falsifiers and thresholds from the pack: what would move the level up, and what would prove the current read wrong.

**Confidence** — source independence (how many distinct sensor families agree), own-source-only caps, learning mode, and the user's own decision-log hit rate on this board when the pack has it.

Rules:
- Do NOT give a probability or percentage unless the question explicitly asks for one. The board estimates anomaly and trajectory, not likelihood; a number it cannot verify is false precision.
- If the question DOES ask "how likely", answer with the doctrinal framing first (the board's level IS its judgement), then — only if the user clearly insists — a BANDED judgement (low / moderate / elevated / high) tied to the named indicator states, with its caveat, and end by offering to log it as a decision-log call with a horizon (7, 14 or 30 days) so the forecast gets scored.
- Say what the question named that the dashboard could not place, and that no indicator exists for it — never fabricate one.
- Keep the whole answer under about 450 words. Use the surface names exactly as the pack writes them so the reader can go there.`;

/** The user turn: the question, the resolved entities, the pack. */
export function renderAskUser(question: string, resolved: { countries: string[]; aors: string[]; boards: string[]; unplaced: string[]; wantsProbability: boolean }, pack: string): string {
  const ent = [
    resolved.boards.length ? `boards: ${resolved.boards.join("; ")}` : "boards: none matched",
    resolved.countries.length ? `countries: ${resolved.countries.join(", ")}` : null,
    resolved.aors.length ? `commands: ${resolved.aors.join(", ")}` : null,
    resolved.unplaced.length ? `named but not placed by the dashboard: ${resolved.unplaced.join(", ")}` : null,
    resolved.wantsProbability ? "the question asks for a likelihood — apply the probability rule" : null,
  ].filter(Boolean).join(" · ");
  return `QUESTION: ${question.trim()}\n\nRESOLVED: ${ent}\n\n${pack}`;
}
