// The command overlay on the Crisis map — PURE, client-safe, tested in
// tests/commandOverlay.test.ts.
//
// The map showed events but never the combatant commands themselves: picking
// a command recentred the view and filtered the dots, and that was all. The
// Unified Command Plan assigns responsibility BY COUNTRY, and the app already
// classifies by country (lib/aor `aorFromCountry`), so the overlay is honest
// at country resolution:
//   • every country is washed faintly in its command's hue (a WHERE, never a
//     level — the hue is not a colour the severity vocabulary uses);
//   • a country the posture watch holds is tinted by its WORST posture
//     (country row or any base in it) — red / amber / UNKNOWN / green. A
//     country nobody watches carries no posture tint: unwatched is not green;
//   • one tag per command at a fixed anchor: I&W level, posture worst and the
//     7-day demand arrow, straight from the command board's own rows (the map
//     computes no level of its own).
// Oceans are not drawn: the UCP's maritime seams are not in a country file
// and an invented line would be a claim the app cannot back.

import { aorFromCountry, aorFromCoords, AOR_LABELS, type Aor } from "./aor";
import { normalizeCountryName } from "./countryNames";
import type { Severity } from "./severity";
import type { CommandRow, IwLevel } from "./commandBoard";

export interface CountryFeatureProps { name: string; admin: string; a2: string; a3: string }

export type CommandAor = Exclude<Aor, "UNKNOWN">;
export const COMMAND_AORS: CommandAor[] = ["NORTHCOM", "SOUTHCOM", "EUCOM", "CENTCOM", "AFRICOM", "INDOPACOM"];

/** A faint wash per command — hues the severity vocabulary does not use. */
export const COMMAND_HUE: Record<CommandAor, string> = {
  NORTHCOM: "#60a5fa",
  SOUTHCOM: "#2dd4bf",
  EUCOM: "#818cf8",
  CENTCOM: "#e7c58f",
  AFRICOM: "#bef264",
  INDOPACOM: "#f0abfc",
};

/** Where each command's tag sits (open water or interior, clear of the hubs). */
export const COMMAND_TAG_ANCHOR: Record<CommandAor, { lat: number; lon: number }> = {
  NORTHCOM: { lat: 47, lon: -103 },
  SOUTHCOM: { lat: -14, lon: -58 },
  EUCOM: { lat: 60, lon: 40 },
  CENTCOM: { lat: 23, lon: 60 },
  AFRICOM: { lat: 2, lon: 22 },
  INDOPACOM: { lat: -2, lon: 124 },
};

// Natural Earth spellings the catalogue does not carry as a command token,
// by ISO3 — each a UCP fact, not a geographic guess (Puerto Rico is NORTHCOM,
// the Falklands SOUTHCOM, the Pacific territories INDOPACOM).
const ISO3_AOR: Record<string, CommandAor> = {
  PRI: "NORTHCOM", GRL: "NORTHCOM", USA: "NORTHCOM",
  FLK: "SOUTHCOM", TTO: "SOUTHCOM",
  ESH: "AFRICOM", COD: "AFRICOM", COG: "AFRICOM", CAF: "AFRICOM", CIV: "AFRICOM",
  SSD: "AFRICOM", GNQ: "AFRICOM", SWZ: "AFRICOM", SOM: "AFRICOM",
  BIH: "EUCOM", MKD: "EUCOM", CZE: "EUCOM", XKX: "EUCOM",
  PSE: "CENTCOM",
  NCL: "INDOPACOM", TLS: "INDOPACOM", SLB: "INDOPACOM", PRK: "INDOPACOM", KOR: "INDOPACOM",
  LAO: "INDOPACOM", BRN: "INDOPACOM", VNM: "INDOPACOM", ATF: "INDOPACOM",
};
// Features Natural Earth codes "-99" (no ISO3), by name.
const NAME_AOR: Record<string, CommandAor> = { "northern cyprus": "EUCOM", "n. cyprus": "EUCOM", somaliland: "AFRICOM", kosovo: "EUCOM" };

/** The command a country feature belongs to; UNKNOWN only for land no
 *  command holds (Antarctica). */
export function featureAor(p: CountryFeatureProps, centroid?: { lat: number; lon: number }): Aor {
  const byIso = ISO3_AOR[(p.a3 || "").toUpperCase()];
  if (byIso) return byIso;
  for (const raw of [p.admin, p.name]) {
    const named = NAME_AOR[(raw || "").trim().toLowerCase()];
    if (named) return named;
    const hit = aorFromCountry(normalizeCountryName(raw));
    if (hit !== "UNKNOWN") return hit;
    const plain = aorFromCountry((raw || "").toLowerCase());
    if (plain !== "UNKNOWN") return plain;
  }
  if ((p.a3 || "").toUpperCase() === "ATA") return "UNKNOWN";
  if (centroid) return aorFromCoords(centroid.lat, centroid.lon);
  return "UNKNOWN";
}

const SEV_RANK: Record<Severity, number> = { green: 0, unknown: 1, amber: 2, red: 3 };

/** One posture per COUNTRY: the worst of the country row and every base in
 *  it. Keyed by the normalised, lower-cased country name. */
export function countryPostures(rows: { kind?: string; country?: string; label?: string; composite: Severity }[]): Map<string, Severity> {
  const out = new Map<string, Severity>();
  for (const r of rows) {
    const name = normalizeCountryName(r.country || (r.kind === "country" ? r.label : "")).toLowerCase();
    if (!name) continue;
    const prev = out.get(name);
    if (!prev || SEV_RANK[r.composite] > SEV_RANK[prev]) out.set(name, r.composite);
  }
  return out;
}

/** The posture the overlay shows for a feature (null = not watched). */
export function postureFor(p: CountryFeatureProps, postures: Map<string, Severity>): Severity | null {
  for (const raw of [p.admin, p.name, p.a2]) {
    const k = normalizeCountryName(raw).toLowerCase();
    if (k && postures.has(k)) return postures.get(k)!;
  }
  return null;
}

const POSTURE_FILL: Record<Severity, { color: string; opacity: number }> = {
  red: { color: "#ef4444", opacity: 0.3 },
  amber: { color: "#f59e0b", opacity: 0.24 },
  unknown: { color: "#94a3b8", opacity: 0.16 },
  green: { color: "#10b981", opacity: 0.12 },
};

export interface CountryStyle { fillColor: string; fillOpacity: number; color: string; weight: number; opacity: number; dashArray?: string }

/** The polygon style: the command wash, the posture tint over it, and a
 *  dimmer everything-else when one command is in focus. */
export function countryStyle(aor: Aor, posture: Severity | null, focus: Aor | "ALL"): CountryStyle {
  const hue = aor === "UNKNOWN" ? "#475569" : COMMAND_HUE[aor];
  const inFocus = focus === "ALL" || focus === aor;
  const dim = inFocus ? 1 : 0.35;
  if (posture) {
    const t = POSTURE_FILL[posture];
    return { fillColor: t.color, fillOpacity: t.opacity * dim, color: hue, weight: inFocus ? 0.9 : 0.5, opacity: 0.55 * dim };
  }
  return { fillColor: hue, fillOpacity: (aor === "UNKNOWN" ? 0 : 0.07) * dim, color: hue, weight: 0.5, opacity: 0.32 * dim, dashArray: "2 3" };
}

export type TagTone = "red" | "amber" | "slate" | "unknown";

export interface CommandTag {
  aor: CommandAor;
  label: string;
  lat: number;
  lon: number;
  iw: string;
  posture: string;
  demand: string;
  /** The worst of the I&W level and the posture — the tag border. */
  tone: TagTone;
  star: boolean;
  why: string;
}

const IW_TONE: Record<IwLevel, TagTone> = { calm: "slate", watch: "slate", warning: "amber", alert: "red" };
const DEMAND_GLYPH = { rise: "↑", hold: "→", fall: "↓" } as const;
const TONE_RANK: Record<TagTone, number> = { slate: 0, unknown: 1, amber: 2, red: 3 };

/** One tag per geographic command, from the command board's rows. A
 *  command with no row gets no tag (the board has not answered — the map
 *  does not guess). */
export function commandTags(rows: CommandRow[]): CommandTag[] {
  const out: CommandTag[] = [];
  for (const r of rows) {
    if (r.aor === "UNKNOWN") continue;
    const aor = r.aor as CommandAor;
    const anchor = COMMAND_TAG_ANCHOR[aor];
    if (!anchor) continue;
    const iw = r.iw ? `I&W ${r.iw.level.toUpperCase()}${r.iw.learning ? " (learning)" : ""}` : "no board";
    const p = r.posture;
    const posture = p.watched === 0 ? "nothing watched"
      : p.red ? `${p.red} red`
      : p.amber ? `${p.amber} amber`
      : p.unknown ? `${p.unknown} unknown`
      : `${p.green} green`;
    const demand = r.demand ? `demand ${DEMAND_GLYPH[r.demand.direction]}` : "demand —";
    const iwTone: TagTone = r.iw ? IW_TONE[r.iw.level] : "slate";
    const pTone: TagTone = p.red ? "red" : p.amber ? "amber" : p.watched > 0 && p.unknown === p.watched ? "unknown" : "slate";
    const tone = TONE_RANK[iwTone] >= TONE_RANK[pTone] ? iwTone : pTone;
    out.push({ aor, label: AOR_LABELS[aor].replace(/^US/, ""), ...anchor, iw, posture, demand, tone, star: r.star, why: r.why });
  }
  return out;
}

/** Mean of the outer ring's vertices — good enough to place a 110m feature
 *  for the coordinate fallback (never shown as a position). */
export function roughCentroid(geom: { type: string; coordinates: unknown }): { lat: number; lon: number } | undefined {
  const ring: number[][] | undefined =
    geom.type === "Polygon" ? (geom.coordinates as number[][][])[0]
    : geom.type === "MultiPolygon" ? [...(geom.coordinates as number[][][][])].sort((a, b) => b[0].length - a[0].length)[0]?.[0]
    : undefined;
  if (!ring?.length) return undefined;
  let lat = 0, lon = 0;
  for (const [x, y] of ring) { lon += x; lat += y; }
  return { lat: lat / ring.length, lon: lon / ring.length };
}
