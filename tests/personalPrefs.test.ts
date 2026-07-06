import { describe, it, expect } from "vitest";
import { PERSONAL_PREF_KEYS, pickPersonal } from "../lib/userPrefs";
import type { UserPrefs } from "../lib/types";

describe("personal/team pref split", () => {
  it("keeps team config OUT of the personal set", () => {
    const teamKeys = ["osintFeeds", "forceLocations", "countriesOfInterest", "sitrepBases",
      "trackedLocations", "marketsWatchlist", "metarStations", "aiEnabled", "aiFeatureToggles"];
    for (const k of teamKeys) expect(PERSONAL_PREF_KEYS as readonly string[]).not.toContain(k);
  });

  it("covers the approved personal fields", () => {
    for (const k of ["watchlist", "theme", "timezone", "timezoneMode", "role", "vipSenders", "muteSenders", "localLat", "newsletterSources", "disabledNewsSources"]) {
      expect(PERSONAL_PREF_KEYS as readonly string[]).toContain(k);
    }
  });

  it("pickPersonal drops team fields and undefined values", () => {
    const src = {
      watchlist: ["hormuz"],
      theme: "amber",
      osintFeeds: [{ id: "x", label: "x", url: "https://x", kind: "news" }],
      sitrepBases: [{ icao: "KWRI", label: "x", lat: 0, lon: 0, country: "US", place: "" }],
      role: undefined,
    } as unknown as Partial<UserPrefs>;
    const out = pickPersonal(src);
    expect(out).toEqual({ watchlist: ["hormuz"], theme: "amber" });
  });
});
