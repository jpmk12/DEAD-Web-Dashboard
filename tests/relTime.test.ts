import { describe, it, expect } from "vitest";
import { relTime, relTimeFuture, updatedAgo, relDay, toMs } from "../lib/relTime";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0); // 2026-10-07T12:00:00Z
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

describe("relTime", () => {
  it("says just now inside a minute", () => {
    expect(relTime(NOW, NOW)).toBe("just now");
    expect(relTime(NOW - 59_000, NOW)).toBe("just now");
  });

  it("steps minutes → hours → days with NO space before the unit", () => {
    expect(relTime(NOW - 5 * MIN, NOW)).toBe("5m ago");
    expect(relTime(NOW - 59 * MIN, NOW)).toBe("59m ago");
    expect(relTime(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(relTime(NOW - 23 * HOUR - 59 * MIN, NOW)).toBe("23h ago");
    expect(relTime(NOW - 2 * DAY, NOW)).toBe("2d ago");
    expect(relTime(NOW - 40 * DAY, NOW)).toBe("40d ago");
  });

  it("floors, never rounds up — 3h59m is still 3h ago", () => {
    expect(relTime(NOW - 3 * HOUR - 59 * MIN, NOW)).toBe("3h ago");
  });

  it("accepts ms, ISO strings and Dates", () => {
    expect(relTime(new Date(NOW - 2 * HOUR), NOW)).toBe("2h ago");
    expect(relTime(new Date(NOW - 2 * HOUR).toISOString(), NOW)).toBe("2h ago");
  });

  it("renders nothing for input it cannot read", () => {
    expect(relTime("not a date", NOW)).toBe("");
    expect(relTime("", NOW)).toBe("");
    expect(relTime(null, NOW)).toBe("");
    expect(relTime(undefined, NOW)).toBe("");
    expect(Number.isNaN(toMs("nope"))).toBe(true);
  });

  it("treats a future instant as just now (it has not happened)", () => {
    expect(relTime(NOW + 3 * HOUR, NOW)).toBe("just now");
  });
});

describe("relTimeFuture", () => {
  it("reads ahead with the same units", () => {
    expect(relTimeFuture(NOW + 5 * MIN, NOW)).toBe("in 5m");
    expect(relTimeFuture(NOW + 3 * HOUR, NOW)).toBe("in 3h");
    expect(relTimeFuture(NOW + 2 * DAY, NOW)).toBe("in 2d");
  });

  it("falls back to relTime for the past and just now around the instant", () => {
    expect(relTimeFuture(NOW - 5 * MIN, NOW)).toBe("5m ago");
    expect(relTimeFuture(NOW + 30_000, NOW)).toBe("just now");
    expect(relTimeFuture(NOW - 30_000, NOW)).toBe("just now");
    expect(relTimeFuture("bad", NOW)).toBe("");
  });
});

describe("updatedAgo — the header stamp", () => {
  it("is relative inside the hour, then the local clock time", () => {
    expect(updatedAgo(NOW, NOW)).toBe("just now");
    expect(updatedAgo(NOW - 7 * MIN, NOW)).toBe("7m ago");
    const t = NOW - 2 * HOUR;
    expect(updatedAgo(t, NOW)).toBe(new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  });
});

describe("relDay", () => {
  it("compares calendar days, not 24-hour spans", () => {
    const todayNoon = new Date(NOW); todayNoon.setHours(12, 0, 0, 0);
    const base = todayNoon.getTime();
    expect(relDay(base - 2 * HOUR, base)).toBe("today");
    expect(relDay(base - 14 * HOUR, base)).toBe("yesterday"); // 22:00 the day before — under 24 h, still yesterday
    expect(relDay(base - 3 * DAY, base)).toBe("3d ago");
    expect(relDay(base + 2 * DAY, base)).toBe("in 2d");
  });

  it("reads a bare YYYY-MM-DD at local noon", () => {
    const d = new Date(NOW);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(relDay(ymd, NOW)).toBe("today");
    expect(relDay("garbage", NOW)).toBe("");
  });
});
