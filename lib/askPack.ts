// "Ask the board" — the EVIDENCE PACK, server-only (docs/PLAN-SPACE-CYBER-ASK
// §4.3 step 2). Assembled from caches the app already keeps; no new fetch,
// no model call. Every surface is bounded (`within`) so a cold server
// yields UNAVAILABLE for that section rather than a wait, and the pack
// renders through lib/askFormat (pure). Fixed order: the boards first, so
// truncation from the bottom never loses the indicators.

import { resolveAsk, type AskCatalogue, type AskResolution } from "./askResolve";
import { renderAskPack, type AskSection } from "./askFormat";
import { activeWarningProblems } from "./warningProblems";
import { assessWarning } from "./warningAssess";
import { getUserPrefs } from "./userPrefs";
import { getForceProtectionCached } from "./forceProtectionCached";
import { assembleSitrep, sitrepSummary } from "./sitrep";
import { getEconomicWarfare } from "./economicWarfareAssess";
import { getChokepointReads } from "./chokepointReads";
import { getSpectrumSummary } from "./spectrum";
import { getPostureMoves } from "./postureMovesAssemble";
import { getDemandHorizonBounded } from "./demandAssemble";
import { getDemandSkill } from "./demandVerifyAssemble";
import { computeAlerts } from "./alerts";
import { buildOeSeries } from "./oeDeltaAssemble";
import { computeDelta } from "./oeDelta";
import { getAllLastSeen } from "./surfaceState";
import { listDecisions } from "./decisionStore";
import { hitRate, isDue } from "./decisionLog";
import { listAnnotations } from "./annotationStore";
import { annotationLines } from "./annotations";
import { listDocuments } from "./documents";
import { getLatestSession } from "./threadHistory";
import { CHOKEPOINTS } from "./chokepoints";
import { knownCountryNames, sameCountry } from "./countryNames";
import { AOR_LABELS } from "./aor";
import { getFunctionalRowsBounded } from "./commandsAssemble";
import { functionalText } from "./functionalCommands";
import { getLineReads } from "./lineReadAssemble";
import { lineReadLines } from "./lineRead";
import { getThemeReads } from "./themesAssemble";
import { themeLines } from "./themes";

export interface AskPack {
  resolution: AskResolution;
  sections: AskSection[];
  text: string;
  /** Surfaces that did not answer this pass. */
  unavailable: string[];
  /** Changes when any surface's snapshot time changes — the cache key half. */
  fingerprint: string;
  atISO: string;
}

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p.catch(() => null), new Promise<null>((r) => { t = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(t)) as Promise<T | null>;
}

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "undated");

export async function buildAskCatalogue(): Promise<AskCatalogue> {
  const problems = await activeWarningProblems().catch(() => []);
  return {
    boards: problems.map((p) => ({ id: p.def.id, label: p.def.label, countries: p.geo.countries, aor: p.geo.aor, chokepointId: p.geo.chokepoint?.id ?? null, spacePowers: p.geo.spacePowers })),
    chokepoints: CHOKEPOINTS.map((c) => ({ id: c.id, name: c.name, keywords: c.keywords })),
    countries: knownCountryNames(),
  };
}

/** Build the pack for one question. `maxWaitMs` bounds EACH surface, not
 *  the whole — the boards may take their full share. */
export async function buildAskPack(question: string, email: string, opts: { maxWaitMs?: number } = {}): Promise<AskPack> {
  const wait = opts.maxWaitMs ?? 9_000;
  const atISO = new Date().toISOString();
  const catalogue = await buildAskCatalogue();
  const res = resolveAsk(question, catalogue);
  const sections: AskSection[] = [];
  const stamps: string[] = [];
  const problems = await activeWarningProblems().catch(() => []);
  const matchCountry = (c: string | null | undefined) => res.countries.some((x) => sameCountry(x, c));
  const matchAor = (a: string | null | undefined) => !!a && res.aors.includes(a as never);
  const broad = res.countries.length === 0 && res.aors.length === 0 && res.boardIds.length === 0;

  // 0. A functional command the question names — its domain rows, first,
  //    because the question is ABOUT that command (lib/functionalCommands).
  if (res.functional.length) {
    const rows = await within(getFunctionalRowsBounded(wait), wait);
    const surface = `OSINT › Commands › Functional commands · ${res.functional.map((f) => `US${f}`).join(" / ")}`;
    const door = { event: "app:navigate", detail: "osint", then: { event: "osint:set-pane", detail: "commands", delayMs: 120 } };
    if (!rows) sections.push({ surface, text: "", unavailable: true, door });
    else sections.push({ surface, text: functionalText(rows, res.functional), door });
  }

  // 1. The boards, in full.
  const boardsToRead = problems.filter((p) => res.boardIds.includes(p.def.id) || (broad && problems.length <= 3));
  for (const p of boardsToRead) {
    const a = await within(assessWarning(p.def.id), wait);
    const surface = `OSINT › Commands › I&W · ${p.def.label}`;
    const door = { event: "app:navigate", detail: "osint", then: { event: "watch:focus", detail: { kind: "iw", id: p.def.id }, delayMs: 120 } };
    if (!a) { sections.push({ surface, text: "", unavailable: true, door }); continue; }
    stamps.push(a.observedAt);
    const health = new Map(a.sensorHealth.map((h) => [h.indicatorId, h]));
    const lines: string[] = [
      `Level ${a.level.toUpperCase()} · trajectory ${a.trajectory} · anomaly ${a.anomaly >= 0 ? "+" : ""}${a.anomaly.toFixed(1)} over a baseline of ${a.baseline.toFixed(1)}${a.learning ? " · LEARNING MODE (baseline still forming; capped at watch)" : ""}`,
      `Scenario: ${clip(a.scenario, 240)}`,
      `Decision linkage: ${clip(a.decisionLinkage, 200)}`,
      "Indicators (state · contribution · observed provenance · falsifier):",
    ];
    for (const i of a.indicators) {
      const h = health.get(i.id);
      const hist = a.history?.[i.id];
      lines.push(`- ${i.id} [${i.state.toUpperCase()}${h && !h.live ? " — SENSOR DEAD" : ""}] contribution ${i.contribution.toFixed(1)} · conf ${(i.confidence * 100).toFixed(0)}% · last ${day(i.lastObserved)} · ${clip(i.observedProvenance ?? (h?.note ?? "no observation"), 220)}${hist ? ` · run ${hist.run}d over ${hist.observedDays} observed` : ""} · FALSIFIER: ${clip(i.falsifier, 160)}`);
    }
    if (a.lead?.leads?.length) lines.push(`Lead indicators (stepped up before past level-ups): ${clip(a.lead.label, 200)}`);
    const dec = await within(listDecisions(p.def.id, 40), 3_000);
    if (dec) {
      const hr = hitRate(dec);
      const open = dec.filter((d) => d.outcome === null);
      lines.push(`Your decision log on this board: ${hr.label}; ${open.length} open call${open.length === 1 ? "" : "s"}${open.filter((d) => isDue(d)).length ? ` (${open.filter((d) => isDue(d)).length} due for scoring)` : ""}${open[0] ? ` · latest: "${clip(open[0].call, 60)}" expecting "${clip(open[0].expectation, 120)}" by ${day(open[0].dueAt)}` : ""}`);
    }
    // Analyst annotations — the crew's own voice beside the evidence. Labelled
    // so the model treats them as judgement, never as an observation.
    const ann = await within(listAnnotations(p.def.id, 40), 3_000);
    if (ann === null || ann === undefined) {
      lines.push("Analyst notes on this board: UNAVAILABLE this pass (the store did not answer — there may be notes you cannot see).");
    } else if (ann.length) {
      const noteLines = annotationLines(ann, (id) => id);
      if (noteLines.length) lines.push("Analyst notes on this board (the crew's own judgement, NOT sensor evidence; an open note is current):", ...noteLines);
    }
    sections.push({ surface, text: lines.join("\n"), door, asOf: a.observedAt });
  }
  if (!boardsToRead.length) sections.push({ surface: "OSINT › Commands › I&W", text: res.countries.length || res.aors.length ? `No I&W board watches ${[...res.countries, ...res.aors].join(" / ")}. The dashboard has no indicator set for it; declare the AOI in Preferences → Mission Profile to get one.` : "No board matched the question." });

  // 2. Force posture rows.
  {
    const prefs = await within(getUserPrefs(), 3_000);
    const fp = prefs ? await within(getForceProtectionCached(prefs.countriesOfInterest ?? [], prefs.forceLocations ?? []), wait) : null;
    const surface = "OSINT › Commands › Force posture";
    if (!fp) sections.push({ surface, text: "", unavailable: true });
    else {
      stamps.push(fp.generatedAt);
      const rows = fp.assessments.filter((r) => broad || matchCountry(r.country) || matchAor(r.cocom));
      const text = rows.length
        ? rows.sort((x, y) => y.score - x.score).slice(0, 12).map((r) => `- ${r.label} (${r.country}, ${r.cocom}): ${r.composite.toUpperCase()}${r.chronicity && r.chronicity.state !== "quiet" ? ` · ${r.chronicity.state} ${r.chronicity.daysElevated}/${r.chronicity.daysObserved}d` : ""} — ${clip(r.topDriver, 160)}${r.categories.filter((c) => c.severity === "red" || c.severity === "amber").slice(0, 3).map((c) => `; ${c.category} ${c.severity}: ${clip(c.signals[0], 100)}`).join("")}`).join("\n")
        : "No watched base or country matches the question.";
      sections.push({ surface, text: `Sources: GPS ${fp.sources.gps ? "live" : "down"} · ACLED ${fp.sources.acled ? "live" : "off/down"} · aviation wx ${fp.sources.aviationWx ? "live" : "down"} · NOTAMs ${fp.sources.notams} · conflict ${fp.sources.conflict}\n${text}`, door: { event: "app:navigate", detail: "osint" }, asOf: fp.generatedAt });
    }
  }

  // 3. Base SITREP LEDs for hubs in the matched commands.
  {
    const prefs = await within(getUserPrefs(), 2_000);
    const bases = (prefs?.sitrepBases ?? []).filter((b) => broad || matchCountry(b.country) || res.aors.length > 0);
    if (bases.length) {
      const sums = await within(Promise.all(bases.slice(0, 6).map((b) => assembleSitrep(b).then(sitrepSummary).catch(() => null))), wait);
      const surface = "OSINT › Commands › Base SITREPs";
      if (!sums) sections.push({ surface, text: "", unavailable: true });
      else {
        const rows = sums.filter((s): s is NonNullable<typeof s> => !!s && (broad || matchAor(s.aor) || matchCountry(s.country)));
        sections.push({ surface, text: rows.length ? rows.map((s) => `- ${s.icao} ${s.label} (${s.country}, ${s.aor}): wx ${s.status.wx} · ops ${s.status.ops} · threat ${s.status.threat} · infra ${s.status.infra} · spectrum ${s.status.spectrum} — ${clip(s.driver, 140)}${s.worse.length ? ` · worse than yesterday: ${s.worse.join(", ")}` : ""}`).join("\n") + "\n(LEDs: g green · a amber · r red · u UNKNOWN)" : "No SITREP base in the matched commands." });
      }
    }
  }

  // 3b. Your lines — the next four days of declared flying, each read
  //     against its fields (lib/lineRead). Declared, never derived; a line
  //     never changes a level, so the pack labels it as the lens it is.
  {
    const lr = await within(getLineReads({ maxWaitMs: Math.min(wait, 8_000) }), wait + 500);
    const surface = "Glance › Lines (next 4 days)";
    const door = { event: "app:navigate", detail: "glance" };
    if (!lr || lr.lines === null) sections.push({ surface, text: "", unavailable: true, door });
    else if (lr.reads.length) sections.push({ surface, text: ["Declared lines (a day · an airframe · the fields · planned|execution — the crew's own declaration, NOT a sensor; the read is the fields' existing readings joined to the day, planning-grade):", ...lineReadLines(lr.reads)].join("\n"), door, asOf: lr.atISO });
    else sections.push({ surface, text: "No lines declared for the next 4 days.", door });
  }

  // 3c. Declared themes — what the operator's OWN sources say about the
  //     things they named (lib/themes). Counts and framing over a single-
  //     source pool: labelled so the model treats a surge as watching at
  //     most, never as an observation.
  {
    const tb = await within(getThemeReads({ maxWaitMs: Math.min(wait, 8_000) }), wait + 500);
    const surface = "OSINT › Feeds › Your themes";
    const door = { event: "app:navigate", detail: "osint", then: { event: "osint:set-pane", detail: "feeds", delayMs: 120 } };
    if (!tb || tb.pending || tb.themes === null) {
      if (tb?.themes === null || !tb) sections.push({ surface, text: "", unavailable: true, door });
    } else if (tb.reads.length) {
      sections.push({ surface, text: ["Declared themes read against the user's OWN sources (X captures, newsletters, captured articles, OSINT feeds) — volume vs each theme's own normal, distinct sources, framing by the act / threat / analysis / reversal grammar, and whether the base wire feeds also name it. NOT a sensor and never a level: own sources only caps at watching; a surge is a reason to look, not an observation.", ...themeLines(tb.reads)].join("\n"), door, asOf: tb.generatedAt });
    }
  }

  // 4. Economic warfare — the actor's tile and its moves.
  if (res.actorIds.length || res.topics.includes("economy") || broad) {
    const ew = await within(getEconomicWarfare({ maxWaitMs: Math.min(wait, 8_000) }), wait + 500);
    const surface = "Economy › Economic Warfare Watch";
    if (!ew || ew.pending) sections.push({ surface, text: ew?.note ? `Assembling — ${clip(ew.note, 160)}` : "", unavailable: !ew, door: { event: "app:navigate", detail: "markets" } });
    else {
      stamps.push(ew.generatedAt);
      const actors = ew.actors.filter((a) => res.actorIds.includes(a.actor.id) || (res.countries.length === 0 && broad)).slice(0, 4);
      const lines = actors.map((a) => {
        const s = a.assessment;
        const own = ew.moves.filter((m) => m.actorId === a.actor.id && m.direction === "by").slice(0, 4);
        return `- ${a.actor.label}: ${s.level.toUpperCase()} · anomaly ${s.anomaly >= 0 ? "+" : ""}${s.anomaly.toFixed(1)} · trajectory ${s.trajectory}${s.learning ? ` · learning (day ${a.baselineSamples} of 14)` : ""} · instruments ${a.instruments.filter((i) => i.state !== "dormant").map((i) => `${i.instrument} ${i.state}`).join(", ") || "all dormant"} · counter-pressure ${a.counterPressure.state} · drivers: ${s.drivers.slice(0, 3).map((d) => clip(d.observedProvenance ?? d.description, 100)).join("; ") || "none"}${a.corroboration.length ? ` · corroboration: ${a.corroboration.slice(0, 2).join(", ")}` : ""}${own.length ? `\n  moves by ${a.actor.label}: ${own.map((m) => `[${m.modality}] ${day(m.pubDate)} ${clip(m.title, 110)} (${m.source ?? "?"})`).join(" · ")}` : ""}`;
      });
      sections.push({ surface, text: lines.length ? lines.join("\n") : `No actor tile for ${res.countries.join(", ") || "the question"} on the board (tracked actors: ${ew.actors.map((a) => a.actor.label).join(", ")}).`, door: { event: "app:navigate", detail: "markets" }, asOf: ew.generatedAt });
    }
  }

  // 5. Chokepoint reads (incl. UKMTO).
  {
    const ids = res.chokepointIds.length ? res.chokepointIds : problems.filter((p) => res.boardIds.includes(p.def.id)).map((p) => p.geo.chokepoint?.id).filter((x): x is string => !!x);
    if (ids.length) {
      const body = await within(getChokepointReads([...new Set(ids)]), wait);
      const surface = "Economy › Chokepoint interdiction";
      if (!body) sections.push({ surface, text: "", unavailable: true });
      else {
        stamps.push(body.generatedAt);
        sections.push({ surface, text: body.signals.map((s) => `- ${s.name}: score ${s.score} · ${s.line ?? "nothing interdiction-shaped reported"}${s.lead ? ` · lead [${s.lead.modality}] ${s.lead.cls}: "${clip(s.lead.title, 110)}" (${s.lead.source ?? "?"}, ${day(s.lead.pubDate)})` : ""}${s.transit ? ` · AIS ${s.transit.state}` : ""}${s.events.slice(0, 3).map((e) => `; event ${e.ageDays == null ? "undated" : `${e.ageDays}d ago`} ${e.distanceKm} km: ${clip(e.title, 90)} (${e.source})`).join("")}`).join("\n") + `\nUKMTO: ${body.ukmto ? (body.ukmto.count ? `${body.ukmto.count} incidents on the board (${body.ukmto.live ? "fetched" : "captured"})` : `UNKNOWN — ${body.ukmto.reason ?? "no entries"}`) : "no read"}`, door: { event: "app:navigate", detail: "markets" }, asOf: body.generatedAt });
      }
    }
  }

  // 6. Counterspace & cyber posture.
  {
    const sp = await within(getSpectrumSummary({ maxWaitMs: Math.min(wait, 8_000) }), wait + 500);
    const surface = "Spectrum › counterspace & cyber posture";
    if (!sp || sp.pending) sections.push({ surface, text: "", unavailable: true });
    else {
      stamps.push(sp.generatedAt);
      const postures = (sp.postures ?? []).filter((p) => broad || matchCountry(p.country) || (p.board && res.boardIds.includes(p.board.problemId)));
      const lines: string[] = [];
      for (const p of postures) {
        const cs = p.counterspace;
        lines.push(`- ${p.country} counterspace: ${cs ? (cs.live ? `${cs.state.toUpperCase()} — ${clip(cs.why, 220)}` : "UNKNOWN (catalogue and reporting dead)") : "no read"}${p.catalogue ? ` · catalogue ${p.catalogue.configured ? (p.catalogue.live ? "live" : `unreachable (${p.catalogue.reason})`) : "not configured — reporting only"} · fleet ${p.catalogue.fleet.length} tracked · ${p.catalogue.manoeuvres14} manoeuvres in 14d${p.catalogue.cadencePer14 != null ? ` vs ~${p.catalogue.cadencePer14.toFixed(1)} cadence` : " (cadence forming)"}${p.catalogue.closestKm != null ? ` · closest ${p.catalogue.closestKm.toFixed(1)} km to a declared asset` : ""}${p.catalogue.proximity.slice(0, 2).map((x) => `; ${x.inspector} within ${x.minRangeKm.toFixed(1)} km of ${x.asset}${x.declared ? "" : " (undeclared)"}`).join("")}` : ""}`);
        if (p.cyber) lines.push(`- ${p.country} cyber posture: ${p.cyber.posture.toUpperCase()} — ${clip(p.cyber.why, 220)}`);
      }
      for (const [k, r] of [["PNT denial", sp.pnt], ["Cyber pressure", sp.cyber]] as const) {
        if (r && (broad || res.boardIds.includes(r.problemId))) lines.push(`- ${k} (${r.board}): ${r.live ? `${r.state.toUpperCase()} — ${clip(r.why, 200)}` : "UNKNOWN (sensors dead)"}`);
      }
      lines.push(`- Space weather: ${sp.spaceWx.live ? (sp.spaceWx.severe.length ? sp.spaceWx.severe.map((s) => `${s.scale}${s.level}`).join("/") : "no scale ≥3") : "SWPC unreachable"} (environment, never a level)`);
      sections.push({ surface, text: lines.join("\n"), asOf: sp.generatedAt });
    }
  }

  // 7. Posture moves (force movement in reporting).
  if (res.topics.includes("posture") || res.warningShaped) {
    const pm = await within(getPostureMoves(Math.min(wait, 6_000)), wait + 500);
    const surface = "Glance › Posture moves";
    if (!pm || pm.pending) sections.push({ surface, text: "", unavailable: true });
    else {
      stamps.push(pm.generatedAt);
      const rows = pm.moves.filter((m) => broad || matchAor(m.aor) || res.countries.some((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(`${m.actor} ${m.headline}`))).slice(0, 8);
      sections.push({ surface, text: rows.length ? rows.map((m) => `- ${day(m.pubDate)} ${m.kind.toUpperCase()} by ${m.actor} (${m.side}) → ${m.aor}: "${clip(m.headline, 120)}" (${m.source}${m.corroborated ? `, ${m.sources} sources` : ", single source"}) · falsifier: ${clip(m.falsifier, 100)}`).join("\n") : "No force-movement reporting matched the question in the window.", door: { event: "app:navigate", detail: "glance" }, asOf: pm.generatedAt });
    }
  }

  // 8. Demand horizon + verified skill.
  {
    const [dh, skill] = await Promise.all([within(getDemandHorizonBounded(Math.min(wait, 6_000)), wait + 500), within(getDemandSkill(), 4_000)]);
    const surface = "Glance › 7-day demand horizon";
    if (!dh || dh.pending) sections.push({ surface, text: "", unavailable: true });
    else {
      stamps.push(dh.generatedAt);
      const rows = dh.outlooks.filter((o) => broad || matchAor(o.aor));
      sections.push({ surface, text: (rows.length ? rows.map((o) => `- ${AOR_LABELS[o.aor] ?? o.aor}: ${o.direction.toUpperCase()} (score ${o.score}, confidence ${o.confidence}, ${o.sources} sources) — ${clip(o.line, 160)}; drivers: ${o.drivers.slice(0, 3).map((d) => `${clip(d.text, 60)} ${d.delta >= 0 ? "+" : ""}${d.delta}`).join(", ")}`).join("\n") : "No outlook for the matched commands.") + (skill ? `\nVerified skill: ${clip(skill.line, 160)}` : ""), door: { event: "app:navigate", detail: "glance" }, asOf: dh.generatedAt });
    }
  }

  // 9. Active alerts + what changed since the user's last look.
  {
    const [al, series, seen] = await Promise.all([within(computeAlerts(), 4_000), within(buildOeSeries(), 4_000), within(getAllLastSeen(email), 2_000)]);
    const alertRows = al ? al.alerts.filter((a) => broad || res.countries.some((c) => `${a.title} ${a.sub}`.toLowerCase().includes(c.toLowerCase())) || res.aors.some((x) => `${a.title} ${a.sub}`.includes(x))).slice(0, 8) : null;
    sections.push({ surface: "Alerts (active now)", text: alertRows ? (alertRows.length ? alertRows.map((a) => `- [${a.severity}] ${a.title} — ${clip(a.sub, 140)}`).join("\n") : "No active alert matches the question.") : "", unavailable: !alertRows });
    if (series) {
      const d = computeDelta(series, (seen as Record<string, number> | null)?.oe);
      const name = (t: { label: string; axis?: string | null; from?: string | null; to: string }) => `${t.label}${t.axis ? ` ${t.axis}` : ""} ${t.from ? `${t.from}→${t.to}` : `→${t.to}`}`;
      sections.push({ surface: "Glance › What changed since your last look", text: `${d.line ?? "no net change"}${d.worse.length ? `\nworse: ${d.worse.map(name).join("; ")}` : ""}${d.better.length ? `\nbetter: ${d.better.map(name).join("; ")}` : ""}${d.fresh.length ? `\nnew: ${d.fresh.map(name).join("; ")}` : ""}` });
    }
  }

  // 10. The user's own record: notes and the latest threads.
  if (res.countries.length) {
    const docs = await within(listDocuments({ search: res.countries.join(" "), limit: 5 }), 4_000);
    if (docs && docs.length) sections.push({ surface: "Docs (your notes, FULLTEXT)", text: docs.map((d) => `- "${d.title}" [${d.docType}${d.tags.length ? `, ${d.tags.slice(0, 3).join(", ")}` : ""}] updated ${day(d.updatedAt)}`).join("\n"), door: { event: "app:navigate", detail: "documents" } });
    const sess = await within(getLatestSession(), 3_000);
    if (sess) {
      const th = sess.threads.filter((t) => res.countries.some((c) => `${t.label} ${t.headline} ${t.summary}`.toLowerCase().includes(c.toLowerCase()))).slice(0, 4);
      if (th.length) sections.push({ surface: `News › Threads (${sess.date})`, text: th.map((t) => `- ${t.label} [${t.trend}]: ${clip(t.headline, 120)} — ${clip(t.summary, 220)} (${t.sources.length} sources)`).join("\n"), door: { event: "app:navigate", detail: "news" } });
    }
  }

  const unavailable = sections.filter((s) => s.unavailable).map((s) => s.surface);
  const text = renderAskPack(sections, atISO);
  const fingerprint = stamps.sort().join("|").slice(0, 400);
  return { resolution: res, sections, text, unavailable, fingerprint, atISO };
}
