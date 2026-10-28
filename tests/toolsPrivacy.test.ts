import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLatLon, PRIVATE_BLOCKS, TOOLS_PRIVATE_KEY } from "../lib/toolsPrivacy";

describe("parseLatLon — a typed position, never guessed", () => {
  it("reads a decimal pair and degrees-minutes with hemisphere letters", () => {
    expect(parseLatLon("31.826, 36.782")).toEqual({ lat: 31.826, lon: 36.782 });
    expect(parseLatLon("40.016 -74.592")).toEqual({ lat: 40.016, lon: -74.592 });
    expect(parseLatLon("31°49'N 36°47'E")).toEqual({ lat: 31.8167, lon: 36.7833 });
    expect(parseLatLon("N31 49.5 W074 35.5")).toEqual({ lat: 31.825, lon: -74.5917 });
    expect(parseLatLon("3149N 03647E")).toEqual({ lat: 31.8167, lon: 36.7833 });
    expect(parseLatLon("40 01 S 074 35 E")).toEqual({ lat: -40.0167, lon: 74.5833 });
  });
  it("refuses junk and out-of-range", () => {
    expect(parseLatLon("")).toBeNull();
    expect(parseLatLon("Amman")).toBeNull();
    expect(parseLatLon("91, 10")).toBeNull();
    expect(parseLatLon("10, 181")).toBeNull();
    expect(parseLatLon("31 75 N 036 47 E")).toBeNull();   // 75 minutes
  });
  it("the switch's own words name every block", () => {
    expect(PRIVATE_BLOCKS.join(" ")).toMatch(/no requests/);
    expect(PRIVATE_BLOCKS.join(" ")).toMatch(/nothing written/);
    expect(TOOLS_PRIVATE_KEY).toBe("tools.private");
  });
});

describe("the Tools tab has ONE network door and ONE storage door, both behind the private flag", () => {
  const src = readFileSync(join(__dirname, "..", "components", "tools", "ToolsTab.tsx"), "utf8");
  const count = (re: RegExp) => (src.match(re) ?? []).length;
  it("`fetch(` appears only inside toolsFetch, which refuses when private", () => {
    expect(count(/\bfetch\(/g)).toBe(1);
    expect(src).toMatch(/function toolsFetch[\s\S]*?if \(priv\)[\s\S]*?return null[\s\S]*?\bfetch\(/);
  });
  it("`localStorage.setItem(` appears only inside saveH, which returns when private", () => {
    expect(count(/localStorage\.setItem\(/g)).toBe(1);
    expect(src).toMatch(/function saveH[\s\S]*?if \(priv\) return[\s\S]*?localStorage\.setItem\(/);
  });
  it("no other transport is used from the tab", () => {
    for (const bad of [/\bXMLHttpRequest\b/, /navigator\.sendBeacon/, /new WebSocket/, /EventSource\(/, /indexedDB/, /document\.cookie/]) expect(src).not.toMatch(bad);
    // The zone hook fetches /api/zone; private mode must not mount it.
    expect(src).toMatch(/priv \? <PrivateTools/);
  });
});
