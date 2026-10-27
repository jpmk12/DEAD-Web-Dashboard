import { describe, it, expect } from "vitest";
import {
  isLeapYear, ymdToJulian, julianToYmd, parseJulianInput, daysBetween, isoWeek,
  zoneLetter, letterOffset, offsetTag, wallToMs, inZone, dtgZulu, parseDtg,
  DEFAULT_H_OFFSETS, hLabel, parseOffsetInput, hHourTable, hTableText, hCountdown,
} from "../lib/plannerTools";

describe("Julian (ordinal day) — the schedule's three digits, never the astronomical number", () => {
  it("converts both ways and knows leap years", () => {
    expect(ymdToJulian("2026-10-27")).toMatchObject({ year: 2026, jd: 300, label: "300", yyddd: "26300", weekday: "Tue", leap: false });
    expect(ymdToJulian("2026-01-01")?.jd).toBe(1);
    expect(ymdToJulian("2026-12-31")?.jd).toBe(365);
    expect(ymdToJulian("2028-12-31")?.jd).toBe(366);
    expect(ymdToJulian("2028-03-01")?.jd).toBe(61);
    expect(ymdToJulian("2027-03-01")?.jd).toBe(60);
    expect(julianToYmd(300, 2026)?.ymd).toBe("2026-10-27");
    expect(julianToYmd(366, 2028)?.ymd).toBe("2028-12-31");
    expect(julianToYmd(7, 2026)?.label).toBe("007");
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });
  it("refuses what is not a date: Feb 30, day 366 of a common year, day 0, junk", () => {
    expect(ymdToJulian("2026-02-30")).toBeNull();
    expect(ymdToJulian("27 Oct 2026")).toBeNull();
    expect(julianToYmd(366, 2026)).toBeNull();
    expect(julianToYmd(0, 2026)).toBeNull();
    expect(julianToYmd(1.5, 2026)).toBeNull();
  });
  it("reads a Julian the ways people type it", () => {
    expect(parseJulianInput("300", 2026)?.ymd).toBe("2026-10-27");
    expect(parseJulianInput("JD 300", 2026)?.ymd).toBe("2026-10-27");
    expect(parseJulianInput("26300", 2024)?.ymd).toBe("2026-10-27");
    expect(parseJulianInput("2026300", 2024)?.ymd).toBe("2026-10-27");
    expect(parseJulianInput("2026-300", 2024)?.ymd).toBe("2026-10-27");
    expect(parseJulianInput("300/2026", 2024)?.ymd).toBe("2026-10-27");
    expect(parseJulianInput("", 2026)).toBeNull();
    expect(parseJulianInput("400", 2026)).toBeNull();
    expect(parseJulianInput("oct", 2026)).toBeNull();
  });
  it("days between and ISO week", () => {
    expect(daysBetween("2026-10-27", "2026-11-01")).toBe(5);
    expect(daysBetween("2026-11-01", "2026-10-27")).toBe(-5);
    expect(daysBetween("2026-10-27", "x")).toBeNull();
    expect(isoWeek("2026-10-27")).toBe(44);
    expect(isoWeek("2027-01-01")).toBe(53);   // Friday 1 Jan 2027 belongs to 2026's week 53
    expect(isoWeek("2026-01-01")).toBe(1);
  });
});

describe("zones and the DTG", () => {
  it("zone letters: Z, A–M east skipping J, N–Y west, none for a half-hour zone", () => {
    expect(zoneLetter(0)).toBe("Z");
    expect(zoneLetter(60)).toBe("A");
    expect(zoneLetter(9 * 60)).toBe("I");
    expect(zoneLetter(10 * 60)).toBe("K");
    expect(zoneLetter(12 * 60)).toBe("M");
    expect(zoneLetter(-60)).toBe("N");
    expect(zoneLetter(-5 * 60)).toBe("R");
    expect(zoneLetter(-12 * 60)).toBe("Y");
    expect(zoneLetter(3 * 60 + 30)).toBeNull();
    expect(zoneLetter(13 * 60)).toBeNull();
    expect(letterOffset("R")).toBe(-300);
    expect(letterOffset("K")).toBe(600);
    expect(letterOffset("J")).toBeNull();
    expect(offsetTag(210)).toBe("+0330");
    expect(offsetTag(-300)).toBe("-0500");
  });
  it("inZone renders the wall clock and a DTG with the zone's letter", () => {
    const ms = Date.UTC(2026, 9, 27, 19, 30);
    expect(inZone(ms, "UTC")).toMatchObject({ ymd: "2026-10-27", hhmm: "19:30", weekday: "Tue", dayShort: "27 Oct", letter: "Z", dtg: "271930ZOCT26" });
    expect(inZone(ms, "America/New_York")).toMatchObject({ hhmm: "15:30", letter: "Q", dtg: "271530QOCT26", offsetMin: -240 });   // EDT
    expect(inZone(ms, "Asia/Tehran")).toMatchObject({ hhmm: "23:00", letter: null, dtg: "272300+0330OCT26" });
    expect(inZone(ms, "Asia/Tokyo")).toMatchObject({ ymd: "2026-10-28", hhmm: "04:30", letter: "I", dtg: "280430IOCT26" });
    expect(inZone(ms, "Not/AZone").zone).toBe("UTC");
    expect(dtgZulu(Date.UTC(2026, 0, 5, 0, 7))).toBe("050007ZJAN26");
  });
  it("wallToMs honours DST per instant and the fall-back hour resolves to the first instant", () => {
    expect(wallToMs("2026-10-27", "15:30", "America/New_York")).toBe(Date.UTC(2026, 9, 27, 19, 30));
    expect(wallToMs("2026-12-27", "15:30", "America/New_York")).toBe(Date.UTC(2026, 11, 27, 20, 30));   // EST
    expect(wallToMs("2026-10-27", "19:30", "UTC")).toBe(Date.UTC(2026, 9, 27, 19, 30));
    expect(wallToMs("2026-10-27", "1930", "UTC")).toBe(Date.UTC(2026, 9, 27, 19, 30));
    // 1 Nov 2026 01:30 happens twice in New York; the first (EDT) instant is 05:30Z.
    expect(wallToMs("2026-11-01", "01:30", "America/New_York")).toBe(Date.UTC(2026, 10, 1, 5, 30));
    expect(wallToMs("2026-10-27", "24:00", "UTC")).toBeNull();
    expect(wallToMs("2026-10-27", "19:30", "Nope/Zone")).toBeNull();
  });
  it("parseDtg reads the spellings in use and refuses J", () => {
    const ms = Date.UTC(2026, 9, 27, 19, 30);
    expect(parseDtg("271930ZOCT26")).toBe(ms);
    expect(parseDtg("271930Z OCT 26")).toBe(ms);
    expect(parseDtg("271930 oct 2026")).toBe(ms);
    expect(parseDtg("271530QOCT26")).toBe(ms);
    expect(parseDtg("272300+0330OCT26")).toBe(ms);
    expect(parseDtg("271930JOCT26")).toBeNull();
    expect(parseDtg("302400ZOCT26")).toBeNull();
    expect(parseDtg("311930ZSEP26")).toBeNull();
    expect(parseDtg("")).toBeNull();
    // round trip through every letter zone
    for (const L of "ABCDEFGHIKLMNOPQRSTUVWXYZ") {
      const off = letterOffset(L)!;
      const z = inZone(ms, off === 0 ? "UTC" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off / 60)}`);
      expect(parseDtg(z.dtg)).toBe(ms);
    }
  });
});

describe("H-hour", () => {
  const H = Date.UTC(2026, 9, 30, 6, 0);   // 300600ZOCT26
  it("labels and parses offsets", () => {
    expect(hLabel(0)).toBe("H");
    expect(hLabel(-72)).toBe("H-72");
    expect(hLabel(24)).toBe("H+24");
    expect(hLabel(0.5)).toBe("H+0:30");
    expect(hLabel(-1.25)).toBe("H-1:15");
    expect(parseOffsetInput("H-72")).toBe(-72);
    expect(parseOffsetInput("-72")).toBe(-72);
    expect(parseOffsetInput("+36")).toBe(36);
    expect(parseOffsetInput("36h")).toBe(36);
    expect(parseOffsetInput("H+2d")).toBe(48);
    expect(parseOffsetInput("H-1:30")).toBe(-1.5);
    expect(parseOffsetInput("H+90m")).toBe(1.5);
    expect(parseOffsetInput("H")).toBeNull();
    expect(parseOffsetInput("soon")).toBeNull();
    expect(parseOffsetInput("H-1:30d")).toBeNull();
  });
  it("the table is ascending, deduplicated, and every row carries its Zulu DTG", () => {
    const rows = hHourTable(H, [24, -72, 0, -72, 0.5]);
    expect(rows.map((r) => r.label)).toEqual(["H-72", "H", "H+0:30", "H+24"]);
    expect(rows[0].dtg).toBe("270600ZOCT26");
    expect(rows[1].dtg).toBe("300600ZOCT26");
    expect(rows[3].dtg).toBe("310600ZOCT26");
    expect(DEFAULT_H_OFFSETS).toContain(-72);
    expect(DEFAULT_H_OFFSETS).toContain(-48);
    expect(DEFAULT_H_OFFSETS).toContain(0);
  });
  it("the clipboard text names the anchor and pads the columns", () => {
    const text = hTableText(H, [-72, 0], [{ zone: "UTC", label: "Zulu" }, { zone: "America/New_York", label: "NJ" }, { zone: "Asia/Tehran", label: "Tehran" }]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("H-hour: 300600ZOCT26");
    expect(lines[1]).toMatch(/^Offset\s+Zulu DTG\s+Zulu\s+NJ\s+Tehran$/);
    expect(lines[2]).toMatch(/^H-72\s+270600ZOCT26\s+Tue 27 Oct 06:00\s+Tue 27 Oct 02:00Q\s+Tue 27 Oct 09:30\+0330$/);
    expect(lines[3]).toMatch(/^H\s+300600ZOCT26/);
  });
  it("countdown is signed and switches to days past 48 h", () => {
    expect(hCountdown(H, H - 2 * 3_600_000)).toEqual({ hours: 2, text: "H in 2.0 h" });
    expect(hCountdown(H, H + 3 * 86_400_000).text).toBe("H was 3.0 d ago");
  });
});
