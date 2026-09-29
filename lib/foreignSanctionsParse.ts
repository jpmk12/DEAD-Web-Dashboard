// Foreign counter-measures — the EU consolidated financial-sanctions list and
// the UK sanctions list, parsed. PURE, unit-tested against synthetic rows in
// the documented column layouts. lib/foreignSanctions.ts fetches; this judges.
//
// Why: the Federal Register gives the U.S. side of every move/counter-move
// sequence and nothing gave the other side. Both lists are keyless CSVs; a
// daily diff of NEW listings per regime is the honest foreign half the
// review asked for. The contract could not be verified from the sandbox
// (egress blocks both hosts) — `diagnoseForeignSanctions()` runs the real
// fetches from production and returns status + header snippet, and a
// renamed column shows there as `parsed: 0`.
//
// PRC MOFCOM notices have no API and are deliberately NOT here (a browser
// capture, same as LiveUAMap, if ever). Every surface that shows this data
// says EU + UK only.

export type ForeignSource = "EU" | "UK";

export interface ForeignDesignation {
  source: ForeignSource;
  /** The list's own regime / programme label. */
  programme: string;
  /** The country the regime targets, when the mapping knows it. */
  country: string | null;
  /** yyyy-mm-dd the entity was listed. */
  listedOn: string;
  /** The list's own entity id, for de-duplication across alias rows. */
  entityId: string;
}

export interface DesignationWave {
  source: ForeignSource;
  programme: string;
  country: string | null;
  /** Newest listing day in the wave. */
  day: string;
  /** Distinct entities listed in the window under this programme. */
  count: number;
}

// EU programme codes (Entity_Regulation_Programme) → the country the regime
// targets. UKR is the "territorial integrity of Ukraine" regime, whose
// listings are Russian persons and entities. Thematic regimes (terrorism,
// cyber, human rights, chemical weapons) map to null — they are real
// pressure but on nobody the actor register can name.
export const EU_PROGRAMME_COUNTRY: Record<string, string | null> = {
  IRN: "Iran", IRQ: "Iraq", RUS: "Russia", UKR: "Russia", BLR: "Belarus", SYR: "Syria", PRK: "North Korea",
  VEN: "Venezuela", MMR: "Myanmar", LBY: "Libya", ZWE: "Zimbabwe", NIC: "Nicaragua", GIN: "Guinea",
  MLI: "Mali", SDN: "Sudan", SSD: "South Sudan", SOM: "Somalia", COD: "Democratic Republic of the Congo",
  CAF: "Central African Republic", YEM: "Yemen", LBN: "Lebanon", TUN: "Tunisia", EGY: "Egypt", TUR: "Turkey",
  HTI: "Haiti", MDA: "Moldova", BDI: "Burundi", GNB: "Guinea-Bissau", AFG: "Afghanistan", CHN: "China",
  TAQA: null, CYB: null, CHEM: null, HR: null, EUGHR: null, TERR: null,
};

// UK "Regime" values carry the country name with an optional parenthetical
// ("Iran (Nuclear)", "Iran (Human Rights)") and a few long forms.
const UK_REGIME_COUNTRY: [RegExp, string][] = [
  [/^russia/i, "Russia"], [/^iran/i, "Iran"], [/^belarus/i, "Belarus"], [/^syria/i, "Syria"],
  [/korea/i, "North Korea"], [/^venezuela/i, "Venezuela"], [/^myanmar|^burma/i, "Myanmar"], [/^libya/i, "Libya"],
  [/^zimbabwe/i, "Zimbabwe"], [/^nicaragua/i, "Nicaragua"], [/^guinea-bissau/i, "Guinea-Bissau"], [/^guinea/i, "Guinea"],
  [/^mali/i, "Mali"], [/^sudan/i, "Sudan"], [/^south sudan/i, "South Sudan"], [/^somalia/i, "Somalia"],
  [/^democratic republic of the congo|^drc/i, "Democratic Republic of the Congo"], [/^central african/i, "Central African Republic"],
  [/^yemen/i, "Yemen"], [/^lebanon/i, "Lebanon"], [/^iraq/i, "Iraq"], [/^haiti/i, "Haiti"], [/^bosnia/i, "Bosnia and Herzegovina"],
  [/^afghanistan/i, "Afghanistan"], [/^china/i, "China"], [/^turkey|^türkiye/i, "Turkey"], [/^egypt/i, "Egypt"],
];

export function ukRegimeCountry(regime: string): string | null {
  const r = regime.trim();
  for (const [rx, c] of UK_REGIME_COUNTRY) if (rx.test(r)) return c;
  return null;
}

/** One CSV line → fields, honouring double-quoted fields with embedded
 *  delimiters and doubled quotes. Hand-rolled (no new dep). */
export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const ymd = (s: string): string | null => {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);   // dd/mm/yyyy (UK)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
};

/** EU FSF full CSV: semicolon-delimited, a header row (possibly preceded by a
 *  generation-date line), one row per name/alias so entities repeat. Keyed by
 *  header NAME, never position — the file gains columns between releases. */
export function parseEuCsv(text: string): ForeignDesignation[] {
  const lines = text.split(/\r?\n/);
  let hi = lines.findIndex((l) => /Entity_LogicalId/i.test(l) && /Entity_Regulation_Programme/i.test(l));
  if (hi < 0) return [];
  const header = splitCsvLine(lines[hi], ";").map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cId = col("Entity_LogicalId"), cProg = col("Entity_Regulation_Programme"), cDate = col("Entity_Regulation_PublicationDate");
  if (cId < 0 || cProg < 0 || cDate < 0) return [];
  const seen = new Set<string>();
  const out: ForeignDesignation[] = [];
  for (hi++; hi < lines.length; hi++) {
    const line = lines[hi];
    if (!line.trim()) continue;
    const f = splitCsvLine(line, ";");
    const id = (f[cId] ?? "").trim();
    const prog = (f[cProg] ?? "").trim().toUpperCase();
    const date = ymd(f[cDate] ?? "");
    if (!id || !prog || !date) continue;
    const key = `${id}:${prog}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: "EU", programme: prog, country: prog in EU_PROGRAMME_COUNTRY ? EU_PROGRAMME_COUNTRY[prog] : null, listedOn: date, entityId: id });
  }
  return out;
}

/** UK OFSI consolidated list CSV: a "Last Updated" line, then a header row,
 *  comma-delimited with quoted fields; one row per alias, `Group ID` is the
 *  entity. `Listed On` is dd/mm/yyyy. */
export function parseUkCsv(text: string): ForeignDesignation[] {
  const lines = text.split(/\r?\n/);
  let hi = lines.findIndex((l) => /\bRegime\b/.test(l) && /Group ID/i.test(l) && /Listed On/i.test(l));
  if (hi < 0) return [];
  const header = splitCsvLine(lines[hi], ",").map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const cId = col("Group ID"), cReg = col("Regime"), cDate = col("Listed On");
  if (cId < 0 || cReg < 0 || cDate < 0) return [];
  const seen = new Set<string>();
  const out: ForeignDesignation[] = [];
  for (hi++; hi < lines.length; hi++) {
    const line = lines[hi];
    if (!line.trim()) continue;
    const f = splitCsvLine(line, ",");
    const id = (f[cId] ?? "").trim();
    const regime = (f[cReg] ?? "").trim();
    const date = ymd(f[cDate] ?? "");
    if (!id || !regime || !date) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ source: "UK", programme: regime, country: ukRegimeCountry(regime), listedOn: date, entityId: id });
  }
  return out;
}

/** Listings inside the window, grouped into waves per (source, programme):
 *  the counter-measure record the board and the timeline read. */
export function designationWaves(rows: ForeignDesignation[], today: string, windowDays = 45): DesignationWave[] {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const byKey = new Map<string, DesignationWave>();
  for (const r of rows) {
    const t = Date.parse(`${r.listedOn}T00:00:00Z`);
    if (!Number.isFinite(t) || !Number.isFinite(todayMs)) continue;
    const age = (todayMs - t) / 86_400_000;
    if (age < -1 || age > windowDays) continue;
    const key = `${r.source}:${r.programme}`;
    const w = byKey.get(key);
    if (w) { w.count++; if (r.listedOn > w.day) w.day = r.listedOn; }
    else byKey.set(key, { source: r.source, programme: r.programme, country: r.country, day: r.listedOn, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.day.localeCompare(a.day) || b.count - a.count);
}
