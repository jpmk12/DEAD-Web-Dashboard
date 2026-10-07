import { describe, it, expect } from "vitest";
import {
  asToggleOp, nextStringList, nextNewsletterRules, enabledRuleIds,
  escapeJsonSearch, sourceChips, sourcesOnLabel,
} from "../lib/newsSourceToggle";
import type { NewsletterSourceRule } from "../lib/types";

describe("asToggleOp", () => {
  it("defaults to add and refuses anything but add/remove", () => {
    expect(asToggleOp(undefined)).toBe("add");
    expect(asToggleOp(null)).toBe("add");
    expect(asToggleOp("add")).toBe("add");
    expect(asToggleOp("remove")).toBe("remove");
    expect(asToggleOp("delete")).toBeNull();
    expect(asToggleOp(1)).toBeNull();
  });
});

describe("nextStringList", () => {
  it("add is idempotent — a double tap adds once", () => {
    expect(nextStringList(["a"], "b", "add", 10)).toEqual(["a", "b"]);
    expect(nextStringList(["a", "b"], "b", "add", 10)).toEqual(["a", "b"]);
  });
  it("add trims and ignores an empty value", () => {
    expect(nextStringList(["a"], "  b ", "add", 10)).toEqual(["a", "b"]);
    expect(nextStringList(["a"], "   ", "add", 10)).toEqual(["a"]);
  });
  it("add past the cap drops the OLDEST entries (the SQL trim's rule)", () => {
    expect(nextStringList(["a", "b", "c"], "d", "add", 3)).toEqual(["b", "c", "d"]);
  });
  it("remove drops every copy and is a no-op when absent", () => {
    expect(nextStringList(["a", "b", "a"], "a", "remove", 10)).toEqual(["b"]);
    expect(nextStringList(["a"], "zz", "remove", 10)).toEqual(["a"]);
  });
  it("never mutates the input", () => {
    const cur = ["a"];
    nextStringList(cur, "b", "add", 10);
    nextStringList(cur, "a", "remove", 10);
    expect(cur).toEqual(["a"]);
  });
});

describe("nextNewsletterRules / enabledRuleIds", () => {
  const rules: NewsletterSourceRule[] = [
    { id: "politico", label: "POLITICO", matchType: "sender", value: "politico.com", enabled: true },
    { id: "merge", label: "THE MERGE", matchType: "sender", value: "news@themerge.co" },
  ];
  it("remove DISABLES the rule rather than deleting it — label and value survive", () => {
    const next = nextNewsletterRules(rules, "politico", "remove");
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ ...rules[0], enabled: false });
    expect(next[1]).toBe(rules[1]);
  });
  it("add re-enables, including a rule that never carried the flag", () => {
    const off = nextNewsletterRules(rules, "merge", "remove");
    expect(enabledRuleIds(off)).toEqual(["politico"]);
    expect(enabledRuleIds(nextNewsletterRules(off, "merge", "add"))).toEqual(["politico", "merge"]);
  });
  it("an unknown id changes nothing", () => {
    expect(nextNewsletterRules(rules, "nope", "remove")).toEqual(rules);
  });
  it("enabledRuleIds treats a missing flag as enabled", () => {
    expect(enabledRuleIds(rules)).toEqual(["politico", "merge"]);
  });
});

describe("escapeJsonSearch", () => {
  it("escapes the LIKE wildcards and the escape char itself", () => {
    expect(escapeJsonSearch("Task & Purpose")).toBe("Task & Purpose");
    expect(escapeJsonSearch("100%_x\\y")).toBe("100\\%\\_x\\\\y");
  });
});

describe("sourceChips / sourcesOnLabel", () => {
  it("enabled first by count then name; muted after by name; a muted source absent from the stats is still listed", () => {
    const chips = sourceChips(
      [{ name: "NPR News", count: 4 }, { name: "DVIDS", count: 9 }, { name: "The Hill", count: 4 }, { name: "Krebs on Security", count: 2 }],
      ["Krebs on Security", "The War Zone"],
    );
    expect(chips.map((c) => `${c.name}:${c.enabled ? c.count : "off"}`)).toEqual([
      "DVIDS:9", "NPR News:4", "The Hill:4", "Krebs on Security:off", "The War Zone:off",
    ]);
  });
  it("merges a duplicated stats name and never reports a negative count", () => {
    const chips = sourceChips([{ name: "Stars & Stripes", count: 2 }, { name: "Stars & Stripes", count: 3 }, { name: "x", count: -5 }], []);
    expect(chips.find((c) => c.name === "Stars & Stripes")?.count).toBe(5);
    expect(chips.find((c) => c.name === "x")?.count).toBe(0);
  });
  it("sourcesOnLabel counts what is on", () => {
    const chips = sourceChips([{ name: "a", count: 1 }, { name: "b", count: 1 }], ["b"]);
    expect(sourcesOnLabel(chips)).toBe("1 of 2 sources on");
    expect(sourcesOnLabel(sourceChips([{ name: "a", count: 1 }], []))).toBe("1 of 1 source on");
    expect(sourcesOnLabel([])).toBe("0 of 0 sources on");
  });
});
