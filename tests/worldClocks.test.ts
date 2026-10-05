import { describe, it, expect } from "vitest";
import { renderClock, renderClocks, DEFAULT_CLOCKS, utcOffsetMinutes, formatUtcOffset, phaseForHour } from "../lib/worldClocks";

// 2026-09-28 02:30Z — Monday in Zulu; still Sunday evening in New Jersey (EDT, UTC−4).
const NOW = Date.UTC(2026, 8, 28, 2, 30);

describe("renderClock — one instant, many zones", () => {
  it("renders the local time, weekday and offset for each zone", () => {
    const nj = renderClock(NOW, { label: "New Jersey", tz: "America/New_York" }, "UTC");
    expect(nj.time).toBe("22:30");
    expect(nj.weekday).toBe("Sun");
    expect(nj.utcOffset).toBe("UTC−4");
    expect(nj.isNight).toBe(true);

    const teh = renderClock(NOW, { label: "Tehran", tz: "Asia/Tehran" }, "UTC");
    expect(teh.time).toBe("06:00");
    expect(teh.utcOffset).toBe("UTC+3:30");
    expect(teh.isNight).toBe(false);
    expect(teh.phase).toBe("dawn");
    expect(nj.phase).toBe("night");

    const z = renderClock(NOW, { label: "Zulu", tz: "UTC" }, "UTC");
    expect(z.time).toBe("02:30");
    expect(z.utcOffset).toBe("UTC");
  });

  it("reports the calendar-day offset relative to the device zone", () => {
    // Device in New Jersey (Sunday): Beijing is already Monday.
    const bj = renderClock(NOW, { label: "Beijing", tz: "Asia/Shanghai" }, "America/New_York");
    expect(bj.weekday).toBe("Mon");
    expect(bj.dayOffset).toBe(1);
    // Device in Beijing (Monday): New Jersey is still Sunday.
    const nj = renderClock(NOW, { label: "New Jersey", tz: "America/New_York" }, "Asia/Shanghai");
    expect(nj.dayOffset).toBe(-1);
    expect(renderClock(NOW, { label: "Zulu", tz: "UTC" }, "UTC").dayOffset).toBe(0);
  });

  it("marks an unknown zone invalid rather than throwing or guessing", () => {
    const bad = renderClock(NOW, { label: "Nowhere", tz: "Mars/Olympus" }, "UTC");
    expect(bad.valid).toBe(false);
    expect(bad.time).toBe("--:--");
  });

  it("renders Zulu first, then the rest west→east by current UTC offset", () => {
    const rows = renderClocks(NOW, DEFAULT_CLOCKS, "UTC");
    expect(rows.map((r) => r.label)).toEqual(["Zulu", "New Jersey", "Moscow", "Amman", "Tehran", "Beijing"]);
    expect(rows.every((r) => r.valid)).toBe(true);
  });

  it("Zulu stays far left even when a zone lies west of it, under any UTC spelling", () => {
    const rows = renderClocks(NOW, [
      { label: "Honolulu", tz: "Pacific/Honolulu" },
      { label: "Zulu", tz: "Etc/UTC" },
      { label: "New Jersey", tz: "America/New_York" },
    ], "UTC");
    expect(rows.map((r) => r.label)).toEqual(["Zulu", "Honolulu", "New Jersey"]);
  });

  it("sorts by offset regardless of declared order, ties by declared order, invalid last", () => {
    const rows = renderClocks(NOW, [
      { label: "Beijing", tz: "Asia/Shanghai" },
      { label: "Nowhere", tz: "Mars/Olympus" },
      { label: "Moscow", tz: "Europe/Moscow" },
      { label: "Amman", tz: "Asia/Amman" },
      { label: "Zulu", tz: "UTC" },
    ], "UTC");
    expect(rows.map((r) => r.label)).toEqual(["Zulu", "Moscow", "Amman", "Beijing", "Nowhere"]);
  });
});

describe("phaseForHour", () => {
  it("bands the local hour into night / dawn / day / dusk", () => {
    expect([0, 4, 20, 23].map(phaseForHour)).toEqual(["night", "night", "night", "night"]);
    expect([5, 6].map(phaseForHour)).toEqual(["dawn", "dawn"]);
    expect([7, 12, 17].map(phaseForHour)).toEqual(["day", "day", "day"]);
    expect([18, 19].map(phaseForHour)).toEqual(["dusk", "dusk"]);
  });
});

describe("utcOffset helpers", () => {
  it("computes half-hour offsets and formats them", () => {
    expect(utcOffsetMinutes(new Date(NOW), "Asia/Tehran")).toBe(210);
    expect(utcOffsetMinutes(new Date(NOW), "Europe/Moscow")).toBe(180);
    expect(formatUtcOffset(-240)).toBe("UTC−4");
    expect(formatUtcOffset(345)).toBe("UTC+5:45");
    expect(formatUtcOffset(0)).toBe("UTC");
  });
});
