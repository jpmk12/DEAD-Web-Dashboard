// Keeping an assessment the assistant wrote — export it, or save it as a
// doc (REVIEW follow-up, 2026-10-22: "a way to export assessments I like
// from the chat or to append them to my working docs").
//
// PURE + client-safe (string math only; ChatPanel imports it). Three
// products from one record:
//   assessmentMarkdown  — the doc body for Save-as-doc and the .md download
//   renderAssessmentHtml — ONE self-contained HTML file, ZERO JavaScript and
//                          zero external resources (the sitrepExport /
//                          oeBriefExport discipline), with the same
//                          "SNAPSHOT AS OF …Z — NOT LIVE" stamp
//   assessmentTitle / assessmentFileName — the names
//
// The answer is MODEL OUTPUT over external content, so every dynamic string
// is escaped: the markdown → HTML step is `miniMarkdownToHtml`, which escapes
// BEFORE transforming, and the masthead strings go through `esc`. Provenance
// is part of the record, not decoration: the question asked, the surfaces
// the board read, what was UNAVAILABLE that pass (stated, never dropped),
// what the resolver could not place, and the model.

import { esc } from "./sitrepExport";
import { miniMarkdownToHtml } from "./composeDocs";

export interface AssessmentRecord {
  /** The question the user asked (the preceding user turn). */
  question: string;
  /** The assistant's answer, markdown, WITHOUT the client's "answered from the board" note. */
  answer: string;
  /** When the answer was produced — the pack's snapshot time for a board answer, else the client's clock. */
  atISO: string;
  /** "board" = /api/ask under the contract; "assistant" = the ordinary chat. */
  source: "board" | "assistant";
  model?: string | null;
  /** The surfaces the pack carried (board answers only). */
  surfaces?: { label: string; unavailable?: boolean }[];
  unavailable?: string[];
  unplaced?: string[];
  preparedBy?: string | null;
}

export const ASSESSMENT_TAG = "assessment";
const TITLE_MAX = 80;

/** Strip the client-side note appended to an auto-routed board answer. */
export function stripBoardNote(answer: string): string {
  return answer.replace(/\n\n_Answered from the board[^\n]*_\s*$/, "").trim();
}

const firstLine = (s: string): string => (s.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").replace(/^#+\s*/, "").replace(/\*\*/g, "");

/** `Assessment — <question> (YYYY-MM-DD)`; a chat answer with no question
 *  falls back to its own first line. */
export function assessmentTitle(a: AssessmentRecord): string {
  const base = (a.question.trim() || firstLine(a.answer) || "Untitled").replace(/\s+/g, " ");
  const cut = base.length > TITLE_MAX ? base.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, "") + "…" : base;
  return `Assessment — ${cut} (${a.atISO.slice(0, 10)})`;
}

export function assessmentFileName(a: AssessmentRecord, ext: "html" | "md"): string {
  const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  // A question made of punctuation alone slugs to nothing — fall back to the answer.
  const slug = slugOf(a.question) || slugOf(firstLine(a.answer)) || "assessment";
  return `assessment-${slug}-${a.atISO.slice(0, 10)}.${ext}`;
}

const stamp = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;

/** The doc body. Provenance first (one line each), the answer, then what
 *  the board read and what it could not — a saved assessment with no
 *  record of its inputs cannot be re-evaluated later. */
export function assessmentMarkdown(a: AssessmentRecord): string {
  const live = (a.surfaces ?? []).filter((s) => !s.unavailable).map((s) => s.label);
  const unavailable = [...new Set([...(a.unavailable ?? []), ...(a.surfaces ?? []).filter((s) => s.unavailable).map((s) => s.label)])];
  const lines: string[] = [];
  lines.push(`# ${assessmentTitle(a)}`, "");
  lines.push(`**Asked:** ${a.question.trim() || "—"}  `);
  lines.push(`**Answered:** ${stamp(a.atISO)} · ${a.source === "board" ? "from the board (dashboard evidence pack)" : "the assistant (chat context)"}${a.model ? ` · ${a.model}` : ""}  `);
  if (a.preparedBy) lines.push(`**Prepared by:** ${a.preparedBy}  `);
  lines.push("", "> Snapshot — not live. The reading reflects what the dashboard held at the time above; re-ask the board for the current picture.", "");
  lines.push("## Assessment", "", stripBoardNote(a.answer), "");
  if (live.length > 0) lines.push("## Surfaces read", "", ...live.map((s) => `- ${s}`), "");
  if (unavailable.length > 0) lines.push("## Unavailable that pass", "", ...unavailable.map((s) => `- ${s} — UNAVAILABLE, not evidence of calm`), "");
  if ((a.unplaced ?? []).length > 0) lines.push("## Not placed", "", `The board could not place: ${(a.unplaced ?? []).join(", ")}.`, "");
  return lines.join("\n").trimEnd() + "\n";
}

/** The standalone HTML file — opens from a desktop / share drive / email
 *  attachment with no login, no network, no script. */
export function renderAssessmentHtml(a: AssessmentRecord): string {
  const title = assessmentTitle(a);
  const live = (a.surfaces ?? []).filter((s) => !s.unavailable).map((s) => s.label);
  const unavailable = [...new Set([...(a.unavailable ?? []), ...(a.surfaces ?? []).filter((s) => s.unavailable).map((s) => s.label)])];
  const body = miniMarkdownToHtml(stripBoardNote(a.answer));
  const li = (xs: string[]) => xs.map((x) => `<li>${esc(x)}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#0b1220;color:#e2e8f0;font:15px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 20px 48px}
.stamp{display:inline-block;border:1px solid #f59e0b;color:#fbbf24;font-weight:700;font-size:12px;letter-spacing:.08em;padding:4px 10px;border-radius:4px;margin-bottom:14px}
h1{font-size:22px;line-height:1.25;margin:0 0 10px}
.meta{font-size:12px;color:#94a3b8;margin:0 0 18px}
.meta b{color:#cbd5e1;font-weight:600}
.q{border-left:3px solid #38bdf8;padding:8px 12px;margin:0 0 22px;background:#0f172a;border-radius:0 6px 6px 0}
.q .lbl{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#7dd3fc;margin-bottom:2px}
.answer h1,.answer h2,.answer h3{font-size:15px;margin:18px 0 6px;color:#f1f5f9;text-transform:uppercase;letter-spacing:.06em}
.answer h1{font-size:16px}
.answer p{margin:0 0 10px}
.answer ul,.answer ol{margin:0 0 10px;padding-left:22px}
.answer li{margin:2px 0}
.answer blockquote{margin:0 0 10px;padding:6px 12px;border-left:3px solid #475569;color:#cbd5e1}
.answer pre{background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:10px;overflow-x:auto;font-size:13px}
.answer code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.answer a{color:#7dd3fc}
.answer hr{border:0;border-top:1px solid #1e293b;margin:14px 0}
section.prov{margin-top:26px;border-top:1px solid #1e293b;padding-top:14px}
section.prov h2{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin:12px 0 6px}
section.prov ul{margin:0;padding-left:20px;font-size:13px}
.una li{color:#fcd34d}
.foot{margin-top:28px;font-size:11px;color:#64748b}
@media print{body{background:#fff;color:#111}.q,.answer pre{background:#f3f4f6}.stamp{color:#92400e;border-color:#92400e}.meta,.foot,section.prov h2{color:#444}.answer a{color:#1d4ed8}.una li{color:#92400e}}
</style></head><body><main>
<div class="stamp">SNAPSHOT AS OF ${esc(stamp(a.atISO))} — NOT LIVE</div>
<h1>${esc(title)}</h1>
<p class="meta"><b>Answered</b> ${esc(stamp(a.atISO))} · <b>Source</b> ${a.source === "board" ? "the board (dashboard evidence pack)" : "the assistant (chat context)"}${a.model ? ` · <b>Model</b> ${esc(a.model)}` : ""}${a.preparedBy ? ` · <b>Prepared by</b> ${esc(a.preparedBy)}` : ""}</p>
<div class="q"><span class="lbl">Question</span>${esc(a.question.trim() || "—")}</div>
<div class="answer">${body}</div>
<section class="prov">
${live.length > 0 ? `<h2>Surfaces read</h2><ul>${li(live)}</ul>` : ""}
${unavailable.length > 0 ? `<h2>Unavailable that pass</h2><ul class="una">${li(unavailable.map((u) => `${u} — UNAVAILABLE, not evidence of calm`))}</ul>` : ""}
${(a.unplaced ?? []).length > 0 ? `<h2>Not placed</h2><ul>${li(a.unplaced ?? [])}</ul>` : ""}
</section>
<p class="foot">Unofficial. Generated by the dashboard assistant from open sources and the dashboard's own computed picture; the reading is a snapshot, not a live feed. Re-ask the board for the current picture.</p>
</main></body></html>`;
}
