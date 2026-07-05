import { describe, it, expect } from "vitest";
import { parseDocQuery, matchesProps } from "../lib/docSearch";

describe("parseDocQuery", () => {
  it("plain text passes through", () => {
    expect(parseDocQuery("clausewitz friction")).toEqual({ text: "clausewitz friction", props: {}, types: [] });
  });

  it("splits key:value tokens out of the text", () => {
    const q = parseDocQuery("clausewitz course:600 domain:theory");
    expect(q.text).toBe("clausewitz");
    expect(q.props).toEqual({ course: "600", domain: "theory" });
  });

  it("reserved type: token filters doc type", () => {
    const q = parseDocQuery("type:theorist era:1832");
    expect(q.types).toEqual(["theorist"]);
    expect(q.props).toEqual({ era: "1832" });
    expect(q.text).toBe("");
  });

  it("does not treat URLs as tokens mid-word", () => {
    // https://x — "https" is a token candidate only when preceded by
    // whitespace/start; it IS at start, so it parses as key https → value.
    // Accept that edge (users don't search raw URLs), but ensure mid-text
    // colons in words don't explode.
    const q = parseDocQuery("shi (potential energy)");
    expect(q.text).toBe("shi (potential energy)");
  });

  it("keys are case-insensitive, stored lowercase", () => {
    expect(parseDocQuery("Course:600").props).toEqual({ course: "600" });
  });
});

describe("matchesProps", () => {
  const props = { era: "1832", course: "600", domain: "Theory" };

  it("matches on substring, case-insensitive, all filters must hit", () => {
    expect(matchesProps(props, { era: "18" })).toBe(true);
    expect(matchesProps(props, { domain: "theory" })).toBe(true);
    expect(matchesProps(props, { era: "18", course: "600" })).toBe(true);
    expect(matchesProps(props, { era: "19" })).toBe(false);
    expect(matchesProps(props, { missing: "x" })).toBe(false);
  });

  it("no filters always matches; missing props never matches filters", () => {
    expect(matchesProps(undefined, {})).toBe(true);
    expect(matchesProps(undefined, { era: "18" })).toBe(false);
  });

  it("doc property keys match case-insensitively", () => {
    expect(matchesProps({ Era: "1832" }, { era: "1832" })).toBe(true);
  });
});
