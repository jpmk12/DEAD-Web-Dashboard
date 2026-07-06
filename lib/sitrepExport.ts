// Standalone SITREP export — renders an assembled SitrepPayload (+ optional
// Commander's Read) into ONE self-contained HTML string for sharing outside
// the dashboard: no auth, no server, no network, ZERO JavaScript and zero
// external resources, so it opens from a desktop / share drive / email
// attachment on locked-down machines and prints cleanly.
//
// PURE + client-safe (string math only; SitrepPanel imports it). Every piece
// of dynamic text goes through esc() — NOTAM text and news titles are
// external content and must never inject markup. Snapshot semantics are
// explicit: a big "AS OF …Z — NOT LIVE" stamp, per-row source tags, and the
// same UNKNOWN-≠-clear discipline as the pane.

import type { SitrepPayload } from "./sitrep";
import { closureWindows, windowConflicts, type Led } from "./sitrepSignals";
import type { FlightCategory } from "./types";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LED_LABEL: Record<Led, string> = { g: "GREEN", a: "AMBER", r: "RED", u: "UNKNOWN" };
const CAT_CLS: Record<FlightCategory, string> = { VFR: "vfr", MVFR: "mvfr", IFR: "ifr", LIFR: "lifr", UNKNOWN: "ukn" };

const zhm = (ms: number) => new Date(ms).toISOString().slice(11, 16) + "Z";
const hh = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) + "Z" : "—");

function ledDot(l: Led): string {
  return `<span class="led ${l}"></span>`;
}

function row(sev: Led | "b", body: string, src: string): string {
  return `<div class="row"><span class="dot ${sev}"></span><div>${body}</div><span class="tag">${esc(src)}</span></div>`;
}

// One HTML document. `read` is the Commander's Read if the pane has it.
export function renderSitrepHtml(p: SitrepPayload, read: { bluf: string[]; watch: string[] } | null): string {
  const nowMs = Date.parse(p.generatedAt);
  const stamp = `${p.generatedAt.slice(0, 10)} ${p.generatedAt.slice(11, 16)}Z`;

  // ── masthead LED texts (same derivations as the pane's status strip) ──
  const wxText = p.weather.now
    ? `${p.weather.now.flightCategory}${p.weather.tafWorst && p.weather.tafWorst.worst !== p.weather.now.flightCategory ? ` → ${p.weather.tafWorst.worst} fcst` : ""}`
    : "no METAR";
  const opsText = p.ops.fieldClosed ? "FIELD CLOSED (NOTAM)"
    : p.ops.limiting ? "limiting NOTAM active"
    : p.ops.configured && p.ops.live ? `${p.ops.notamCount} NOTAMs, none limiting`
    : "DAIP unavailable — UNKNOWN";
  const thrText = p.threats.fp ? p.threats.fp.topDriver : "assessment unavailable";
  const infraText = !p.infra.internet.live && !p.infra.nas?.live ? "sensors unreachable — UNKNOWN"
    : p.infra.internet.led === "r" || p.infra.internet.led === "a" ? "internet degradation detected"
    : p.infra.nas?.nearby.some((x) => x.kind === "closure" || x.kind === "groundStop") ? "NAS program nearby"
    : p.infra.powerNews.length > 0 ? "power reporting in local news"
    : "no degradation detected";

  const mastLeds = ([
    ["Weather", p.status.wx, wxText],
    ["Ops / Airfield", p.status.ops, opsText],
    ["Threat", p.status.threat, thrText],
    ["Infrastructure", p.status.infra, infraText],
  ] as [string, Led, string][])
    .map(([k, l, v]) => `<div class="ledbox">${ledDot(l)}<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div></div>`)
    .join("");

  // ── BLUF ──
  const blufHtml = read && read.bluf.length > 0
    ? `<div class="bluf"><div class="t">Commander's Read — BLUF</div><ul>${read.bluf.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>${
        read.watch.length > 0 ? `<p class="w"><b>Watch:</b> ${read.watch.map(esc).join(" · ")}</p>` : ""
      }</div>`
    : "";

  // ── weather ──
  const horizon24 = 24 * 3600_000;
  const tafBar = p.weather.tafSegments.length > 0
    ? `<div class="tafbar">${p.weather.tafSegments.map((s) => {
        const w = Math.max(1, ((Math.min(s.toMs, nowMs + horizon24) - Math.max(s.fromMs, nowMs)) / horizon24) * 100);
        return `<div class="seg ${CAT_CLS[s.cat]}" style="width:${w.toFixed(1)}%">${s.cat}</div>`;
      }).join("")}</div><div class="axis"><span>${esc(zhm(nowMs))}</span><span>+6h</span><span>+12h</span><span>+18h</span><span>+24h</span></div>`
    : "";
  const weatherRows: string[] = [];
  if (!p.weather.live && !p.weather.metarRaw) weatherRows.push(row("u", "<b>AWC unreachable</b> — current conditions UNKNOWN, not clear", "AWC"));
  for (const a of p.weather.alerts) {
    weatherRows.push(row(a.lifeThreatening || a.severity === "Extreme" ? "r" : "a", `<b>${esc(a.event)}</b> [${esc(a.severity)}${a.lifeThreatening ? " / LIFE-THREAT" : ""}] — ${esc(a.headline.slice(0, 180))}`, "NWS"));
  }
  if (p.weather.outlook.length > 0) {
    weatherRows.push(row("b", `Outlook: ${p.weather.outlook.map((d) => `${esc(d.date.slice(5))} ${d.hiF ?? "?"}/${d.loF ?? "?"}°F precip ${d.precipPct ?? "?"}%`).join(" · ")}`, "Open-Meteo"));
  }
  weatherRows.push(row("b", `☉ ${hh(p.astro.sunriseZ)}–${hh(p.astro.sunsetZ)} · civil ${hh(p.astro.civilDawnZ)}/${hh(p.astro.civilDuskZ)} · ☽ ${p.astro.moon.illumPct}% ${esc(p.astro.moon.phaseName)}`, "astro"));

  // ── ops ──
  const opsRows: string[] = [];
  if (!p.ops.configured || !p.ops.live) {
    opsRows.push(row("u", "<b>DAIP NOTAM feed unreachable</b> — airfield status UNKNOWN, not clear", "DAIP"));
  } else {
    opsRows.push(row(p.ops.fieldClosed ? "r" : p.ops.limiting ? "a" : "g",
      `<b>Field ${p.ops.fieldClosed ? "CLOSED (NOTAM)" : p.ops.limiting ? "OPEN — limiting NOTAM active" : "OPEN"}</b> · ${p.ops.notamCount} active NOTAMs${p.ops.capability ? ` · longest runway ${p.ops.capability.lengthFt.toLocaleString()} ft ${esc(p.ops.capability.surface)} (${esc(p.ops.capability.cls)})` : ""}`,
      "DAIP"));
  }
  for (const g of p.ops.groups) {
    for (const n of g.items.slice(0, 4)) {
      opsRows.push(row(n.amber ? "a" : "u", `${n.amber ? "<b>" : ""}[${esc(g.label)}] ${esc(n.text.slice(0, 200))}${n.amber ? "</b>" : ""}`, "DAIP"));
    }
  }
  if (p.ops.center) {
    opsRows.push(p.ops.center.live
      ? row(p.ops.center.count > 0 ? "u" : "g", `Center (${esc(p.ops.center.code)} ARTCC): ${p.ops.center.count} active enroute NOTAMs`, "DAIP")
      : row("u", `Center (${esc(p.ops.center.code)} ARTCC) UNREACHABLE — UNKNOWN`, "DAIP"));
  }
  const windChips = p.ops.runwayWinds.length > 0
    ? `<div class="chips">${p.ops.runwayWinds.map((r) =>
        `<span class="chip${r.flag === "r" ? " bad" : r.flag === "a" ? " warn" : ""}">RWY ${esc(r.ident)} · ${r.headKt >= 0 ? `head ${r.headKt}` : `TAIL ${-r.headKt}`} · x${r.crossKt}${r.gustCrossKt ? `G${r.gustCrossKt}` : ""}kt</span>`
      ).join("")}</div>`
    : "";

  // closure-window timeline (48 h), same pure math as the pane
  const windows = closureWindows(p.ops.groups.flatMap((g) => g.items), nowMs, 48);
  const conflicts = windowConflicts(windows, p.weather.tafSegments);
  const rowsByLabel = new Map<string, typeof windows>();
  for (const w of windows) {
    const arr = rowsByLabel.get(w.label) ?? [];
    arr.push(w);
    rowsByLabel.set(w.label, arr);
  }
  const span48 = 48 * 3600_000;
  const timelineHtml = windows.length > 0
    ? `<div class="tlwrap"><div class="tlhead">Closure windows — next 48 h (Z)</div>` +
      `<div class="axis axis48"><span>${esc(zhm(nowMs))}</span><span>+12h</span><span>+24h</span><span>+36h</span><span>+48h</span></div>` +
      [...rowsByLabel.entries()].map(([label, ws]) =>
        `<div class="tlrow"><div class="tllab">${esc(label)}</div><div class="tltrack">${ws.map((w) => {
          const left = ((w.fromMs - nowMs) / span48) * 100;
          const width = Math.max(1.5, ((w.toMs - w.fromMs) / span48) * 100);
          const cls = w.kind === "closure" ? "red" : w.kind === "unserviceable" ? "amb" : "sky";
          const lbl = `${zhm(w.fromMs)}–${w.openEnded ? "UFN" : zhm(w.toMs)}`;
          return `<span class="bar ${cls}" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%" title="${esc(w.text)}">${width > 12 ? esc(lbl) : ""}</span>`;
        }).join("")}</div></div>`
      ).join("") +
      conflicts.map((c) => `<div class="conflict">⚠ <b>Window conflict:</b> ${esc(c)}</div>`).join("") +
      `</div>`
    : "";

  // ── threats ──
  const threatRows: string[] = [];
  if (p.threats.fp) {
    const sev: Led = p.threats.fp.composite === "red" ? "r" : p.threats.fp.composite === "amber" ? "a" : "g";
    threatRows.push(row(sev, `<b>FP composite: ${esc(p.threats.fp.composite.toUpperCase())}</b> — ${esc(p.threats.fp.topDriver)}`, "FP"));
    for (const ax of p.threats.fp.axes) {
      if (ax.severity !== "green" && ax.severity !== "unknown") threatRows.push(row(ax.severity === "red" ? "r" : "a", `${esc(ax.key)}: ${esc(ax.summary.slice(0, 140))}`, "FP"));
    }
  } else {
    threatRows.push(row("u", "Force Protection assessment unavailable this cycle — UNKNOWN", "FP"));
  }
  threatRows.push(p.threats.disasters.length === 0
    ? row("g", "No natural disasters within 500 km", "GDACS")
    : p.threats.disasters.map((d) => row(d.severity === "red" ? "r" : "a", `<b>${esc(d.type)}</b> ${d.km} km — ${esc(d.title.slice(0, 140))}`, "GDACS")).join(""));
  threatRows.push(p.threats.news.length === 0
    ? row("g", `Nothing impact-relevant in local reporting (${p.threats.newsScanned} scanned)`, "GDELT")
    : p.threats.news.map((n) => row("a", `${esc(n.title.slice(0, 160))} <span class="dim">(matched: ${n.matched.map(esc).join(", ")})</span>`, "GDELT")).join(""));

  // ── infrastructure ──
  const infraRows: string[] = [];
  if (p.infra.internet.live) {
    infraRows.push(row(p.infra.internet.led, `<b>Internet (${esc(p.infra.internet.entity ?? "region")}):</b> ${
      p.infra.internet.led === "g" ? "no macro degradation" : p.infra.internet.led === "u" ? "insufficient signal data" : "degradation detected"
    } — ${p.infra.internet.series.map((s) => `${esc(s.label)} −${s.dropPct ?? "?"}%`).join(" · ")}`, "IODA"));
  } else {
    infraRows.push(row("u", "<b>Internet:</b> IODA unreachable — UNKNOWN", "IODA"));
  }
  if (p.infra.nas) {
    infraRows.push(p.infra.nas.live
      ? row(p.infra.nas.nearby.some((x) => x.kind === "closure" || x.kind === "groundStop") ? "a" : "g",
          `<b>NAS:</b> ${p.infra.nas.counts.groundStops} ground stops · ${p.infra.nas.counts.groundDelays} ground delays · ${p.infra.nas.counts.closures} closures nationally${p.infra.nas.nearby.length === 0 ? " — none within 250 km" : ""}`, "FAA")
      : row("u", "<b>NAS status:</b> unreachable — UNKNOWN", "FAA"));
    for (const x of p.infra.nas.nearby) {
      infraRows.push(row(x.kind === "closure" || x.kind === "groundStop" ? "a" : "u",
        `<b>${x.kind === "groundStop" ? "GROUND STOP" : x.kind === "closure" ? "CLOSURE" : x.kind === "groundDelay" ? "Ground delay" : "Delay"}</b> ${esc(x.airport)} · ${x.km} km — ${esc(x.reason)}${x.detail ? ` · ${esc(x.detail)}` : ""}`, "FAA"));
    }
  }
  infraRows.push(p.infra.powerNews.length > 0
    ? p.infra.powerNews.map((n) => row("a", `<b>Power:</b> ${esc(n.title.slice(0, 150))}`, "news")).join("")
    : row("u", "<b>Power:</b> no outage reporting in local news — news-derived, absence ≠ verified clear", "news"));

  const card = (led: Led, title: string, src: string, body: string) =>
    `<div class="card"><div class="hd">${ledDot(led)}<h2>${esc(title)}</h2><span class="src">${esc(src)}</span></div><div class="bd">${body}</div></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SITREP — ${esc(p.base.icao)} — ${esc(stamp)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#020617;color:#cbd5e1;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:26px 18px 50px}
.wrap{max-width:820px;margin:0 auto}
.mast{border:1px solid #1e293b;background:rgba(15,23,42,.6);border-radius:14px;padding:16px 18px;margin-bottom:14px}
.mast h1{font-size:17px;color:#f1f5f9;letter-spacing:.03em}
.mast .sub{font-size:11px;color:#64748b;margin-top:3px}
.stamp{display:inline-block;margin-top:8px;font:700 11px ui-monospace,Menlo,monospace;color:#a78bfa;border:1px solid rgba(139,92,246,.4);background:rgba(139,92,246,.08);border-radius:8px;padding:3px 10px;letter-spacing:.08em}
.leds{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.ledbox{flex:1 1 150px;display:flex;align-items:center;gap:9px;border:1px solid #1e293b;background:rgba(2,6,23,.5);border-radius:10px;padding:8px 11px}
.led,.dot{width:10px;height:10px;border-radius:99px;flex-shrink:0}
.dot{width:8px;height:8px;margin-top:5px}
.g{background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.7)}
.a{background:#fbbf24;box-shadow:0 0 8px rgba(251,191,36,.7)}
.r{background:#ef4444;box-shadow:0 0 8px rgba(239,68,68,.7)}
.u{background:#475569}.b{background:#38bdf8}
.ledbox .k{font-size:8px;font-weight:800;letter-spacing:.16em;color:#64748b;text-transform:uppercase}
.ledbox .v{font-size:11px;color:#e2e8f0;font-weight:600}
.card{border:1px solid #1e293b;background:rgba(15,23,42,.45);border-radius:14px;margin-bottom:12px;overflow:hidden}
.card>.hd{display:flex;align-items:center;gap:9px;padding:10px 15px;border-bottom:1px solid rgba(30,41,59,.7)}
.card>.hd h2{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#cbd5e1}
.card>.hd .src{font:400 9px ui-monospace,Menlo,monospace;color:#475569}
.card>.bd{padding:12px 15px}
.row{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(30,41,59,.4);font-size:12px;line-height:1.55}
.row:last-child{border-bottom:0}
.row .tag{margin-left:auto;font:400 8.5px ui-monospace,Menlo,monospace;color:#475569;flex-shrink:0;padding-top:3px}
.dim{color:#64748b}
.bluf{border:1px solid rgba(139,92,246,.35);background:rgba(139,92,246,.07);border-radius:12px;padding:12px 15px;margin-bottom:12px}
.bluf .t{font-size:9.5px;font-weight:800;letter-spacing:.16em;color:#a78bfa;text-transform:uppercase;margin-bottom:7px}
.bluf li{font-size:12.5px;color:#e2e8f0;line-height:1.6;margin-left:16px;margin-bottom:4px}
.bluf .w{font-size:11px;color:#94a3b8;margin-top:6px}
.metar{background:#020617;border:1px solid #1e293b;border-radius:8px;padding:7px 10px;font:11px ui-monospace,Menlo,monospace;color:#7dd3fc;overflow-x:auto;white-space:nowrap;margin-bottom:8px}
.tafbar{display:flex;height:20px;border-radius:6px;overflow:hidden;margin:4px 0 3px}
.seg{display:flex;align-items:center;justify-content:center;font:800 8px ui-monospace,Menlo,monospace;letter-spacing:.06em;overflow:hidden}
.vfr{background:#059669;color:#022c22}.mvfr{background:#0284c7;color:#082f49}.ifr{background:#dc2626;color:#fff}.lifr{background:#c026d3;color:#fff}.ukn{background:#334155;color:#94a3b8}
.axis{display:flex;justify-content:space-between;font:8px ui-monospace,Menlo,monospace;color:#475569;margin-bottom:6px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.chip{font:700 10px ui-monospace,Menlo,monospace;border:1px solid #334155;color:#94a3b8;border-radius:6px;padding:3px 8px}
.chip.warn{border-color:rgba(251,191,36,.5);color:#fcd34d;background:rgba(251,191,36,.08)}
.chip.bad{border-color:rgba(239,68,68,.5);color:#fca5a5;background:rgba(239,68,68,.08)}
.tlwrap{margin-top:12px;padding-top:10px;border-top:1px solid rgba(30,41,59,.6)}
.tlhead{font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin-bottom:6px}
.tlrow{display:grid;grid-template-columns:96px 1fr;align-items:center;margin-bottom:5px}
.tllab{font-size:9px;color:#94a3b8;padding-right:8px;text-align:right;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tltrack{position:relative;height:15px;background:rgba(30,41,59,.35);border-radius:4px}
.bar{position:absolute;top:2px;bottom:2px;border-radius:3px;font:700 7.5px ui-monospace,Menlo,monospace;display:flex;align-items:center;padding:0 4px;white-space:nowrap;overflow:hidden}
.bar.red{background:rgba(239,68,68,.22);border:1px solid rgba(239,68,68,.55);color:#fca5a5}
.bar.amb{background:rgba(251,191,36,.2);border:1px solid rgba(251,191,36,.5);color:#fcd34d}
.bar.sky{background:rgba(56,189,248,.18);border:1px solid rgba(56,189,248,.45);color:#7dd3fc}
.conflict{margin-top:8px;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.06);border-radius:8px;padding:7px 10px;font-size:11px;color:#fca5a5}
.foot{font:10px ui-monospace,Menlo,monospace;color:#475569;line-height:1.7;border-top:1px solid #1e293b;padding-top:12px;margin-top:18px}
.foot b{color:#94a3b8}
@media print{body{background:#fff;color:#111}.card,.mast,.bluf{border-color:#bbb;background:#fff}}
</style>
</head>
<body>
<div class="wrap">
<div class="mast">
<h1>SITREP — ${esc(p.base.icao)} · ${esc(p.base.label)}</h1>
<p class="sub">Operational support situation report · compiled from open sources by DEAD Dashboard</p>
<span class="stamp">SNAPSHOT AS OF ${esc(stamp)} — NOT LIVE</span>
<div class="leds">${mastLeds}</div>
</div>
${blufHtml}
${card(p.status.wx, "Weather", "AWC METAR/TAF · NWS · Open-Meteo", `${p.weather.metarRaw ? `<div class="metar">${esc(p.weather.metarRaw)}</div>` : ""}${tafBar}${weatherRows.join("")}`)}
${card(p.status.ops, "Ops / Airfield", "DAIP NOTAMs · OurAirports", `${opsRows.join("")}${windChips}${timelineHtml}`)}
${card(p.status.threat, "Threats", "Force Protection · GDACS/USGS · GDELT", threatRows.join(""))}
${card(p.status.infra, "Infrastructure", "IODA · FAA NAS · USGS · news", infraRows.join(""))}
<p class="foot">
<b>Provenance:</b> compiled entirely from open/public sources (NWS AWC · DoD DAIP NOTAMs · GDACS/USGS · GDELT · IODA Georgia Tech · FAA NAS · Open-Meteo · OurAirports).
<b>Discipline:</b> any unreachable source reads UNKNOWN — never implied-clear. Advisory planning data, not flight guidance.<br>
Snapshot generated ${esc(stamp)} by DEAD Dashboard · this file is static and self-contained — no network access, no scripts, safe to open offline.
</p>
</div>
</body>
</html>`;
}
