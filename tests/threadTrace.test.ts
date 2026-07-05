import { describe, it, expect } from "vitest";
import { parseThreadTrace, termDefinition } from "../lib/threadTrace";

const DOC = [
  "# Theory of Victory",
  "",
  "*One idea traced across sources.*",
  "",
  "## Gloss",
  "How wars are actually won.",
  "",
  "## Trace",
  "",
  "1. [[Clausewitz]] — compel the enemy",
  "2. [[Douhet]] — break civil will",
  "3. [[Pape | contradicts: denial beats punishment]]",
  "4. plain waypoint without a link",
  "",
  "## So what",
  "The tail section.",
].join("\n");

describe("parseThreadTrace", () => {
  it("finds the trace list and parses stops", () => {
    const t = parseThreadTrace(DOC)!;
    expect(t).not.toBeNull();
    expect(t.stops).toHaveLength(4);
    expect(t.stops[0]).toEqual({ title: "Clausewitz", relation: null, note: null, gloss: "compel the enemy" });
    expect(t.stops[2].relation).toBe("contradicts");
    expect(t.stops[2].note).toBe("denial beats punishment");
    expect(t.stops[3].title).toBeNull();
    expect(t.stops[3].gloss).toBe("plain waypoint without a link");
  });

  it("keeps pre (through the heading) and post (after the list)", () => {
    const t = parseThreadTrace(DOC)!;
    expect(t.pre.endsWith("## Trace")).toBe(true);
    expect(t.post).toContain("## So what");
    expect(t.post).not.toContain("[[Clausewitz]]");
  });

  it("appends wrapped continuation lines to the previous stop's gloss", () => {
    const t = parseThreadTrace("## Trace\n1. [[A]] — first part\n   continues here\n2. [[B]] — second")!;
    expect(t.stops[0].gloss).toBe("first part continues here");
  });

  it("returns null with no trace heading or fewer than 2 stops", () => {
    expect(parseThreadTrace("# Doc\n\n1. [[A]] — x\n2. [[B]] — y")).toBeNull();
    expect(parseThreadTrace("## Trace\n1. [[A]] — only one")).toBeNull();
  });

  it("ignores trace headings inside code fences", () => {
    expect(parseThreadTrace("```\n## Trace\n```\n1. [[A]]\n2. [[B]]")).toBeNull();
  });
});

describe("termDefinition", () => {
  it("takes the first prose paragraph, skipping headings, lists, and breadcrumbs", () => {
    const d = termDefinition("← part of [[Master]]\n\n# friction\n\n- a list item\n\nThe accumulation of *countless* small difficulties.\nSecond line of the same paragraph.\n\nNext paragraph.");
    expect(d).toBe("The accumulation of countless small difficulties. Second line of the same paragraph.");
  });

  it("strips wiki links and caps length", () => {
    const d = termDefinition("See [[Clausewitz — On War | defines: origin]] for origin.", 30);
    expect(d).toContain("Clausewitz — On War");
    expect(d.length).toBeLessThanOrEqual(30);
  });

  it("returns empty for docs with no prose", () => {
    expect(termDefinition("# Only a heading\n\n- and a list")).toBe("");
  });
});
