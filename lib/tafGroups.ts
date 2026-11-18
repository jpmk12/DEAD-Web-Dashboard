// Military TAF icing groups — the forecaster's own icing statement at a USAF /
// US Army field (ETAD, ETAR, EGUN, LIPA, RODN…). PURE, client-safe, tested in
// tests/tafGroups.test.ts.
//
// U.S. military TAFs (AFMAN 15-129 / the WMO 1734 code) carry an icing group
//   6 Ic hhh t
//     Ic  type + intensity (0 trace or none · 1 light mixed · 2 light rime in
//         cloud · 3 light clear in precipitation · 4–6 moderate, 7–9 severe,
//         same order)
//     hhh base of the layer, hundreds of feet AGL
//     t   thickness, thousands of feet (0 = not stated)
// e.g. "620304" = light rime in cloud, 3,000 ft AGL, 4,000 ft thick.
// AWC's decoded TAF JSON does not carry it, so it is read from the RAW TAF
// text, with the change groups (FM / BECMG / TEMPO / PROBnn) turned into time
// windows so a group is read for the period it was written in.
//
// Disciplines: a group applies to the period it is written in (a later FM /
// BECMG that omits it ends it — the forecaster rewrote the period); a BECMG
// takes effect at the START of its window (earliest onset); TEMPO / PROB are
// overlays and are labelled so; a time that cannot be placed drops the group,
// never a guessed window. A civil TAF never carries these groups, so
// `military` says whether their absence means anything.

export type TafIcingIntensity = "trace" | "light" | "moderate" | "severe";

export interface TafIcingGroup {
  code: string;
  intensity: TafIcingIntensity;
  type: string | null;
  baseFtAgl: number;
  /** Top of the layer AGL; null when the thickness digit is 0 (not stated). */
  topFtAgl: number | null;
  fromMs: number;
  toMs: number;
  /** "" for the base forecast, else FM / BECMG / TEMPO / PROB30 / PROB30 TEMPO. */
  change: string;
}

export interface TafHazards {
  /** The header (ICAO + validity) was read. */
  ok: boolean;
  /** A U.S. military TAF (QNH…INS, or any 6/5 group) — only then does an absent icing group mean "none forecast". */
  military: boolean;
  groups: TafIcingGroup[];
  validFromMs: number | null;
  validToMs: number | null;
}

const ICING_INT: TafIcingIntensity[] = ["trace", "light", "light", "light", "moderate", "moderate", "moderate", "severe", "severe", "severe"];
const ICING_TYPE: (string | null)[] = [null, "mixed", "rime in cloud", "clear in precipitation", "mixed", "rime in cloud", "clear in precipitation", "mixed", "rime in cloud", "clear in precipitation"];

const ICE_RX = /^6(\d)(\d{3})(\d)$/;
const TURB_RX = /^5[\dX]\d{4}$/;
const WINDOW_RX = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/;
const FM_RX = /^FM(\d{2})(\d{2})(\d{2})$/;
const ISSUE_RX = /^(\d{2})(\d{2})(\d{2})Z$/;
const PROB_RX = /^PROB(\d{2})$/;

export function decodeIcingGroup(token: string): Omit<TafIcingGroup, "fromMs" | "toMs" | "change"> | null {
  const m = ICE_RX.exec(token);
  if (!m) return null;
  const ic = Number(m[1]), base = Number(m[2]) * 100, t = Number(m[3]);
  return { code: token, intensity: ICING_INT[ic], type: ICING_TYPE[ic], baseFtAgl: base, topFtAgl: t > 0 ? base + t * 1000 : null };
}

/** Day + hour (+ minute) placed in the month nearest the reference instant; null when the day cannot exist. */
export function placeDayHour(dd: number, hh: number, mm: number, refMs: number): number | null {
  if (dd < 1 || dd > 31 || hh < 0 || hh > 24 || mm < 0 || mm > 59) return null;
  const ref = new Date(refMs);
  let best: number | null = null;
  for (const dm of [-1, 0, 1]) {
    const y = ref.getUTCFullYear(), mo = ref.getUTCMonth() + dm;
    const day0 = Date.UTC(y, mo, dd);
    if (new Date(day0).getUTCDate() !== dd) continue; // 31st of a 30-day month
    const t = day0 + hh * 3_600_000 + mm * 60_000;
    if (best == null || Math.abs(t - refMs) < Math.abs(best - refMs)) best = t;
  }
  return best;
}

interface Seg { change: string; prevailing: boolean; fromMs: number | null; toMs: number | null; tokens: string[] }

export function parseTafHazards(raw: string | null | undefined, issuedISO: string | null | undefined, nowMs: number): TafHazards {
  const empty: TafHazards = { ok: false, military: false, groups: [], validFromMs: null, validToMs: null };
  if (!raw || !raw.trim()) return empty;
  const text = raw.replace(/\s+/g, " ").trim().split(/ RMK /)[0];
  const military = /\bQNH\d{4}INS\b/.test(text);
  const toks = text.split(" ").map((t) => t.replace(/=$/, "")).filter(Boolean);

  let i = 0;
  if (toks[i] === "TAF") i++;
  while (toks[i] === "AMD" || toks[i] === "COR" || toks[i] === "RTD") i++;
  if (!/^[A-Z][A-Z0-9]{3}$/.test(toks[i] ?? "")) return { ...empty, military };
  i++;
  const issuedParsed = issuedISO ? Date.parse(issuedISO) : NaN;
  let refMs = Number.isFinite(issuedParsed) ? issuedParsed : nowMs;
  const iss = ISSUE_RX.exec(toks[i] ?? "");
  if (iss) {
    const t = placeDayHour(+iss[1], +iss[2], +iss[3], refMs);
    if (t != null) refMs = t;
    i++;
  }
  const v = WINDOW_RX.exec(toks[i] ?? "");
  if (!v) return { ...empty, military };
  const vFrom = placeDayHour(+v[1], +v[2], 0, refMs);
  const vTo = vFrom != null ? placeDayHour(+v[3], +v[4], 0, vFrom + 15 * 3_600_000) : null;
  if (vFrom == null || vTo == null || vTo <= vFrom) return { ...empty, military };
  i++;

  const segs: Seg[] = [{ change: "", prevailing: true, fromMs: vFrom, toMs: null, tokens: [] }];
  const windowAt = (tok: string | undefined): [number, number] | null => {
    const w = WINDOW_RX.exec(tok ?? "");
    if (!w) return null;
    const a = placeDayHour(+w[1], +w[2], 0, vFrom), b = a != null ? placeDayHour(+w[3], +w[4], 0, a + 6 * 3_600_000) : null;
    return a != null && b != null && b > a ? [a, b] : null;
  };
  while (i < toks.length) {
    const t = toks[i];
    const fm = FM_RX.exec(t);
    const prob = PROB_RX.exec(t);
    if (fm) {
      segs.push({ change: "FM", prevailing: true, fromMs: placeDayHour(+fm[1], +fm[2], +fm[3], vFrom), toMs: null, tokens: [] });
      i++;
    } else if (t === "BECMG") {
      const w = windowAt(toks[i + 1]);
      segs.push({ change: "BECMG", prevailing: true, fromMs: w ? w[0] : null, toMs: null, tokens: [] });
      i += w ? 2 : 1;
    } else if (t === "TEMPO" || prob) {
      let label = t, j = i + 1;
      if (prob && toks[j] === "TEMPO") { label = `${t} TEMPO`; j++; }
      const w = windowAt(toks[j]);
      segs.push({ change: label, prevailing: false, fromMs: w ? w[0] : null, toMs: w ? w[1] : null, tokens: [] });
      i = w ? j + 1 : j;
    } else {
      segs[segs.length - 1].tokens.push(t);
      i++;
    }
  }
  // A prevailing segment runs to the next prevailing segment's start, or the end of validity.
  const prev = segs.filter((s) => s.prevailing);
  prev.forEach((s, k) => {
    const next = prev.slice(k + 1).find((n) => n.fromMs != null);
    s.toMs = next ? next.fromMs : vTo;
  });

  const groups: TafIcingGroup[] = [];
  let anyMil = military;
  for (const s of segs) {
    for (const tok of s.tokens) {
      if (TURB_RX.test(tok)) { anyMil = true; continue; }
      const g = decodeIcingGroup(tok);
      if (!g) continue;
      anyMil = true;
      if (s.fromMs == null || s.toMs == null || s.toMs <= s.fromMs) continue; // unplaced → dropped, never guessed
      groups.push({ ...g, fromMs: s.fromMs, toMs: Math.min(s.toMs, vTo), change: s.change });
    }
  }
  return { ok: true, military: anyMil, groups, validFromMs: vFrom, validToMs: vTo };
}

export function icingGroupLabel(g: Pick<TafIcingGroup, "intensity" | "type" | "baseFtAgl" | "topFtAgl">): string {
  const ft = (f: number) => (f <= 0 ? "SFC" : `${f.toLocaleString("en-US")} ft`);
  const layer = g.topFtAgl != null ? `${ft(g.baseFtAgl)}–${ft(g.topFtAgl)} AGL` : `from ${ft(g.baseFtAgl)} AGL (thickness not stated)`;
  return `${g.intensity}${g.type ? ` ${g.type}` : ""} icing ${layer}`;
}
