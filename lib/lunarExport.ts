// The light-data table as ONE self-contained HTML file for the OPORD annex
// — zero JavaScript, zero external resources, prints to a page (the
// sitrepExport / oeBriefExport discipline). PURE, client-safe: the Weather
// tab's "⇩ light data" renders it in the browser from the nights it already
// computed. Every dynamic string is escaped (the place label is user text).

import { esc } from "./sitrepExport";
import { hhmmIn, MOON_USEFUL_ALT_DEG, type LunarNight, type LunarThresholds } from "./moon";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]} ${String(d).padStart(2, "0")} ${MON[m - 1]}`;
}
const h = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}`);
const BAND_LABEL = { hi: "HIGH", mid: "MOD", lo: "LOW" } as const;

export interface LunarExportInput {
  placeLabel: string;
  lat: number;
  lon: number;
  nights: LunarNight[];
  thresholds: LunarThresholds;
  generatedISO: string;
}

export function renderLunarHtml(i: LunarExportInput): string {
  const zone = i.nights[0]?.zone ?? "UTC";
  const rows = i.nights.map((n) => {
    const mr = n.moonrise.map((m) => hhmmIn(m, n.zone)).join(" / ") || "—";
    const ms = n.moonset.map((m) => hhmmIn(m, n.zone)).join(" / ") || "—";
    const cls = n.polar ? "polar" : n.band;
    return `<tr class="${cls}"><td class="d">${esc(dayLabel(n.date))}</td><td>${hhmmIn(n.bmnt, n.zone)}</td><td>${hhmmIn(n.sunrise, n.zone)}</td><td>${hhmmIn(n.sunset, n.zone)}</td><td>${hhmmIn(n.eent, n.zone)}</td><td>${esc(mr)}</td><td>${esc(ms)}</td><td class="pct">${n.illumPct}%</td><td>${h(n.darkH)}</td><td>${h(n.moonlitDarkH)}</td><td>${h(n.usefulMoonH)}</td><td class="free">${h(n.moonFreeDarkH)}</td><td><span class="pill ${cls}">${n.polar ? "POLAR" : BAND_LABEL[n.band]}</span></td></tr>`;
  }).join("\n");
  const stamp = `${i.generatedISO.slice(0, 10)} ${i.generatedISO.slice(11, 16)}Z`;
  const first = i.nights[0]?.date ?? "", last = i.nights[i.nights.length - 1]?.date ?? "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Light data — ${esc(i.placeLabel)} — ${esc(first)} to ${esc(last)}</title>
<style>
:root{color-scheme:light}
body{margin:0;background:#fff;color:#111;font:12px/1.45 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:22px 18px 40px}
h1{font-size:18px;margin:0 0 4px}
.meta{font-size:11px;color:#444;margin:0 0 14px}
.stamp{display:inline-block;border:1px solid #92400e;color:#92400e;font-weight:700;font-size:11px;letter-spacing:.08em;padding:3px 8px;border-radius:4px;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{font-size:10px;letter-spacing:.08em;text-transform:uppercase;text-align:left;padding:6px 6px;border-bottom:2px solid #111;color:#333}
td{padding:5px 6px;border-bottom:1px solid #ddd;white-space:nowrap}
td.d{font-weight:700}
td.pct{font-weight:700}
td.free{font-weight:700}
tr.lo td{background:#eef0ff}
tr.hi td{background:#fff8e1}
tr.polar td{color:#777;font-style:italic}
.pill{font-size:9px;font-weight:700;letter-spacing:.08em;padding:1px 5px;border-radius:3px;border:1px solid #999}
.pill.lo{border-color:#4f46e5;color:#3730a3}
.pill.hi{border-color:#b45309;color:#92400e}
.pill.mid{border-color:#777;color:#444}
.foot{margin-top:14px;font-size:10.5px;color:#555}
.foot p{margin:3px 0}
@media print{main{padding:0}tr{page-break-inside:avoid}}
</style></head><body><main>
<div class="stamp">SNAPSHOT AS OF ${esc(stamp)} — COMPUTED, NOT AN ALMANAC</div>
<h1>Light data — ${esc(i.placeLabel)}</h1>
<p class="meta">${i.lat.toFixed(3)}°, ${i.lon.toFixed(3)}° · times local (${esc(zone)}) · night = EENT → BMNT (nautical twilight, sun −12°) · ${esc(first)} to ${esc(last)} · LOW &lt; ${i.thresholds.low}% · HIGH ≥ ${i.thresholds.high}%</p>
<table>
<thead><tr><th>Night</th><th>BMNT</th><th>Sunrise</th><th>Sunset</th><th>EENT</th><th>Moonrise</th><th>Moonset</th><th>Illum</th><th>Dark h</th><th>Moonlit h</th><th>≥${MOON_USEFUL_ALT_DEG}° h</th><th>Moon-free h</th><th>Window</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<div class="foot">
<p><b>How to read it.</b> Dark h = EENT to the next BMNT. Moonlit h = the part of that with the moon above the horizon; ≥${MOON_USEFUL_ALT_DEG}° h = the part with the moon at least ${MOON_USEFUL_ALT_DEG}° up (a moon on the horizon lights little). Moon-free h = darkness with no moon. Illumination is the lit fraction at local midnight.</p>
<p><b>Planning-grade.</b> Rise and set are computed from a low-precision lunar model to a minute or two; use an almanac for a timed event. Cloud cover is not included. Moonrise / moonset are listed between local noon and the next local noon; a dash means the event falls outside that span.</p>
<p>Unofficial. Generated by the dashboard's Weather tab.</p>
</div>
</main></body></html>`;
}
