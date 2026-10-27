import { describe, it, expect } from "vitest";
import { readChatter, clusterChatter, chatterSurge, chatterToMoves, chatterLine, airframesIn, statedCount, placesIn, placesWithOwn, chatterForIcao, fieldChatterLine, type OwnPlace } from "../lib/mobilityChatter";
import { mobilityWithChatter } from "../lib/warningRules";
import { demandHorizon, type DemandInput } from "../lib/demandHorizon";
import { mergePostureMoves, detectPostureMoves } from "../lib/postureMoves";
import type { NewsItem } from "../lib/types";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const post = (text: string, o: Partial<NewsItem> = {}): NewsItem =>
  ({ id: o.id ?? text.slice(0, 24), title: text, source: o.source ?? "𝕏 @spotter1", category: "social", pubDate: o.pubDate ?? "2026-10-27T09:00:00Z", summary: o.summary ?? "", link: o.link ?? "https://x.com/spotter1/status/1" });

describe("readChatter — airframe + movement phrase, destination-placed, never guessed", () => {
  it("reads a tanker wave toward a named Gulf base as U.S. lift toward CENTCOM with the stated count", () => {
    const [p] = readChatter([post("6x KC-135 out of Mildenhall heading east tonight, landing at Al Udeid per ADS-B")], NOW);
    expect(p).toBeDefined();
    expect(p.airframes).toContain("KC-135");
    expect(p.classes).toEqual(["tanker"]);
    expect(p.count).toBe(6);
    expect(p.side).toBe("us");
    expect(p.place).toBe("Al Udeid");
    expect(p.origin).toBe("Mildenhall");
    expect(p.aor).toBe("CENTCOM");
    expect(p.direction).toBe("toward");
  });
  it("an origin alone places nothing — 'heading east' out of Mildenhall is not a guess at the Gulf", () => {
    const [p] = readChatter([post("Four KC-46s departed Mildenhall heading east this morning")], NOW);
    expect(p.origin).toBe("Mildenhall");
    expect(p.place).toBeNull();
    expect(p.aor).toBe("UNKNOWN");
    expect(p.direction).toBe("unclear");
    expect(p.count).toBe(4);
  });
  it("a return wave reads AWAY; a region phrase places a post with no base named", () => {
    const [a] = readChatter([post("Tankers returning home to the states after a month at Al Udeid — 3 KC-135s airborne")], NOW);
    expect(a.direction).toBe("away");
    const [r] = readChatter([post("Big C-17 airlift wave heading to the Middle East overnight, a dozen Globemasters airborne")], NOW);
    expect(r.aor).toBe("CENTCOM");
    expect(r.direction).toBe("toward");
    expect(r.count).toBe(12);
    expect(r.classes).toEqual(["airlift"]);
  });
  it("'tanker' alone is an oil tanker unless aviation context says otherwise; maritime context wins", () => {
    expect(readChatter([post("Tanker seized by IRGC in the Strait of Hormuz, vessel heading to Bandar Abbas")], NOW)).toEqual([]);
    expect(airframesIn("Three tankers airborne over the Atlantic refuelling fighters")).toHaveLength(1);
    expect(airframesIn("Three tankers transit the strait")).toHaveLength(0);
    expect(statedCount("half a dozen tankers airborne", airframesIn("half a dozen tankers airborne"))).toBe(6);
  });
  it("needs a movement phrase — a static mention of a type is not chatter", () => {
    expect(readChatter([post("The KC-46 program remains over budget, GAO says")], NOW)).toEqual([]);
  });
  it("attributes allied and adversary airframes to their side and drops old posts", () => {
    const [ru] = readChatter([post("Two Il-76s landed at Hmeimim overnight, Russian airlift continues into Syria")], NOW);
    expect(ru.side).toBe("adversary");
    expect(ru.actor).toBe("Russia");
    expect(ru.aor).toBe("CENTCOM");
    const [uk] = readChatter([post("RAF Voyager inbound to Akrotiri with a fighter drag")], NOW);
    expect(uk.side).toBe("ally");
    expect(uk.aor).toBe("EUCOM");
    expect(readChatter([post("6x KC-135 landing at Al Udeid", { pubDate: "2026-10-01T00:00:00Z" })], NOW)).toEqual([]);
  });
  it("placesIn reads cue words: a bare base is the destination only when no origin is cued", () => {
    expect(placesIn("4x C-17 Al Udeid tonight").dest?.name).toBe("Al Udeid");
    expect(placesIn("4x C-17 departed Al Udeid tonight").dest).toBeNull();
    expect(placesIn("4x C-17 from Ramstein into Al Udeid").dest?.name).toBe("Al Udeid");
  });
});

describe("clusterChatter / chatterSurge / chatterToMoves", () => {
  const posts = readChatter([
    post("6x KC-135 heading to Al Udeid tonight", { id: "a", source: "𝕏 @spotter1" }),
    post("Another 4 KC-46 inbound to Al Dhafra, big tanker surge to the Gulf", { id: "b", source: "𝕏 @spotter2", pubDate: "2026-10-27T10:00:00Z" }),
    post("C-17 landed at Al Udeid", { id: "c", source: "𝕏 @spotter1", pubDate: "2026-10-26T10:00:00Z" }),
    post("KC-135s returning home from Al Udeid", { id: "d", source: "𝕏 @spotter3" }),
    post("Two C-17s inbound to Kadena", { id: "e", source: "𝕏 @spotter4", pubDate: "2026-10-22T10:00:00Z" }),   // outside the 72-h sensor window, inside the 14-d one
  ], NOW);
  it("clusters per (command, side, direction) and corroborates by distinct handles", () => {
    const cs = clusterChatter(posts);
    const gulf = cs.find((c) => c.aor === "CENTCOM" && c.direction === "toward")!;
    expect(gulf.reports).toBe(3);
    expect(gulf.sources).toBe(2);
    expect(gulf.corroborated).toBe(true);
    expect(gulf.tankers).toBe(2);
    expect(gulf.airlifters).toBe(1);
    expect(gulf.count).toBe(6);
    expect(gulf.places).toEqual(expect.arrayContaining(["Al Udeid", "Al Dhafra"]));
    expect(gulf.lead.id).toBe("ch-b");                       // newest post leads
    expect(cs[0]).toBe(gulf);                                 // corroborated first
    const away = cs.find((c) => c.direction === "away")!;
    expect(away.aor).toBe("CENTCOM");
    expect(away.sources).toBe(1);
    expect(chatterLine(gulf)).toMatch(/^CENTCOM · inbound — 3 reports from 2 handles · tankers 2 · airlift 1 · up to 6 stated · toward/);
  });
  it("the sensor window is 72 h and excludes returning lift; nothing → null", () => {
    const s = chatterSurge(posts, "CENTCOM", NOW)!;
    expect(s.reports).toBe(3);
    expect(s.sources).toBe(2);
    expect(s.count).toBe(6);
    expect(chatterSurge(posts, "INDOPACOM", NOW)).toBeNull();     // 5 days old
    expect(chatterSurge(posts, "EUCOM", NOW)).toBeNull();
    expect(chatterSurge([], "CENTCOM", NOW)).toBeNull();
  });
  it("becomes `lift` posture moves only when placed and not returning, and merges with the detector's rows", () => {
    const moves = chatterToMoves(clusterChatter(posts));
    expect(moves.map((m) => `${m.kind}|${m.aor}`)).toEqual(expect.arrayContaining(["lift|CENTCOM", "lift|INDOPACOM"]));
    expect(moves.some((m) => m.headline.includes("returning"))).toBe(false);
    const gulf = moves.find((m) => m.aor === "CENTCOM")!;
    expect(gulf.corroborated).toBe(true);
    expect(gulf.headline).toMatch(/^Lift reported toward Al Dhafra \/ Al Udeid — 2 tanker reports, 1 airlift report, up to 6 stated/);
    expect(gulf.falsifier).toMatch(/ADS-B/);
    const merged = mergePostureMoves(detectPostureMoves([post("Pentagon sends additional fighters to the Middle East", { source: "Reuters" })], NOW), moves);
    expect(merged.find((m) => m.kind === "lift")).toBeDefined();
    expect(merged.find((m) => m.kind === "deploy")).toBeDefined();
  });
  it("a lift move is a demand driver at the reporting weight, capped like every move", () => {
    const input: DemandInput = { today: "2026-10-27", watchedAors: ["CENTCOM"], boards: [], disasters: [], advisories: [], posture: [], chokepoints: [], moves: chatterToMoves(clusterChatter(posts)).map((m) => ({ headline: m.headline, aor: m.aor, kind: m.kind, actor: m.actor, side: m.side, pubDate: m.pubDate, sources: m.sources })) };
    const gulf = demandHorizon(input).find((o) => o.aor === "CENTCOM")!;
    const d = gulf.drivers.find((x) => x.source === "move")!;
    expect(d.delta).toBe(10);
    expect(d.text).toMatch(/United States lift/);
  });
});

describe("own fields join the place list — a post naming YOUR spoke is placed and marked mine", () => {
  const own: OwnPlace[] = [
    { icao: "OJAQ", label: "Muwaffaq Salti AB", aor: "CENTCOM", own: "spoke" },
    { icao: "KWRI", label: "McGuire AFB", aor: "NORTHCOM", own: "hub" },
    { icao: "OTBH", label: "Al Udeid AB", aor: "CENTCOM", own: null, star: true },  // an AMC hub the operator also tracks
    { icao: "ZZZZ", label: "Somewhere", aor: "UNKNOWN", own: null },
  ];
  it("placesWithOwn puts own fields first and replaces the catalogue entry for the same field so `mine` is kept", () => {
    const defs = placesWithOwn(own);
    expect(defs.slice(0, 4).every((d) => d.mine)).toBe(true);
    expect(defs.filter((d) => d.icao === "OTBH")).toHaveLength(1);
    expect(defs.find((d) => d.icao === "OTBH")?.mine).toBe(true);
    expect(defs.find((d) => d.name === "Al Udeid")?.mine).toBe(true);
    expect(placesWithOwn([])).toBe(placesWithOwn(undefined));
    expect(placesWithOwn([{ icao: "bad", label: "x", aor: "EUCOM", own: null }]).every((d) => !d.mine)).toBe(true);  // a non-ICAO id is skipped
  });
  it("a post naming a spoke by its short label is placed by it — the catalogue alone would read UNKNOWN", () => {
    const text = "3x KC-135 inbound to Muwaffaq Salti this evening";
    const [bare] = readChatter([post(text)], NOW);
    expect(bare.aor).toBe("CENTCOM");       // the hand list already knows Azraq
    const [p] = readChatter([post("2x C-17 inbound to McGuire tonight")], NOW, { ownPlaces: own });
    expect(p.icao).toBe("KWRI");
    expect(p.mine).toBe(true);
    expect(p.aor).toBe("NORTHCOM");
    const [q] = readChatter([post("2x C-17 inbound to McGuire tonight")], NOW);
    expect(q.mine).toBe(false);
    expect(q.icao).toBeNull();
  });
  it("a catalogue hub you also track keeps mine; an untracked catalogue hub does not", () => {
    const [p] = readChatter([post("6x KC-135 heading to Al Udeid tonight")], NOW, { ownPlaces: own });
    expect(p.icao).toBe("OTBH");
    expect(p.mine).toBe(true);
    const [q] = readChatter([post("Another 4 KC-46 inbound to Al Dhafra")], NOW, { ownPlaces: own });
    expect(q.icao).toBe("OMAM");
    expect(q.mine).toBe(false);
  });
  it("a return wave FROM your field carries its ICAO (the field's SITREP row sees the departure)", () => {
    const [p] = readChatter([post("KC-135s returning home from Muwaffaq Salti")], NOW, { ownPlaces: own });
    expect(p.direction).toBe("away");
    expect(p.icao).toBe("OJAQ");
    expect(p.mine).toBe(true);
    expect(p.aor).toBe("CENTCOM");
  });
  it("clusters sort mine first and carry the ICAOs named", () => {
    const cs = clusterChatter(readChatter([
      post("Another 4 KC-46 inbound to Al Dhafra", { id: "a", source: "𝕏 @s1" }),
      post("More KC-46 inbound to Al Dhafra", { id: "b", source: "𝕏 @s2" }),
      post("2x C-17 inbound to McGuire tonight", { id: "c", source: "𝕏 @s3" }),
    ], NOW, { ownPlaces: own }));
    expect(cs[0].mine).toBe(true);
    expect(cs[0].icaos).toEqual(["KWRI"]);
    expect(cs[1].corroborated).toBe(true);
    expect(cs[1].mine).toBe(false);
  });
  it("chatterForIcao: the posts naming ONE field inside the sensor window, inbound vs departing; nothing → null", () => {
    const posts = readChatter([
      post("3x KC-135 inbound to Muwaffaq Salti", { id: "a", source: "𝕏 @s1" }),
      post("KC-135s returning home from Muwaffaq Salti", { id: "b", source: "𝕏 @s2", pubDate: "2026-10-27T11:00:00Z" }),
      post("C-17 landed at OJAQ last week", { id: "c", source: "𝕏 @s3", pubDate: "2026-10-20T10:00:00Z" }),  // outside 72 h
      post("2x C-17 inbound to McGuire tonight", { id: "d", source: "𝕏 @s4" }),
    ], NOW, { ownPlaces: own });
    const f = chatterForIcao(posts, "ojaq", NOW)!;
    expect(f.icao).toBe("OJAQ");
    expect(f.reports).toBe(2);
    expect(f.sources).toBe(2);
    expect(f.corroborated).toBe(true);
    expect(f.inbound).toBe(1);
    expect(f.outbound).toBe(1);
    expect(f.count).toBe(3);
    expect(f.lead.source).toBe("𝕏 @s2");  // newest
    expect(fieldChatterLine(f, () => "1h ago")).toBe("2 reports from 2 handles naming OJAQ · tankers 2 · up to 3 stated · 1 inbound · 1 departing · newest 1h ago");
    expect(chatterForIcao(posts, "OTBH", NOW)).toBeNull();
    expect(chatterForIcao(posts, "", NOW)).toBeNull();
  });
});

describe("mobilityWithChatter — reported beside observed, never in place of it", () => {
  const surge = { reports: 3, sources: 2, tankers: 2, airlifters: 1, count: 6, lead: "x" };
  it("no chatter changes nothing", () => {
    expect(mobilityWithChatter({ state: "active", confidence: 0.7, observedHigh: true, live: true }, null)).toEqual({ state: "active", confidence: 0.7, note: "" });
  });
  it("corroborates an observed surge: confidence up, state kept", () => {
    const r = mobilityWithChatter({ state: "active", confidence: 0.7, observedHigh: true, live: true }, surge);
    expect(r.state).toBe("active");
    expect(r.confidence).toBeCloseTo(0.8, 5);
    expect(r.note).toMatch(/corroborates the observed lift/);
  });
  it("two handles lift a DORMANT read to watching only; one handle is a note; an active early-warning read keeps its state", () => {
    const up = mobilityWithChatter({ state: "dormant", confidence: 0, observedHigh: false, live: true }, surge);
    expect(up.state).toBe("watching");
    expect(up.confidence).toBe(0.4);
    expect(up.note).toMatch(/reported, not observed — caps at watching/);
    const one = mobilityWithChatter({ state: "dormant", confidence: 0, observedHigh: false, live: true }, { ...surge, sources: 1, reports: 1 });
    expect(one.state).toBe("dormant");
    expect(one.note).toMatch(/a single handle is a lead/);
    const ew = mobilityWithChatter({ state: "active", confidence: 0.7, observedHigh: false, live: true }, surge);
    expect(ew.state).toBe("active");
    expect(ew.confidence).toBe(0.7);
    expect(ew.note).toMatch(/not yet shown above normal/);
  });
  it("with every ADS-B instrument dead, chatter earns watching at 0.35 and says reported only", () => {
    const r = mobilityWithChatter({ state: "dormant", confidence: 0, observedHigh: false, live: false }, { ...surge, sources: 1, reports: 1 });
    expect(r.state).toBe("watching");
    expect(r.confidence).toBe(0.35);
    expect(r.note).toMatch(/ADS-B unreachable.*reported only, capped at watching/);
  });
});
