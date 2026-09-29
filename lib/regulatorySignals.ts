// Regulatory actions (sanctions · export controls · tariffs) — PURE,
// client-safe, unit-tested. lib/federalRegister.ts fetches; this file judges.
//
// Why a separate data class: economic warfare now shapes access, basing and
// overflight as much as kinetic events do, and the app had no source for the
// U.S. side of it at all — sanctions designations, Entity List additions and
// tariff proclamations reached the board only if a news feed happened to
// carry them. The Federal Register is the primary record of every such U.S.
// action, keyless and structured. It is ALSO only the U.S. side: foreign
// counter-measures (retaliatory tariffs, host-nation export bans) still
// arrive through news, and every surface that shows this data says so.
//
// Discipline: classification is by the ISSUING AGENCY first (OFAC → sanctions,
// BIS → export control, USTR/CBP/ITA → tariff/trade) and by title vocabulary
// only when the agency is ambiguous (Treasury, Commerce, the President), so a
// State Department notice that mentions "sanctions" in passing does not
// become a sanctions action. A row "touches the watch" when its text names a
// watched country — word-bounded, case-insensitive, never a substring hit.

export type RegulatoryClass = "sanctions" | "export-control" | "tariff" | "other";

export interface RegulatoryDoc {
  documentNumber: string;
  title: string;
  abstract: string | null;
  type: string;                 // Rule | Proposed Rule | Notice | Presidential Document
  publicationDate: string;      // yyyy-mm-dd
  url: string;
  agencies: { name: string; slug: string }[];
}

export interface RegulatoryAction extends RegulatoryDoc {
  cls: RegulatoryClass;
  /** Named legal instrument when one is recognisable ("Section 232", "Entity List", "SDN"). */
  instrument: string | null;
  /** Watched countries named in the title/abstract. */
  countries: string[];
  touchesWatch: boolean;
  ageDays: number;
}

export interface RegulatorySummary {
  total: number;
  byClass: Record<RegulatoryClass, number>;
  /** Actions published in the last 7 days. */
  recent: number;
  touchingWatch: number;
  /** One line for the AI read / brief, or null when nothing. */
  line: string | null;
}

export const CLASS_LABEL: Record<RegulatoryClass, string> = {
  sanctions: "Sanctions", "export-control": "Export control", tariff: "Tariff / trade", other: "Other",
};

/** Federal Register agency slugs. Pinned from the API's /agencies index; the
 *  route's ?diag=1 reports the HTTP status per query so a renamed slug shows
 *  up as a 400 rather than an empty board. */
export const AGENCY_CLASS: Record<string, RegulatoryClass> = {
  "foreign-assets-control-office": "sanctions",
  "industry-and-security-bureau": "export-control",
  "trade-representative-office-of-united-states": "tariff",
  "u-s-customs-and-border-protection": "tariff",
  "international-trade-administration": "tariff",
  "international-trade-commission": "tariff",
};

const SANCTIONS_RX = /\bsanction|blocking property|specially designated|\bSDN\b|national emergency with respect to/i;
const EXPORT_RX = /export control|entity list|export administration regulations|\bEAR\b|\bITAR\b|munitions list|end-?use|deemed export|foreign direct product/i;
const TARIFF_RX = /\btariff|\bduties?\b|section 232|section 301|section 201|antidumping|countervailing|import restriction|quota|trade agreement|reciprocal trade/i;

const INSTRUMENTS: [RegExp, string][] = [
  [/section 232/i, "Section 232"],
  [/section 301/i, "Section 301"],
  [/section 201/i, "Section 201"],
  [/\bIEEPA\b|international emergency economic powers/i, "IEEPA"],
  [/entity list/i, "Entity List"],
  [/specially designated|\bSDN\b/i, "SDN designation"],
  [/antidumping/i, "Antidumping"],
  [/countervailing/i, "Countervailing duty"],
  [/general license/i, "General license"],
  [/export administration regulations|\bEAR\b/i, "EAR"],
  [/\bITAR\b/i, "ITAR"],
  [/executive order/i, "Executive order"],
  [/proclamation/i, "Proclamation"],
];

export function classify(doc: RegulatoryDoc): RegulatoryClass {
  for (const a of doc.agencies) {
    const c = AGENCY_CLASS[a.slug];
    if (c) return c;
  }
  const text = `${doc.title} ${doc.abstract ?? ""}`;
  if (EXPORT_RX.test(text)) return "export-control";
  if (SANCTIONS_RX.test(text)) return "sanctions";
  if (TARIFF_RX.test(text)) return "tariff";
  return "other";
}

export function instrumentOf(text: string): string | null {
  for (const [rx, label] of INSTRUMENTS) if (rx.test(text)) return label;
  return null;
}

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Watched countries named in the text — word-bounded, plus the common
 *  adjective forms because they are the same referent (Iran → Iranian,
 *  China → Chinese, Iraq → Iraqi, Russia → Russian). What it must NOT do is
 *  match "Oman" inside "Romania" (the boundary prevents it) or "Niger" in
 *  "Nigerian" — Niger's adjective is "Nigerien", and "-ian" after a final
 *  "r" is always the OTHER country, so that suffix is withheld there. */
export function countriesIn(text: string, watched: string[]): string[] {
  const out: string[] = [];
  for (const c of watched) {
    const name = c.trim();
    if (name.length < 3) continue;
    const suffixes = /r$/i.test(name) ? "n|ese|i|s" : "n|ian|ese|i|s";
    const rx = new RegExp(`\\b${escapeRx(name)}(?:${suffixes})?\\b`, "i");
    if (rx.test(text)) out.push(name);
  }
  return Array.from(new Set(out));
}

const DAY = 86_400_000;

export function enrich(docs: RegulatoryDoc[], watched: string[], today: string): RegulatoryAction[] {
  const todayMs = Date.parse(`${today}T00:00:00Z`) || Date.now();
  const out: RegulatoryAction[] = [];
  for (const d of docs) {
    const text = `${d.title} ${d.abstract ?? ""}`;
    const cls = classify(d);
    const countries = countriesIn(text, watched);
    const pub = Date.parse(`${d.publicationDate}T00:00:00Z`);
    const ageDays = Number.isFinite(pub) ? Math.max(0, Math.round((todayMs - pub) / DAY)) : 9999;
    out.push({ ...d, cls, instrument: instrumentOf(text), countries, touchesWatch: countries.length > 0, ageDays });
  }
  // Newest first; among the same day, the ones touching the watch lead.
  out.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate) || Number(b.touchesWatch) - Number(a.touchesWatch) || a.title.localeCompare(b.title));
  return out;
}

export function summarize(actions: RegulatoryAction[]): RegulatorySummary {
  const byClass: Record<RegulatoryClass, number> = { sanctions: 0, "export-control": 0, tariff: 0, other: 0 };
  let recent = 0, touchingWatch = 0;
  for (const a of actions) {
    byClass[a.cls]++;
    if (a.ageDays <= 7) recent++;
    if (a.touchesWatch) touchingWatch++;
  }
  const parts: string[] = [];
  if (byClass.sanctions) parts.push(`${byClass.sanctions} sanctions`);
  if (byClass["export-control"]) parts.push(`${byClass["export-control"]} export-control`);
  if (byClass.tariff) parts.push(`${byClass.tariff} tariff/trade`);
  const line = actions.length === 0
    ? null
    : `${parts.join(", ")} action${actions.length === 1 ? "" : "s"} in the window (${recent} in the last 7 days${touchingWatch ? `, ${touchingWatch} naming a watched country` : ""})`;
  return { total: actions.length, byClass, recent, touchingWatch, line };
}

/** Compact lines for the AI Economic Warfare Read: the watch-touching and
 *  most recent actions, never more than `max`. */
export function regulatoryLines(actions: RegulatoryAction[], max = 8): string[] {
  const pick = [...actions.filter((a) => a.touchesWatch), ...actions.filter((a) => !a.touchesWatch)].slice(0, max);
  return pick.map((a) => `${a.publicationDate} [${CLASS_LABEL[a.cls]}${a.instrument ? ` · ${a.instrument}` : ""}] ${a.title.slice(0, 120)}${a.countries.length ? ` (${a.countries.join(", ")})` : ""}`);
}
