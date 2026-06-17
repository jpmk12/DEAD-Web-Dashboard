// DAIP airspace / system NOTAMs for the Crisis map — the enroute & system-level
// complement to lib/notams.ts (which is per-base, type LOCATION). All three
// classes ride the SAME DAIP endpoint (POST /daip/mobile/query) confirmed by the
// contract capture; only `type` differs and every response shares the identical
// group→notams→list envelope, so we reuse notams.ts's parsing primitives and its
// DoD-CA fetch door (fetchDaipQuery):
//
//   • FIR_ARTCC  → enroute/overflight NOTAMs grouped by FIR (the #1 mobility
//                  gap: "can I overfly Syria/Iraq/Iran"). Plotted at FIR
//                  centroids (lib/firData) as the map "Overflight" layer.
//   • GPS_WAAS   → official GPS/WAAS outage NOTAMs (system-level, grouped
//                  "GPS NOTAMs"/"WAAS NOTAMs") — complements crowd-sourced
//                  GPSJam. Not geographic, surfaced as a list/count.
//   • FUEL_NOTAMS→ fuel availability NOTAMs ("can I refuel here").
//
// Fail-safe like notams.ts: `configured:false` when the DoD CA bundle is absent,
// `live:false` on any fetch/parse failure — never a false "no NOTAMs / clear".
// Server-only (imports notams.ts → node:https/fs); the client consumes the API
// route, which attaches FIR centroids server-side.

import {
  fetchDaipQuery, categorizeNotam, parseNotamStart, parseNotamEnd,
  notamTimeState, type NotamCategory,
} from "./notams";
import { firByCode } from "./firData";

export type AlertLevel = "Warning" | "Caution" | "Default";
const ALERT_RANK: Record<AlertLevel, number> = { Warning: 0, Caution: 1, Default: 2 };

export interface AirspaceNotam {
  id: string;
  group: string;          // the DAIP group code (FIR/ICAO/category) this came from
  text: string;           // clean display text (idshow + decoded body)
  rawtext: string;        // full ICAO-format raw
  category: NotamCategory;
  rank: number;
  alert: AlertLevel;
  start?: string;
  end?: string;
}

export interface AirspaceGroup {
  code: string;           // group.name from DAIP (e.g. "OSTT", "GPS NOTAMs")
  name: string;           // friendly name (first notam's name, else code)
  lat?: number;           // FIR centroid (FIR_ARTCC only)
  lon?: number;
  worst: AlertLevel;      // highest severity among the group's NOTAMs
  count: number;
  notams: AirspaceNotam[];
}

export interface AirspaceResult {
  configured: boolean;
  live: boolean;
  type: string;
  groups: AirspaceGroup[];
}

const MAX_PER_GROUP = 40;
const MAX_GROUPS = 60;

function toAlert(v: unknown): AlertLevel {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("warn")) return "Warning";
  if (s.includes("caut")) return "Caution";
  return "Default";
}

// Parse DAIP's group→notams→list envelope, PRESERVING group identity (unlike
// notams.ts parseDaipNotams, which flattens everything under one ICAO). Pure /
// network-free, so it's unit-tested against captured fixtures. Drops expired
// NOTAMs (relative to `nowMs`); returns groups newest-significance first.
export function parseAirspaceGroups(raw: string, nowMs: number = Date.now()): AirspaceGroup[] {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return []; }
  const groups = (json as { group?: unknown[] })?.group;
  if (!Array.isArray(groups)) return [];

  const out: AirspaceGroup[] = [];
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const code = String((g as { name?: unknown }).name ?? "").trim();
    if (!code) continue;
    const wrappers = (g as { notams?: unknown[] }).notams;
    if (!Array.isArray(wrappers)) continue;

    let friendly = "";
    const notams: AirspaceNotam[] = [];
    for (const w of wrappers) {
      if (!w || typeof w !== "object") continue;
      if (!friendly) friendly = String((w as { name?: unknown }).name ?? "").trim();
      const list = (w as { list?: unknown[] }).list;
      const items = Array.isArray(list) ? list : [w];
      for (const it of items) {
        if (!it || typeof it !== "object") continue;
        const item = it as Record<string, unknown>;
        const rawtext = String(item.rawtext ?? "").trim();
        const display = String(item.text ?? "").replace(/\s+/g, " ").trim();
        const basis = rawtext || display;
        if (!basis) continue;
        const { category, rank } = categorizeNotam(basis);
        const start = parseNotamStart(rawtext) ?? parseNotamStart(display);
        const end = parseNotamEnd(rawtext) ?? parseNotamEnd(display);
        const id = String(item.idshow ?? item.id ?? "").replace(/\s+/g, " ").trim();
        const n: AirspaceNotam = {
          id, group: code,
          text: ((id ? `${id} ` : "") + (display || basis)).slice(0, 480),
          rawtext,
          category, rank,
          alert: toAlert(item.alertType),
          ...(start ? { start } : {}),
          ...(end ? { end } : {}),
        };
        if (notamTimeState(n, nowMs) === "expired") continue;
        notams.push(n);
      }
    }
    if (!notams.length) continue;
    notams.sort((a, b) => a.rank - b.rank || ALERT_RANK[a.alert] - ALERT_RANK[b.alert]);
    const worst = notams.reduce<AlertLevel>((w, n) => (ALERT_RANK[n.alert] < ALERT_RANK[w] ? n.alert : w), "Default");
    out.push({
      code, name: friendly || code, worst,
      count: notams.length, notams: notams.slice(0, MAX_PER_GROUP),
    });
  }
  // Most-severe groups first, then most NOTAMs.
  out.sort((a, b) => ALERT_RANK[a.worst] - ALERT_RANK[b.worst] || b.count - a.count);
  return out.slice(0, MAX_GROUPS);
}

async function query(type: string, params: Record<string, unknown>): Promise<AirspaceResult> {
  const { configured, raw } = await fetchDaipQuery({ type, sort: "Criticality", ...params });
  if (!configured) return { configured: false, live: false, type, groups: [] };
  if (raw == null) return { configured: true, live: false, type, groups: [] };
  return { configured: true, live: true, type, groups: parseAirspaceGroups(raw) };
}

// Enroute/overflight NOTAMs for the given FIR codes, with centroids attached.
export async function getFirNotams(firCodes: string[]): Promise<AirspaceResult> {
  const codes = Array.from(new Set(firCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))).slice(0, 30);
  if (!codes.length) return { configured: true, live: true, type: "FIR_ARTCC", groups: [] };
  const res = await query("FIR_ARTCC", { locs: codes.join(" "), radius: "10" });
  for (const grp of res.groups) {
    const fir = firByCode(grp.code);
    if (fir) { grp.lat = fir.lat; grp.lon = fir.lon; if (grp.name === grp.code) grp.name = fir.name; }
  }
  // Only keep groups we can place on the map (have a known FIR centroid).
  res.groups = res.groups.filter((g) => g.lat != null);
  return res;
}

// Official GPS/WAAS outage NOTAMs (system-level; complements GPSJam).
export async function getGpsNotams(): Promise<AirspaceResult> {
  return query("GPS_WAAS", {});
}

// Fuel availability NOTAMs ("can I refuel here").
export async function getFuelNotams(): Promise<AirspaceResult> {
  return query("FUEL_NOTAMS", {});
}
