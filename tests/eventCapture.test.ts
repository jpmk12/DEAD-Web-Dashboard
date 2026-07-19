import { describe, it, expect } from "vitest";
import { parseEventsCapture } from "../lib/eventCapture";

const NOW = "2026-07-19T12:00:00.000Z";
const cap = (items: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({
  format: "dead-events", version: 1, capturedAt: NOW, source: { kind: "liveuamap", label: "iran" }, items, ...over,
});
const ev = (over: Record<string, unknown> = {}) => ({
  url: "https://iran.liveuamap.com/en/2026/19-july-explosion-at-haji-abad",
  title: "Explosion at Haji Abad missile site in Hormozgan province",
  time: "2026-07-19T03:33:00Z",
  sourceUrl: "https://twitter.com/x/status/123",
  ...over,
});

describe("parseEventsCapture", () => {
  it("parses a valid capture, keeps region label, and normalizes fields", () => {
    const r = parseEventsCapture(cap([ev()]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("iran");
    expect(r.events).toHaveLength(1);
    expect(r.events[0].publishedAt).toBe("2026-07-19T03:33:00.000Z");
    expect(r.events[0].sourceUrl).toContain("twitter.com");
    expect(r.events[0].id.startsWith("ev_")).toBe(true);
  });

  it("dedupes by url and drops items without a permalink or a real headline", () => {
    const r = parseEventsCapture(cap([
      ev(),
      ev(),                                   // dup url
      ev({ url: "not-a-url" }),               // no valid permalink
      ev({ url: "https://iran.liveuamap.com/en/2026/19-july-two", title: "short" }), // thin headline
    ]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(1);
    expect(r.skipped).toBe(3);
  });

  it("rejects wrong format, bad JSON, and empty item lists", () => {
    expect(parseEventsCapture("{").ok).toBe(false);
    expect(parseEventsCapture(JSON.stringify({ format: "dead-x-capture", items: [] })).ok).toBe(false);
    expect(parseEventsCapture(cap([])).ok).toBe(false);
  });

  it("tolerates a missing time (publishedAt → null, ingest falls back to capture time)", () => {
    const r = parseEventsCapture(cap([ev({ time: undefined, sourceUrl: undefined })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events[0].publishedAt).toBeNull();
    expect(r.events[0].sourceUrl).toBeNull();
  });
});
