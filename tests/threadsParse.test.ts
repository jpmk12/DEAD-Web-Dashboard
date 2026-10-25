import { describe, it, expect } from "vitest";
import { parseThreadsReply, isEmptyThreads } from "../lib/threadsParse";
import { parseModelJson, ModelJsonError } from "../lib/aiJson";
import { classifyModelFailure } from "../lib/modelFailure";

const IDS = new Set(["a1", "a2", "a3"]);
const good = {
  throughLine: "The day points one way.",
  threads: [
    { label: "iran war", headline: "H1", summary: "S1", amc: "Lift to CENTCOM rises.", trend: "rising", articleIds: ["a1", "zzz"], sources: ["Reuters"] },
    { label: "MARKETS", headline: "H2", summary: "S2", trend: "sideways", articleIds: ["a2", "a3"], sources: [] },
    { label: "NO IDS", headline: "H3", summary: "S3", trend: "stable", articleIds: ["nope"], sources: [] },
  ],
};

describe("parseThreadsReply", () => {
  it("validates the shape: labels upper-cased, unknown trend → stable, foreign ids dropped, id-less threads removed", () => {
    const { result, truncated } = parseThreadsReply("```json\n" + JSON.stringify(good) + "\n```", IDS);
    expect(truncated).toBe(false);
    expect(result.throughLine).toBe("The day points one way.");
    expect(result.threads.map((t) => t.label)).toEqual(["IRAN WAR", "MARKETS"]);
    expect(result.threads[0].articleIds).toEqual(["a1"]);
    expect(result.threads[0].amc).toBe("Lift to CENTCOM rises.");
    expect(result.threads[1].trend).toBe("stable");
    expect(result.threads[1].amc).toBeUndefined();
  });

  it("REPAIRS a reply cut off at max_tokens instead of failing the whole read", () => {
    const full = JSON.stringify(good);
    const cut = full.slice(0, full.indexOf('"label":"NO IDS"') - 1); // mid-array, after two complete threads
    const { result, truncated } = parseThreadsReply(cut, IDS);
    expect(truncated).toBe(true);
    expect(result.threads.map((t) => t.label)).toEqual(["IRAN WAR", "MARKETS"]);
    expect(result.throughLine).toBe("The day points one way.");
  });

  it("throws ModelJsonError (never returns a fake empty read) when nothing object-shaped survives", () => {
    expect(() => parseThreadsReply("I could not find any threads today.", IDS)).toThrow(ModelJsonError);
    expect(() => parseThreadsReply("", IDS)).toThrow(ModelJsonError);
    expect(() => parseThreadsReply("{}", IDS)).not.toThrow();
    expect(isEmptyThreads(parseThreadsReply("{}", IDS).result)).toBe(true);
  });
});

describe("parseModelJson", () => {
  it("is the one door: fences stripped, truncation repaired and reported, nothing-shaped throws", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ value: { a: 1 }, truncated: false });
    expect(parseModelJson('{"a":1,"b":[1,2')).toEqual({ value: { a: 1, b: [1, 2] }, truncated: true });
    expect(() => parseModelJson("   ")).toThrow(/no text/);
    expect(() => parseModelJson("nope")).toThrow(/not JSON/);
  });
});

describe("classifyModelFailure", () => {
  it("names the class of failure, never the raw message", () => {
    const sdkTimeout = Object.assign(new Error("Request timed out. req_123 host=api.anthropic.com"), { name: "APIConnectionTimeoutError" });
    expect(classifyModelFailure(sdkTimeout)).toMatchObject({ kind: "timeout", transient: true });
    expect(classifyModelFailure(sdkTimeout).text).not.toContain("req_123");
    expect(classifyModelFailure(Object.assign(new Error("Overloaded"), { status: 529 })).kind).toBe("overloaded");
    expect(classifyModelFailure(Object.assign(new Error("rate"), { status: 429 })).kind).toBe("rate-limited");
    expect(classifyModelFailure(Object.assign(new Error("bad request"), { status: 400 })).kind).toBe("api-error");
    expect(classifyModelFailure(Object.assign(new Error("fetch failed"), { name: "APIConnectionError" })).kind).toBe("network");
    expect(classifyModelFailure(new ModelJsonError("not-json"))).toMatchObject({ kind: "not-json", transient: false });
    expect(classifyModelFailure(new ModelJsonError("empty")).kind).toBe("empty");
    expect(classifyModelFailure("???").kind).toBe("unknown");
  });
});
