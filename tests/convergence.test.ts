import { describe, it, expect } from "vitest";
import { findConvergence, canonicalSubject, convergenceLine, KIND_ORDER } from "../lib/convergence";
import type { ConvergenceSignal, ConvergenceKind } from "../lib/convergence";

const s = (subject: string, kind: ConvergenceKind, weight = 10, detail = "d"): ConvergenceSignal =>
  ({ subject, kind, weight, detail });

describe("canonicalSubject", () => {
  it("joins the different names surfaces give the same place", () => {
    // A disaster feed says "Iran (Islamic Republic of)" and an I&W label says
    // "Iran". Without this they never meet and convergence silently
    // under-reports exactly when it matters most.
    expect(canonicalSubject("Iran (Islamic Republic of)")).toBe("iran");
    expect(canonicalSubject("The Republic of Iraq")).toBe("iraq");
    expect(canonicalSubject("  YEMEN  ")).toBe("yemen");
    expect(canonicalSubject("Congo (Kinshasa)")).toBe("congo");
  });

  it("does not merge genuinely different places", () => {
    // Over-eager normalising is a worse failure than a missed join.
    expect(canonicalSubject("South Sudan")).not.toBe(canonicalSubject("Sudan"));
    expect(canonicalSubject("Guinea-Bissau")).not.toBe(canonicalSubject("Guinea"));
  });

  it("handles empty and whitespace input", () => {
    expect(canonicalSubject("")).toBe("");
    expect(canonicalSubject("   ")).toBe("");
  });
});

describe("findConvergence — distinct kinds only", () => {
  it("does not treat one surface repeating itself as agreement", () => {
    // Three disaster alerts in one country is one story reported three times,
    // not corroboration — the same single-source trap the I&W board avoids.
    const sig = [s("Yemen", "disaster", 50), s("Yemen", "disaster", 40), s("Yemen", "disaster", 30)];
    expect(findConvergence(sig)).toEqual([]);
  });

  it("fires when two different surfaces agree", () => {
    const r = findConvergence([s("Yemen", "disaster"), s("Yemen", "feed")]);
    expect(r).toHaveLength(1);
    expect(r[0].breadth).toBe(2);
  });

  it("keeps only the strongest signal per kind so a chatty surface cannot inflate a row", () => {
    const r = findConvergence([
      s("Yemen", "feed", 10), s("Yemen", "feed", 90), s("Yemen", "iw", 20),
    ]);
    expect(r[0].signals).toHaveLength(2);
    expect(r[0].signals.find((x) => x.kind === "feed")!.weight).toBe(90);
    expect(r[0].score).toBe(110);
  });

  it("joins across differently-spelled subjects", () => {
    const r = findConvergence([s("Iran (Islamic Republic of)", "disaster"), s("Iran", "iw")]);
    expect(r).toHaveLength(1);
    // Display prefers the fullest spelling actually seen.
    expect(r[0].subject).toBe("Iran (Islamic Republic of)");
  });
});

describe("findConvergence — ranking", () => {
  it("ranks breadth above intensity", () => {
    // One screaming source is already visible on its own pane; the claim this
    // card makes is that independent surfaces agree.
    const r = findConvergence([
      s("Loud", "iw", 100), s("Loud", "feed", 100),
      s("Broad", "iw", 10), s("Broad", "feed", 10), s("Broad", "disaster", 10),
    ]);
    expect(r.map((x) => x.subject)).toEqual(["Broad", "Loud"]);
  });

  it("uses summed strength only to break a breadth tie", () => {
    const r = findConvergence([
      s("Weak", "iw", 5), s("Weak", "feed", 5),
      s("Strong", "iw", 50), s("Strong", "feed", 50),
    ]);
    expect(r.map((x) => x.subject)).toEqual(["Strong", "Weak"]);
  });

  it("orders each row's signals by KIND_ORDER, not arrival order", () => {
    const r = findConvergence([s("X", "feed"), s("X", "disaster"), s("X", "iw")]);
    const kinds = r[0].signals.map((x) => x.kind);
    expect(kinds).toEqual(["iw", "disaster", "feed"]);
    // And that order is the declared one.
    expect(kinds).toEqual(KIND_ORDER.filter((k) => kinds.includes(k)));
  });

  it("caps the list and respects an explicit minBreadth", () => {
    const many: ConvergenceSignal[] = [];
    for (let i = 0; i < 12; i++) many.push(s(`P${i}`, "iw"), s(`P${i}`, "feed"));
    expect(findConvergence(many)).toHaveLength(5);
    expect(findConvergence(many, { max: 2 })).toHaveLength(2);
    expect(findConvergence([s("Solo", "iw")], { minBreadth: 1 })).toHaveLength(1);
  });

  it("ignores blank subjects rather than grouping them together", () => {
    expect(findConvergence([s("", "iw"), s("  ", "feed")])).toEqual([]);
  });
});

describe("convergenceLine", () => {
  it("states the claim and names the surfaces", () => {
    const r = findConvergence([s("Yemen", "iw"), s("Yemen", "posture"), s("Yemen", "feed")]);
    expect(convergenceLine(r[0])).toBe("3 surfaces agree — I&W · Posture · Feeds");
  });
});
