import { describe, it, expect } from "vitest";
import { parseXCapture, parseMetric, sanitizeXUrl, X_MAX_ITEMS } from "../lib/xImport";

const wrap = (items: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: "dead-x-capture",
    version: 1,
    capturedAt: "2026-07-05T14:00:00Z",
    source: { kind: "list", label: "Mobility watch" },
    items,
    ...extra,
  });

describe("parseXCapture envelope", () => {
  it("rejects non-JSON, wrong format, and wrong version with distinct errors", () => {
    expect(parseXCapture("not json").ok).toBe(false);
    const wrongFmt = parseXCapture(JSON.stringify({ format: "something", version: 1, items: [] }));
    expect(wrongFmt.ok).toBe(false);
    if (!wrongFmt.ok) expect(wrongFmt.error).toMatch(/dead-x-capture/);
    const wrongVer = parseXCapture(JSON.stringify({ format: "dead-x-capture", version: 2, items: [] }));
    expect(wrongVer.ok).toBe(false);
    if (!wrongVer.ok) expect(wrongVer.error).toMatch(/version/);
  });

  it("parses a valid capture and normalizes the source", () => {
    const r = parseXCapture(wrap([
      { id: "1808912345678901234", url: "https://x.com/user1/status/1808912345678901234", author: "User One", handle: "@user1", time: "2026-07-05T13:00:00.000Z", text: "C-17s spotted at Ramstein", metrics: { likes: "1.2K", reposts: 34 } },
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.capture.source).toEqual({ kind: "list", label: "Mobility watch" });
    expect(r.capture.capturedAt).toBe("2026-07-05T14:00:00.000Z");
    const p = r.capture.items[0];
    expect(p.id).toBe("1808912345678901234");
    expect(p.handle).toBe("user1");            // @ stripped
    expect(p.metrics).toEqual({ likes: 1200, reposts: 34 });
  });

  it("strips the browser-tab notification-count prefix from the label", () => {
    const r = parseXCapture(wrap([{ id: "99991111", text: "x" }], { source: { kind: "list", label: "(20) Mobility watch" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.capture.source.label).toBe("Mobility watch");
  });

  it("falls back to kind unknown for unrecognized source kinds", () => {
    const r = parseXCapture(JSON.stringify({
      format: "dead-x-capture", version: 1,
      source: { kind: "dms", label: "" },
      items: [{ text: "hello" }],
    }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.capture.source).toEqual({ kind: "unknown", label: "unknown" });
  });
});

describe("parseXCapture items", () => {
  it("derives the id from the status URL when absent, and hashes deterministically when both missing", () => {
    const r = parseXCapture(wrap([
      { url: "https://twitter.com/a/status/12345678", text: "from url" },
      { handle: "b", text: "no id at all" },
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.capture.items[0].id).toBe("12345678");
    expect(r.capture.items[0].url).toBe("https://x.com/a/status/12345678"); // canonicalized
    expect(r.capture.items[1].id).toMatch(/^h[0-9a-f]+$/);
    // determinism: same handle+text → same hash id
    const r2 = parseXCapture(wrap([{ handle: "b", text: "no id at all" }]));
    if (r2.ok) expect(r2.capture.items[0].id).toBe(r.capture.items[1].id);
  });

  it("skips textless items, collapses duplicate ids, and reports both", () => {
    const r = parseXCapture(wrap([
      { id: "11112222", text: "first" },
      { id: "11112222", text: "same id again" },
      { id: "33334444", text: "   " },
      "not an object",
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.capture.items).toHaveLength(1);
    expect(r.skipped).toBe(3);
    expect(r.warnings.join(" ")).toMatch(/duplicate/);
    expect(r.warnings.join(" ")).toMatch(/no text/);
  });

  it("caps at the item limit and truncates long text", () => {
    const many = Array.from({ length: X_MAX_ITEMS + 25 }, (_, i) => ({ id: String(10000000 + i), text: `post ${i}` }));
    many[0].text = "y".repeat(5000);
    const r = parseXCapture(wrap(many));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.capture.items).toHaveLength(X_MAX_ITEMS);
    expect(r.capture.items[0].text).toHaveLength(1000);
    expect(r.warnings.join(" ")).toMatch(/cap/);
  });

  it("keeps quoted content only when it has text, and errors when nothing usable remains", () => {
    const r = parseXCapture(wrap([
      { id: "55556666", text: "quoting", quoted: { author: "Q", handle: "@q", text: "the original" } },
      { id: "77778888", text: "empty quote", quoted: { author: "Q" } },
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.capture.items[0].quoted).toEqual({ author: "Q", handle: "q", text: "the original" });
    expect(r.capture.items[1].quoted).toBeUndefined();

    const empty = parseXCapture(wrap([{ id: "1", text: "" }]));
    expect(empty.ok).toBe(false);
  });
});

describe("parseMetric", () => {
  it("accepts numbers, comma strings, and K/M abbreviations", () => {
    expect(parseMetric(42)).toBe(42);
    expect(parseMetric("1,234")).toBe(1234);
    expect(parseMetric("1.2K")).toBe(1200);
    expect(parseMetric("3.4M")).toBe(3400000);
    expect(parseMetric("")).toBeUndefined();
    expect(parseMetric("a lot")).toBeUndefined();
    expect(parseMetric(-5)).toBeUndefined();
  });
});

describe("sanitizeXUrl", () => {
  it("keeps only https X/Twitter status permalinks, canonicalized to x.com", () => {
    expect(sanitizeXUrl("https://x.com/a/status/123456")).toBe("https://x.com/a/status/123456");
    expect(sanitizeXUrl("https://twitter.com/a/status/123456/")).toBe("https://x.com/a/status/123456");
    expect(sanitizeXUrl("https://x.com/a")).toBe("");                     // not a status link
    expect(sanitizeXUrl("https://evil.example/status/123456")).toBe("");  // wrong host
    expect(sanitizeXUrl("http://x.com/a/status/123456")).toBe("");        // not https
    expect(sanitizeXUrl("javascript:alert(1)")).toBe("");
  });
});
