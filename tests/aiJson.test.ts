import { describe, it, expect } from "vitest";
import { extractJsonObject, extractJsonArray } from "@/lib/aiJson";

describe("extractJsonObject", () => {
  it("returns a plain object string unchanged (parseable)", () => {
    expect(JSON.parse(extractJsonObject('{"a":1}'))).toEqual({ a: 1 });
  });

  it("strips ```json fences", () => {
    expect(JSON.parse(extractJsonObject('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
  });

  it("strips bare ``` fences", () => {
    expect(JSON.parse(extractJsonObject('```\n{"a":1}\n```'))).toEqual({ a: 1 });
  });

  it("slices out prose before and after the object", () => {
    expect(JSON.parse(extractJsonObject('Here you go: {"a":1} hope that helps'))).toEqual({ a: 1 });
  });

  it("keeps nested braces intact", () => {
    expect(JSON.parse(extractJsonObject('{"a":{"b":2},"c":[1,2]}'))).toEqual({ a: { b: 2 }, c: [1, 2] });
  });

  it("returns '{}' when there is no object", () => {
    expect(extractJsonObject("no json here")).toBe("{}");
  });
});

describe("extractJsonArray", () => {
  it("returns a plain array string unchanged (parseable)", () => {
    expect(JSON.parse(extractJsonArray('[1,2,3]'))).toEqual([1, 2, 3]);
  });

  it("strips fences and surrounding prose", () => {
    expect(JSON.parse(extractJsonArray('```json\n[{"id":"x"}]\n```'))).toEqual([{ id: "x" }]);
  });

  it("returns '[]' when there is no array", () => {
    expect(extractJsonArray("nothing")).toBe("[]");
  });
});
