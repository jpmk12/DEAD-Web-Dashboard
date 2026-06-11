import type { ThreadsResult, NewsThread } from "./types";

// Self-contained dark-themed HTML for the briefing/digest/threads views.
// Each builder returns a complete HTML document (inline styles only — no
// external CSS or JS) so it can be opened in a new window for PDF print or
// saved as a .html file. When `printOnOpen` is true a tiny script triggers
// the browser's print dialog (used for the PDF export path).

interface Briefing {
  headline: string;
  schedule: string[];
  keyDevelopments: string[];
  topStories: string[];
  trends?: string[];
  connections: string;
  suggestedFocus: string[];
}

interface Digest {
  topTopics: string[];
  readingInsight: string;
  coverageGaps: string;
  nextWeekRecommendations: string[];
}

// Escape user-supplied text for HTML embedding.
function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Shared <head>/<style>/wrapper. Dark theme constants come from FEATURES.md §8.
function shell(title: string, body: string, printOnOpen: boolean): string {
  const printScript = printOnOpen
    ? `<script>window.addEventListener("load", () => setTimeout(() => window.print(), 250));</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
* { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
html, body { margin: 0; padding: 0; background: #020617; color: #f1f5f9; font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 760px; margin: 0 auto; padding: 28px 32px 48px; }
.bar { height: 4px; background: linear-gradient(90deg, #10b981, #3b82f6, #8b5cf6); border-radius: 2px; margin-bottom: 22px; }
header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid #1e293b; margin-bottom: 22px; }
h1 { margin: 0 0 4px; font-size: 16px; letter-spacing: 0.15em; text-transform: uppercase; color: #f1f5f9; font-weight: 700; }
.meta { font-size: 11px; color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
section { margin: 22px 0; }
section h2 { margin: 0 0 10px; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #94a3b8; font-weight: 700; }
.card { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 16px 18px; color: #cbd5e1; }
.headline { color: #f1f5f9; font-size: 15px; line-height: 1.5; font-weight: 500; }
ul { margin: 0; padding: 0 0 0 20px; }
li { margin: 6px 0; color: #cbd5e1; }
.pill { display: inline-block; padding: 4px 10px; margin: 0 6px 6px 0; background: #0f172a; border: 1px solid #1e293b; border-radius: 999px; font-size: 11px; color: #cbd5e1; }
.thread { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 16px; margin: 0 0 12px; }
.thread .label { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.thread .head { color: #f1f5f9; font-weight: 600; margin: 2px 0 6px; }
.thread .summary { color: #cbd5e1; font-size: 12.5px; }
.trend-rising { color: #34d399; } .trend-fading { color: #f87171; } .trend-stable { color: #94a3b8; }
.footer { color: #475569; font-size: 10px; text-align: center; margin-top: 28px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
@media print {
  html, body { background: #020617 !important; }
  .wrap { padding-top: 0; }
}
@page { margin: 10mm 15mm; background: #020617; }
</style>
</head>
<body>
<div class="wrap">
  <div class="bar"></div>
  ${body}
  <div class="footer">DEAD’s Dashboard · ${esc(formatDate())}</div>
</div>
${printScript}
</body>
</html>`;
}

function list(items: string[]): string {
  if (!items?.length) return "";
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

// ─── Briefing ────────────────────────────────────────────────────────────────

export function buildBriefingHTML(b: Briefing, printOnOpen: boolean): string {
  const body = `
    <header>
      <div>
        <h1>Morning Brief</h1>
        <div class="meta">${esc(formatDate())}</div>
      </div>
    </header>

    ${b.headline ? `<section><h2>Headline</h2><div class="card headline">${esc(b.headline)}</div></section>` : ""}
    ${b.schedule?.length ? `<section><h2>Today’s Schedule</h2><div class="card">${list(b.schedule)}</div></section>` : ""}
    ${b.keyDevelopments?.length ? `<section><h2>Key Developments</h2><div class="card">${list(b.keyDevelopments)}</div></section>` : ""}
    ${b.topStories?.length ? `<section><h2>Top Stories</h2><div class="card">${list(b.topStories)}</div></section>` : ""}
    ${b.trends?.length ? `<section><h2>Trending — week over week</h2><div class="card">${list(b.trends)}</div></section>` : ""}
    ${b.connections ? `<section><h2>Connections</h2><div class="card">${esc(b.connections)}</div></section>` : ""}
    ${b.suggestedFocus?.length ? `<section><h2>Suggested Focus</h2><div class="card">${list(b.suggestedFocus)}</div></section>` : ""}
  `;
  return shell("Morning Brief", body, printOnOpen);
}

// ─── Digest ──────────────────────────────────────────────────────────────────

export function buildDigestHTML(d: Digest, printOnOpen: boolean): string {
  const topics = d.topTopics?.length
    ? `<section><h2>Top Topics</h2><div class="card">${d.topTopics.map((t) => `<span class="pill">${esc(t)}</span>`).join("")}</div></section>`
    : "";
  const body = `
    <header>
      <div>
        <h1>Weekly Digest</h1>
        <div class="meta">${esc(formatDate())}</div>
      </div>
    </header>

    ${topics}
    ${d.readingInsight ? `<section><h2>Reading Pattern</h2><div class="card">${esc(d.readingInsight)}</div></section>` : ""}
    ${d.coverageGaps ? `<section><h2>Coverage Gaps</h2><div class="card">${esc(d.coverageGaps)}</div></section>` : ""}
    ${d.nextWeekRecommendations?.length ? `<section><h2>For Next Week</h2><div class="card">${list(d.nextWeekRecommendations)}</div></section>` : ""}
  `;
  return shell("Weekly Digest", body, printOnOpen);
}

// ─── Threads ─────────────────────────────────────────────────────────────────

const TREND_LABEL = { rising: "↑ rising", stable: "→ stable", fading: "↓ fading" } as const;

export function buildThreadsHTML(t: ThreadsResult, printOnOpen: boolean): string {
  const threadCards = (t.threads ?? [])
    .map((th: NewsThread) => {
      const trend = TREND_LABEL[th.trend] ?? "→ stable";
      const trendClass = `trend-${th.trend}`;
      return `<div class="thread">
        <div class="label">${esc(th.label)} · <span class="${trendClass}">${esc(trend)}</span></div>
        <div class="head">${esc(th.headline)}</div>
        <div class="summary">${esc(th.summary)}</div>
      </div>`;
    })
    .join("");
  const body = `
    <header>
      <div>
        <h1>News Threads</h1>
        <div class="meta">${esc(formatDate())}</div>
      </div>
    </header>

    ${t.throughLine ? `<section><h2>Through-Line</h2><div class="card headline">${esc(t.throughLine)}</div></section>` : ""}
    ${threadCards ? `<section><h2>Threads</h2>${threadCards}</section>` : ""}
  `;
  return shell("News Threads", body, printOnOpen);
}

// ─── Browser triggers ────────────────────────────────────────────────────────

export function openPrintWindow(html: string): void {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

export function downloadHTML(html: string, baseName: string): void {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
