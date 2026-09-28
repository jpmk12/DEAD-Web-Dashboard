// One-page OE brief — PURE, client-safe, unit-tested string builder.
//
// The I&W board, the OE delta, the demand horizon, posture and the decision
// log are what a commander briefs upward and hands sideways, and until now
// none of them left the dashboard except as a screenshot. This renders the
// same OeSnapshot the assistant reads (lib/oeContextFormat.ts) into ONE
// self-contained HTML file: zero JavaScript, zero external resources, prints
// to a single page, opens on a locked-down machine from a share drive.
//
// Same disciplines as the SITREP export: every dynamic string goes through
// esc() (drivers, titles and expectations are external or user text); the
// masthead says SNAPSHOT — NOT LIVE with the time; UNKNOWN / UNAVAILABLE are
// rendered as such, never dropped; and the footer states the sources and
// that the product is unofficial and open-source-derived.

import { esc } from "./sitrepExport";
import { AOR_LABELS } from "./aor";
import { CALL_LABEL, type DecisionEntry } from "./decisionLog";
import type { OeSnapshot } from "./oeContextFormat";

export interface OeBriefInput {
  snapshot: OeSnapshot;
  openDecisions: DecisionEntry[];
  preparedBy: string;
  missionSummary?: string | null;
}

const SEV_RANK: Record<string, number> = { red: 3, amber: 2, unknown: 1, green: 0 };
const LVL_RANK: Record<string, number> = { alert: 3, warning: 2, watch: 1, calm: 0 };
const LED_TXT: Record<string, string> = { g: "GREEN", a: "AMBER", r: "RED", u: "UNK" };
const AOR = (a: string) => (AOR_LABELS as Record<string, string>)[a] ?? a;

const stampOf = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
const sevCls = (s: string) => (s === "red" ? "r" : s === "amber" ? "a" : s === "green" ? "g" : "u");
const lvlCls = (l: string) => (l === "alert" ? "r" : l === "warning" ? "o" : l === "watch" ? "a" : "g");
const dirCls = (d: string) => (d === "rise" ? "r" : d === "fall" ? "g" : "u");

const unavailable = (what: string) => `<p class="na">${esc(what)} — UNAVAILABLE at snapshot time (not clear).</p>`;

export function renderOeBriefHtml(input: OeBriefInput): string {
  const s = input.snapshot;
  const stamp = stampOf(s.atISO);

  // ── BLUF counts ──
  const reds = (s.force ?? []).filter((r) => r.composite === "red").length;
  const unknowns = (s.force ?? []).filter((r) => r.composite === "unknown").length;
  const alerts = (s.alerts ?? []).length;
  const rising = (s.demand ?? []).filter((d) => d.direction === "rise").map((d) => AOR(d.aor));
  const boardsUp = (s.boards ?? []).filter((b) => b.level === "warning" || b.level === "alert").length;
  const changed = s.delta ? s.delta.worse.length + s.delta.better.length + s.delta.fresh.length : null;
  const bluf: string[] = [];
  bluf.push(reds > 0 ? `${reds} location${reds === 1 ? "" : "s"} at force-protection RED` : "no location at RED");
  if (unknowns > 0) bluf.push(`${unknowns} UNKNOWN (feed gap, not clear)`);
  bluf.push(boardsUp > 0 ? `${boardsUp} I&W board${boardsUp === 1 ? "" : "s"} at WARNING/ALERT` : "no I&W board above WATCH");
  bluf.push(rising.length > 0 ? `demand likely to rise in ${rising.join(", ")}` : "no command with rising demand");
  if (changed !== null) bluf.push(changed > 0 ? `${changed} level change${changed === 1 ? "" : "s"} since last look` : "no level change since last look");
  bluf.push(alerts > 0 ? `${alerts} active alert${alerts === 1 ? "" : "s"}` : "no active alerts");

  // ── What changed ──
  const deltaHtml = !s.delta
    ? unavailable("Change since last look")
    : (s.delta.worse.length + s.delta.better.length + s.delta.fresh.length === 0)
      ? `<p class="quiet">No posture, SITREP or I&amp;W level changed since the last look.</p>`
      : `<ul class="chg">${[
          ...s.delta.worse.map((w) => `<li class="r">▲ ${esc(w)}</li>`),
          ...s.delta.better.map((b) => `<li class="g">▼ ${esc(b)}</li>`),
          ...s.delta.fresh.map((f) => `<li class="a">new ${esc(f)}</li>`),
        ].join("")}</ul>`;

  // ── Demand horizon ──
  const demandHtml = s.demand === null || s.demand === undefined
    ? unavailable("Demand horizon")
    : s.demand.length === 0
      ? `<p class="quiet">No watched commands.</p>`
      : `<table><thead><tr><th>Command</th><th>7-day outlook</th><th>Score</th><th>Conf.</th><th>Drivers</th></tr></thead><tbody>${
          s.demand.map((d) => {
            const drivers = d.line.includes(" — ") ? d.line.slice(d.line.indexOf(" — ") + 3) : d.line;
            return `<tr><td><b>${esc(AOR(d.aor))}</b></td><td><span class="pill ${dirCls(d.direction)}">${esc(d.direction.toUpperCase())}</span></td><td class="num">${d.score >= 0 ? "+" : ""}${d.score}</td><td>${esc(d.confidence)}</td><td class="drv">${esc(drivers)}</td></tr>`;
          }).join("")
        }</tbody></table>`;

  // ── Force posture ──
  const forceHtml = s.force === null
    ? unavailable("Force posture")
    : s.force.length === 0
      ? `<p class="quiet">No watched countries or bases configured.</p>`
      : (() => {
          const sorted = s.force.slice().sort((a, b) => (SEV_RANK[b.composite] ?? 0) - (SEV_RANK[a.composite] ?? 0));
          const loud = sorted.filter((r) => r.composite !== "green");
          const quiet = sorted.length - loud.length;
          return `<table><thead><tr><th>Location</th><th>COCOM</th><th>Posture</th><th>Top driver</th><th>Note</th></tr></thead><tbody>${
            loud.slice(0, 14).map((r) => `<tr><td><b>${esc(r.label)}</b></td><td>${esc(r.cocom ? AOR(r.cocom) : "—")}</td><td><span class="pill ${sevCls(r.composite)}">${esc(r.composite.toUpperCase())}</span></td><td class="drv">${esc(r.topDriver)}</td><td class="note">${esc([r.escalated ? "escalated today" : "", r.chronicity ?? ""].filter(Boolean).join(" · "))}</td></tr>`).join("")
          }${loud.length > 14 ? `<tr><td colspan="5" class="note">…and ${loud.length - 14} more elevated</td></tr>` : ""}${quiet > 0 ? `<tr><td colspan="5" class="note">${quiet} green (not listed)</td></tr>` : ""}</tbody></table>`;
        })();

  // ── Base SITREP ──
  const sitrepHtml = s.sitrep === null
    ? unavailable("Base SITREP")
    : s.sitrep.length === 0
      ? `<p class="quiet">No SITREP bases configured.</p>`
      : `<table><thead><tr><th>Base</th><th>Wx</th><th>Ops</th><th>Threat</th><th>Infra</th><th>Driver</th></tr></thead><tbody>${
          s.sitrep.map((b) => `<tr><td><b>${esc(b.label)}</b> <span class="mono">${esc(b.icao)}</span></td>${(["wx", "ops", "threat", "infra"] as const).map((k) => `<td><span class="led ${b.status[k]}"></span>${LED_TXT[b.status[k]] ?? "UNK"}${b.worse.includes(k) ? ' <span class="worse">↑</span>' : ""}</td>`).join("")}<td class="drv">${esc(b.driver)}</td></tr>`).join("")
        }</tbody></table>`;

  // ── I&W boards + open calls ──
  const labelFor = new Map<string, string>();
  for (const b of s.boards ?? []) if (b.problemId) labelFor.set(b.problemId, b.label);
  const boardsHtml = s.boards === null
    ? unavailable("I&W boards")
    : s.boards.length === 0
      ? `<p class="quiet">No warning problems configured.</p>`
      : s.boards.slice().sort((a, b) => (LVL_RANK[b.level] ?? 0) - (LVL_RANK[a.level] ?? 0)).map((b) =>
          `<div class="board"><div class="board-h"><span class="pill ${lvlCls(b.level)}">${esc(b.level.toUpperCase())}</span> <b>${esc(b.label)}</b> <span class="mono">anomaly ${b.anomaly >= 0 ? "+" : ""}${b.anomaly.toFixed(2)} · ${esc(b.trajectory)}</span>${b.learning ? ' <span class="note">learning mode — level capped</span>' : ""}</div>${
            b.drivers.length ? `<div class="board-d">${b.drivers.slice(0, 3).map((d) => esc(d)).join(" · ")}</div>` : `<div class="board-d note">no active drivers</div>`
          }</div>`).join("");
  const now = Date.parse(s.atISO) || Date.now();
  const callsHtml = input.openDecisions.length === 0
    ? `<p class="quiet">No open calls on the decision log.</p>`
    : `<table><thead><tr><th>Board</th><th>Call</th><th>Expectation</th><th>Due</th><th>By</th></tr></thead><tbody>${
        input.openDecisions.slice(0, 10).map((d) => {
          const due = Date.parse(d.dueAt);
          const overdue = Number.isFinite(due) && due <= now;
          return `<tr${overdue ? ' class="due"' : ""}><td>${esc(labelFor.get(d.problemId) ?? d.problemId)}</td><td>${esc(CALL_LABEL[d.call] ?? d.call)}</td><td class="drv">${esc(d.expectation)}</td><td class="mono">${esc(d.dueAt.slice(0, 10))}${overdue ? " · DUE" : ""}</td><td class="note">${esc(d.by.split("@")[0])}</td></tr>`;
        }).join("")
      }</tbody></table>`;

  // ── Alerts ──
  const alertsHtml = s.alerts === null
    ? unavailable("Active alerts")
    : s.alerts.length === 0
      ? `<p class="quiet">None.</p>`
      : `<ul class="al">${s.alerts.map((a) => `<li><span class="pill ${a.severity === "red" ? "r" : "a"}">${esc(a.severity.toUpperCase())}</span> <b>${esc(a.title)}</b> — ${esc(a.sub)}</li>`).join("")}</ul>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OE Brief — ${esc(stamp)}</title>
<style>
:root{--bg:#0b1220;--fg:#e5e7eb;--mut:#94a3b8;--dim:#64748b;--ln:#1f2937;--r:#ef4444;--o:#f97316;--a:#f59e0b;--g:#22c55e;--u:#475569}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.page{max-width:1000px;margin:0 auto;padding:18px 22px}
.mast{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid var(--ln);padding-bottom:8px;margin-bottom:10px}
.mast h1{margin:0;font-size:18px;letter-spacing:.12em;text-transform:uppercase}.mast .sub{color:var(--mut);font-size:11px;margin-top:2px}
.stamp{text-align:right;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:var(--mut)}.stamp b{display:block;color:#fca5a5;font-size:12px;letter-spacing:.08em}
h2{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);margin:12px 0 4px;border-bottom:1px solid var(--ln);padding-bottom:2px}
.bluf{display:flex;flex-wrap:wrap;gap:6px}.bluf span{border:1px solid var(--ln);border-radius:4px;padding:2px 7px;font-size:11px;background:#111827}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}@media(max-width:720px){.grid{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;color:var(--dim);font-weight:600;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;padding:2px 4px;border-bottom:1px solid var(--ln)}
td{padding:3px 4px;border-bottom:1px solid #111827;vertical-align:top}td.num{font-family:ui-monospace,Menlo,monospace;text-align:right}td.drv{color:var(--mut)}
.pill{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.08em;padding:1px 6px;border-radius:3px;border:1px solid}
.pill.r{color:#fca5a5;border-color:#7f1d1d;background:#450a0a}.pill.o{color:#fdba74;border-color:#7c2d12;background:#431407}.pill.a{color:#fcd34d;border-color:#78350f;background:#451a03}.pill.g{color:#86efac;border-color:#14532d;background:#052e16}.pill.u{color:#cbd5e1;border-color:#334155;background:#1e293b}
.led{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}.led.g{background:var(--g)}.led.a{background:var(--a)}.led.r{background:var(--r)}.led.u{background:var(--u)}
.worse{color:var(--a);font-weight:700}.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;color:var(--mut)}.note{color:var(--dim);font-size:10.5px}
.quiet{color:var(--dim);margin:2px 0}.na{color:#fca5a5;margin:2px 0;font-weight:600}
ul.chg,ul.al{margin:2px 0;padding-left:16px}ul.chg li.r{color:#fca5a5}ul.chg li.g{color:#86efac}ul.chg li.a{color:#fcd34d}
.board{border-left:2px solid var(--ln);padding:3px 8px;margin:3px 0}.board-h{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.board-d{color:var(--mut);font-size:11px;margin-top:1px}
tr.due td{background:#2a1a05}
.foot{margin-top:12px;border-top:1px solid var(--ln);padding-top:6px;color:var(--dim);font-size:9.5px;line-height:1.5}
@media print{body{background:#fff;color:#111}.page{padding:0}.mast .stamp b{color:#b91c1c}.bluf span,td,th,.board{border-color:#ddd}td.drv,.note,.mono,.quiet{color:#444}.pill{-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{color:#333;border-color:#ccc}.foot{color:#555}}
</style></head><body><div class="page">
<div class="mast"><div><h1>Operational Environment Brief</h1><div class="sub">${esc(input.missionSummary ?? "DEAD's Dashboard — open-source, unofficial")}</div><div class="sub">Prepared by ${esc(input.preparedBy)}</div></div>
<div class="stamp"><b>SNAPSHOT AS OF ${esc(stamp)} — NOT LIVE</b>7-day horizon · sources listed below${s.stale ? "<br>snapshot was stale at export" : ""}</div></div>

<h2>BLUF</h2><div class="bluf">${bluf.map((b) => `<span>${esc(b)}</span>`).join("")}</div>

<div class="grid">
<div><h2>What changed since last look</h2>${deltaHtml}</div>
<div><h2>Active alerts</h2>${alertsHtml}</div>
</div>

<h2>7-day demand horizon (deterministic)</h2>${demandHtml}
${s.crew ? `<h2>Team state — crews against demand</h2><p class="${s.crew.declared ? (s.crew.mismatches.length ? "na" : "") : "quiet"}">${esc(s.crew.headline)}</p>${s.crew.mismatches.length ? `<ul class="chg">${s.crew.mismatches.map((m) => `<li class="a">${esc(m)}</li>`).join("")}</ul>` : ""}` : ""}

<h2>Force posture</h2>${forceHtml}

<h2>Base SITREP</h2>${sitrepHtml}

<h2>Indications &amp; warning</h2>${boardsHtml}

<h2>Open calls on the decision log</h2>${callsHtml}

<div class="foot">UNOFFICIAL — derived from open sources by DEAD's Dashboard (force posture: GDACS/USGS/ReliefWeb/NWS/State Dept/UCDP/ACLED/DAIP/WHO/IODA; I&amp;W: open-doctrine indicators over the same feeds; demand horizon: deterministic roll-up, rise ≥ +25 / fall ≤ −15, confidence = independent sources). UNKNOWN and UNAVAILABLE mean a feed did not answer — never "clear". ACLED data © Armed Conflict Location &amp; Event Data Project (acleddata.com). This file contains no scripts and loads no external resources.</div>
</div></body></html>`;
}

/** File name for the download, e.g. OE-BRIEF-20260928-1405Z.html */
export function oeBriefFilename(atISO: string): string {
  return `OE-BRIEF-${atISO.slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}Z.html`;
}
