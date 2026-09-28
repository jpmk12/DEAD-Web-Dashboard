import { describe, it, expect } from "vitest";
import {
  findReactivations, mentions, isUsefulTerm, dismissKey, ageText,
  DORMANT_DAYS, SIGNAL_WEIGHT,
} from "../lib/reactivation";
import type { Interest, ActiveSignal } from "../lib/reactivation";

const saved = (over: Partial<Interest> = {}): Interest => ({
  kind: "saved", id: "s1", title: "Houthi attacks on shipping near Bab-el-Mandeb",
  origin: "Saved · Reuters", ageDays: 120, ...over,
});

const sig = (term: string, weight = SIGNAL_WEIGHT.moverRising, detail = "rising"): ActiveSignal =>
  ({ term, kind: "mover", detail, weight });

describe("mentions", () => {
  it("is word-bounded, not substring", () => {
    expect(mentions("the Strait of Hormuz today", "Hormuz")).toBe(true);
    expect(mentions("Hormuzian politics", "Hormuz")).toBe(false);
    expect(mentions("reporting on IRAN.", "Iran")).toBe(true);
    expect(mentions("Iranian state media", "Iran")).toBe(false);
  });

  it("allows non-word neighbours like hyphens and punctuation", () => {
    expect(mentions("operating in a GPS-denied environment", "GPS-denied")).toBe(true);
    expect(mentions("transits (Suez) daily", "Suez")).toBe(true);
  });

  it("refuses terms too short to mean anything", () => {
    expect(mentions("the UAE and oil", "oil")).toBe(false);
    expect(mentions("the UAE and oil", "UAE")).toBe(false);
  });

  it("treats a regex metacharacter as a literal, not a pattern", () => {
    // An upstream term can be anything; it must never compile into a wildcard.
    expect(mentions("anything at all", "a.*")).toBe(false);
    expect(mentions("the Bab-el-Mandeb (Yemen) corridor", "Bab-el-Mandeb (Yemen)")).toBe(true);
  });
});

describe("isUsefulTerm", () => {
  it("drops vocabulary that every doc in this corpus contains", () => {
    expect(isUsefulTerm("aircraft")).toBe(false);
    expect(isUsefulTerm("Weather")).toBe(false);
    expect(isUsefulTerm("Hormuz")).toBe(true);
  });
});

describe("findReactivations — dormancy is the point", () => {
  it("ignores an interest saved recently", () => {
    // Matching something you saved yesterday is not a discovery, it is a memory
    // of reading it. Without this gate the panel is just your saved list again.
    const fresh = saved({ ageDays: DORMANT_DAYS - 1 });
    expect(findReactivations([fresh], [sig("Bab-el-Mandeb")])).toEqual([]);
  });

  it("surfaces a dormant interest when its term goes active", () => {
    const r = findReactivations([saved()], [sig("Bab-el-Mandeb")]);
    expect(r).toHaveLength(1);
    expect(r[0].reason).toBe("Saved · Reuters · saved 4 months ago — Bab-el-Mandeb is rising");
  });

  it("ignores a nonsense age rather than treating it as ancient", () => {
    expect(findReactivations([saved({ ageDays: NaN })], [sig("Bab-el-Mandeb")])).toEqual([]);
  });
});

describe("findReactivations — matching and evidence", () => {
  it("searches the body as well as the title", () => {
    const i = saved({ title: "Red Sea notes", body: "…transits through Bab-el-Mandeb are down…" });
    expect(findReactivations([i], [sig("Bab-el-Mandeb")])).toHaveLength(1);
  });

  it("returns one row per interest, not one per term", () => {
    const i = saved({ title: "Hormuz and Bab-el-Mandeb and Suez chokepoints" });
    const r = findReactivations([i], [sig("Hormuz"), sig("Bab-el-Mandeb"), sig("Suez")]);
    expect(r).toHaveLength(1);
    expect(r[0].alsoTerms).toHaveLength(2);
    expect(r[0].reason).toMatch(/\(also /);
  });

  it("leads with the strongest signal, not the first one", () => {
    const i = saved({ title: "Hormuz and Bab-el-Mandeb" });
    const r = findReactivations([i], [
      sig("Bab-el-Mandeb", SIGNAL_WEIGHT.moverRising),
      { term: "Hormuz", kind: "iw", detail: "at WARNING on I&W", weight: SIGNAL_WEIGHT.iwWarning },
    ]);
    expect(r[0].signal.term).toBe("Hormuz");
    expect(r[0].alsoTerms).toEqual(["Bab-el-Mandeb"]);
  });

  it("drops a generic term before matching", () => {
    expect(findReactivations([saved({ title: "aircraft readiness" })], [sig("aircraft")])).toEqual([]);
  });

  it("stays silent when nothing is active", () => {
    expect(findReactivations([saved()], [])).toEqual([]);
  });
});

describe("findReactivations — dismissal", () => {
  it("honours a dismissal permanently", () => {
    const i = saved();
    const d = dismissKey(i, "Bab-el-Mandeb");
    expect(findReactivations([i], [sig("Bab-el-Mandeb")], [d])).toEqual([]);
  });

  it("scopes a dismissal to the interest+term pair, not the whole item", () => {
    // Muting "Hormuz" on this doc must not mute the doc forever — a different
    // term reactivating it is a different finding.
    const i = saved({ title: "Hormuz and Bab-el-Mandeb" });
    const r = findReactivations([i], [sig("Hormuz"), sig("Bab-el-Mandeb")], [dismissKey(i, "Hormuz")]);
    expect(r).toHaveLength(1);
    expect(r[0].signal.term).toBe("Bab-el-Mandeb");
  });

  it("promotes the next-strongest signal when the leader is dismissed", () => {
    const i = saved({ title: "Hormuz and Bab-el-Mandeb" });
    const r = findReactivations([i], [
      { term: "Hormuz", kind: "iw", detail: "at ALERT", weight: SIGNAL_WEIGHT.iwAlert },
      sig("Bab-el-Mandeb"),
    ], [dismissKey(i, "Hormuz")]);
    expect(r[0].signal.term).toBe("Bab-el-Mandeb");
    expect(r[0].alsoTerms).toEqual([]);
  });
});

describe("findReactivations — ranking and caps", () => {
  it("ranks by signal strength, then by how long dormant", () => {
    const a = saved({ id: "a", title: "Suez notes", ageDays: 30 });
    const b = saved({ id: "b", title: "Suez history", ageDays: 300 });
    const c = saved({ id: "c", title: "Hormuz brief", ageDays: 20 });
    const r = findReactivations([a, b, c], [
      sig("Suez", SIGNAL_WEIGHT.moverRising),
      { term: "Hormuz", kind: "iw", detail: "at WATCH", weight: SIGNAL_WEIGHT.iwWatch },
    ]);
    expect(r.map((x) => x.interest.id)).toEqual(["c", "b", "a"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, n) => saved({ id: `s${n}`, title: `Hormuz file ${n}` }));
    expect(findReactivations(many, [sig("Hormuz")])).toHaveLength(6);
    expect(findReactivations(many, [sig("Hormuz")], [], { max: 2 })).toHaveLength(2);
  });
});

describe("ageText", () => {
  it("is coarse, because that is how the memory is held", () => {
    expect(ageText(6)).toBe("6 days ago");
    expect(ageText(45)).toBe("2 months ago");
    expect(ageText(400)).toBe("1 year ago");
  });
});
