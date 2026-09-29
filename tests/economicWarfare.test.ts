import { describe, it, expect } from "vitest";
import {
  readInstrument, readInstruments, resolveActors, attribute, targetOf, actorProblem,
  instrumentState, counterPressureState, movesFor, rankMoves, evidenceByInstrument,
  econProblemId, econProblemLabel, instrumentForRegulatoryClass, INSTRUMENTS, INSTRUMENT_META,
  COUNTER_PRESSURE_ID, MAX_ACTORS, type Actor, type CoercionMove,
} from "../lib/economicWarfare";

const TODAY = Date.parse("2026-09-29T00:00:00Z");
const iran = (): Actor => resolveActors(["Iran"])[0];

describe("readInstrument — grammar is phrases, graded by modality", () => {
  it("a bare mention of an actor earns nothing", () => {
    expect(readInstrument("Iran's president visits Moscow for talks")).toBeNull();
    expect(readInstrument("Sanctions remain a topic in Tehran")).toBeNull();
  });
  it("grades an energy act, threat and analysis differently", () => {
    const act = readInstrument("Russia cut gas supplies to Moldova on Monday");
    const threat = readInstrument("Russia threatens to cut gas supplies to Moldova");
    const analysis = readInstrument("Why Russia could cut gas supplies to Moldova this winter");
    expect(act?.instrument).toBe("energy");
    expect(act?.modality).toBe("act");
    expect(threat?.modality).toBe("threat");
    expect(analysis?.modality).toBe("analysis");
    expect(act!.weight).toBeGreaterThan(threat!.weight);
    expect(threat!.weight).toBeGreaterThan(analysis!.weight);
  });
  it("reads shipping through the chokepoint grammar and routes airspace to overflight", () => {
    expect(readInstrument("IRGC seized a tanker in the Strait of Hormuz")?.instrument).toBe("shipping");
    expect(readInstrument("IRGC seized a tanker in the Strait of Hormuz")?.cls).toBe("seizure");
    expect(readInstrument("Iran closed its airspace to western carriers")?.instrument).toBe("overflight");
  });
  it("reads trade, finance and sanctions classes", () => {
    expect(readInstrument("China restricted exports of rare earths to the United States")?.instrument).toBe("trade");
    expect(readInstrument("China restricted exports of rare earths to the United States")?.cls).toBe("mineral / component control");
    expect(readInstrument("Iran settled in yuan for crude sold to Chinese refiners")?.instrument).toBe("finance");
    expect(readInstrument("Beijing added three US firms to the entity list")?.instrument).toBe("sanctions");
  });
  it("one text can support several instruments", () => {
    const reads = readInstruments("Iran seized a tanker and imposed sanctions on US firms in retaliation");
    const insts = reads.map((r) => r.instrument);
    expect(insts).toContain("shipping");
    expect(insts).toContain("sanctions");
    expect(reads.map((r) => r.modality)).toEqual(["threat", "threat"]); // "in retaliation" marks intent-language
  });
});

describe("resolveActors", () => {
  it("curates known actors and generates generic ones, in declaration order", () => {
    const actors = resolveActors(["Iran", "Moldova", "Iran"]);
    // Iran is a Houthi trigger country, so the non-state actor joins last.
    expect(actors.map((a) => a.id)).toEqual(["iran", "moldova", "houthis"]);
    expect(actors[0].terms.test("the IRGC navy")).toBe(true);
    expect(actors[1].terms.test("Moldovan officials")).toBe(true);
    expect(actors[1].terms.test("Romania")).toBe(false);
  });
  it("adds the Houthis only when a trigger country is tracked", () => {
    expect(resolveActors(["Moldova"]).some((a) => a.id === "houthis")).toBe(false);
    const withYemen = resolveActors(["Yemen"]);
    expect(withYemen.some((a) => a.id === "houthis")).toBe(true);
    expect(withYemen.find((a) => a.id === "houthis")?.chokepointIds).toEqual(["babelmandeb"]);
  });
  it("caps the register and never empties on garbage", () => {
    const many = resolveActors(Array.from({ length: 20 }, (_, i) => `Country${i}`));
    expect(many.length).toBe(MAX_ACTORS);
    expect(resolveActors(["", "  "])).toEqual([]);
  });
});

describe("attribute — by or against", () => {
  it("the object of a preposition is the target, not the actor", () => {
    const a = iran();
    expect(attribute("US imposes new sanctions on Iran's oil sector", a)).toBe("against");
    expect(attribute("Treasury sanctions against Iranian shipping network", a)).toBe("against");
    expect(attribute("Iran hit with new sanctions after tanker seizure", a)).toBe("against");
    expect(attribute("Iran seizes tanker in Strait of Hormuz", a)).toBe("by");
    expect(attribute("Iran threatens to close Hormuz if attacked", a)).toBe("by");
    expect(attribute("OPEC output cut agreed in Vienna", a)).toBeNull();
  });
  it("names a target for the actor's own moves", () => {
    const a = iran();
    expect(targetOf("Iran seized a tanker in the Strait of Hormuz", "shipping", a)).toBe("commercial shipping");
    expect(targetOf("Iran imposed sanctions on US firms", "sanctions", a)).toBe("United States");
    expect(targetOf("Iran halted oil exports", "energy", a)).toBe("—");
  });
});

describe("actorProblem — every indicator carries a falsifier and provenance", () => {
  it("builds one indicator per instrument plus counter-pressure, unique ids", () => {
    const def = actorProblem(iran());
    expect(def.id).toBe(econProblemId("iran"));
    const ids = def.indicators.map((i) => i.id);
    expect(ids).toEqual([...INSTRUMENTS, COUNTER_PRESSURE_ID]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of def.indicators) {
      expect(i.falsifier.length).toBeGreaterThan(20);
      expect(i.provenance.length).toBeGreaterThan(10);
      expect(i.warningProblem).toBe(def.id);
    }
    expect(def.decisionLinkage).toMatch(/fuel-cost/);
    expect(def.indicators.find((i) => i.id === "shipping")?.description).toMatch(/Strait of Hormuz/);
  });
  it("labels a stored problem id for the OE delta", () => {
    expect(econProblemLabel("econ-iran")).toBe("Economic warfare · Iran");
    expect(econProblemLabel("econ-north-korea")).toBe("Economic warfare · North Korea");
    expect(econProblemLabel("econ-burkina-faso")).toBe("Economic warfare · Burkina Faso");
    expect(econProblemLabel("centcom_iran")).toBeNull();
  });
  it("shipping outweighs the counter-pressure indicator", () => {
    expect(INSTRUMENT_META.shipping.weight).toBeGreaterThan(0.4);
  });
});

describe("instrumentState — the same ladder as the chokepoint indicator", () => {
  it("wire act → active; two wire sources or own agreement → confirmed", () => {
    expect(instrumentState([{ modality: "act", own: false, source: "reuters" }]).state).toBe("active");
    expect(instrumentState([{ modality: "act", own: false, source: "reuters" }, { modality: "act", own: false, source: "ap" }]).state).toBe("confirmed");
    expect(instrumentState([{ modality: "act", own: false, source: "reuters" }, { modality: "threat", own: true, source: "x" }]).state).toBe("confirmed");
    expect(instrumentState([{ modality: "act", own: false, source: "reuters" }, { modality: "act", own: false, source: "reuters" }]).state).toBe("active");
  });
  it("threat → watching; active with own-source agreement", () => {
    expect(instrumentState([{ modality: "threat", own: false, source: "reuters" }]).state).toBe("watching");
    expect(instrumentState([{ modality: "threat", own: false, source: "reuters" }, { modality: "act", own: true, source: "x" }]).state).toBe("active");
  });
  it("own-source only caps at watching, even for an act", () => {
    const s = instrumentState([{ modality: "act", own: true, source: "x" }, { modality: "act", own: true, source: "nl" }]);
    expect(s.state).toBe("watching");
    expect(s.why).toMatch(/own sources only/);
  });
  it("analysis alone needs two pieces and stays low; nothing → dormant", () => {
    expect(instrumentState([{ modality: "analysis", own: false, source: "a" }]).state).toBe("dormant");
    const two = instrumentState([{ modality: "analysis", own: false, source: "a" }, { modality: "analysis", own: false, source: "b" }]);
    expect(two.state).toBe("watching");
    expect(two.confidence).toBeLessThan(0.4);
    expect(instrumentState([]).state).toBe("dormant");
  });
});

describe("counterPressureState — recency is the signal", () => {
  it("standing regime is dormant; recent actions climb", () => {
    expect(counterPressureState([40, 33]).state).toBe("dormant");
    expect(counterPressureState([40, 33]).why).toMatch(/standing regime/);
    expect(counterPressureState([10]).state).toBe("watching");
    expect(counterPressureState([2, 5]).state).toBe("active");
    expect(counterPressureState([]).state).toBe("dormant");
  });
});

describe("movesFor + rankMoves — the coercion board", () => {
  const a = iran();
  const texts = [
    { title: "Iran seized a tanker in the Strait of Hormuz", link: "https://x/1", source: "reuters", pubDate: "2026-09-28T10:00:00Z", own: false },
    { title: "Iran threatens to close the strait if attacked", link: "https://x/2", source: "ap", pubDate: "2026-09-27T10:00:00Z", own: false },
    { title: "US imposes sanctions on Iranian oil exports", link: "https://x/3", source: "reuters", pubDate: "2026-09-26T10:00:00Z", own: false },
    { title: "Why Iran might cut oil exports next year", link: "https://x/4", source: "foreignpolicy", pubDate: "2026-09-25T10:00:00Z", own: false },
    { title: "Iran seized a tanker in the Strait of Hormuz", link: "https://x/1", source: "reuters", pubDate: "2026-09-28T10:00:00Z", own: false }, // dup
    { title: "Iran halted oil exports to Europe", link: "https://x/5", source: "reuters", pubDate: "2026-08-01T10:00:00Z", own: false }, // too old
    { title: "Rouhani statue unveiled in Tehran", link: "https://x/6", source: "reuters", pubDate: "2026-09-28T10:00:00Z", own: false }, // nothing shaped
  ];
  it("grades, attributes, dedupes, windows", () => {
    const moves = movesFor(a, texts, TODAY);
    const titles = moves.map((m) => m.title);
    expect(titles).toContain("Iran seized a tanker in the Strait of Hormuz");
    expect(titles.filter((t) => t.startsWith("Iran seized")).length).toBe(1);
    expect(titles).not.toContain("Iran halted oil exports to Europe");
    expect(titles).not.toContain("Rouhani statue unveiled in Tehran");
    const us = moves.find((m) => m.title.startsWith("US imposes"));
    expect(us?.direction).toBe("against");
    expect(us?.target).toBe("Iran");
    const seizure = moves.find((m) => m.title.startsWith("Iran seized"));
    expect(seizure?.direction).toBe("by");
    expect(seizure?.target).toBe("commercial shipping");
    expect(seizure?.ageDays).toBe(1);
  });
  it("ranks acts before threats before analysis", () => {
    const ranked = rankMoves(movesFor(a, texts, TODAY));
    expect(ranked[0].modality).toBe("act");
    expect(ranked[ranked.length - 1].modality).toBe("analysis");
  });
  it("evidence is keyed by instrument from the actor's own moves only", () => {
    const ev = evidenceByInstrument(movesFor(a, texts, TODAY));
    expect(ev.shipping.length).toBe(2);
    expect(ev.sanctions.length).toBe(0); // the US action is "against"
    expect(ev.energy.length).toBe(1);
    expect(ev.energy[0].modality).toBe("analysis");
  });
  it("maps regulatory classes onto instruments", () => {
    expect(instrumentForRegulatoryClass("tariff")).toBe("trade");
    expect(instrumentForRegulatoryClass("sanctions")).toBe("sanctions");
    expect(instrumentForRegulatoryClass("export-control")).toBe("sanctions");
  });
  it("undated rows sort after dated ones of the same weight", () => {
    const base: CoercionMove = {
      id: "x", actorId: "iran", actorLabel: "Iran", direction: "by", target: "—", instrument: "energy", cls: "supply cut",
      modality: "act", weight: 90, title: "a", ageDays: null, own: false, phrase: "p",
    };
    const ranked = rankMoves([base, { ...base, id: "y", title: "b", ageDays: 3 }]);
    expect(ranked[0].id).toBe("y");
  });
});
