import { describe, it, expect } from "vitest";
import {
  sanitizeMissionProfile, deriveTracking, suggestChokepoints, derivedIds,
  isDerivedId, slugify, EMPTY_PROFILE, SITREP_MAX,
  type MissionProfile,
} from "@/lib/missionProfile";

const IRAN_HORMUZ: MissionProfile = {
  homeIcao: "KWRI",
  theaters: ["CENTCOM"],
  aois: [{
    id: "iran-hormuz", name: "Iran & Hormuz", aor: "CENTCOM",
    countries: ["Iran", "Iraq", "Kuwait", "Bahrain", "Qatar", "Saudi Arabia"],
    intensity: "primary", iw: true, chokepointIds: ["hormuz"],
  }],
  excludedIds: [], materializedIds: [],
};

describe("sanitizeMissionProfile", () => {
  it("returns an empty profile for junk", () => {
    expect(sanitizeMissionProfile(null)).toEqual(EMPTY_PROFILE);
    expect(sanitizeMissionProfile("x")).toEqual(EMPTY_PROFILE);
    expect(sanitizeMissionProfile([1, 2])).toEqual(EMPTY_PROFILE);
  });

  it("keeps valid AOIs, drops nameless ones, and validates theaters + chokepoints", () => {
    const p = sanitizeMissionProfile({
      homeIcao: "kwri",
      theaters: ["CENTCOM", "MORDOR", "EUCOM"],
      aois: [
        { name: "Iran & Hormuz", aor: "CENTCOM", countries: ["Iran"], chokepointIds: ["hormuz", "atlantis"] },
        { aor: "EUCOM", countries: ["Poland"] }, // no name → dropped
      ],
    });
    expect(p.homeIcao).toBe("KWRI");
    expect(p.theaters).toEqual(["CENTCOM", "EUCOM"]);
    expect(p.aois).toHaveLength(1);
    expect(p.aois[0].id).toBe("iran-and-hormuz");
    expect(p.aois[0].chokepointIds).toEqual(["hormuz"]);
    expect(p.aois[0].intensity).toBe("primary");
    expect(p.aois[0].iw).toBe(true);
  });

  it("dedupes colliding AOI ids", () => {
    const p = sanitizeMissionProfile({
      aois: [
        { name: "Red Sea", aor: "CENTCOM", countries: [] },
        { name: "Red Sea", aor: "AFRICOM", countries: [] },
      ],
    });
    expect(p.aois.map((a) => a.id)).toEqual(["red-sea", "red-sea-2"]);
  });
});

describe("deriveTracking", () => {
  it("derives countries with mp- ids and correct COCOM", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    const iran = d.countries.find((c) => c.country === "Iran");
    expect(iran).toBeDefined();
    expect(iran!.id).toBe("mp-c-iran");
    expect(iran!.cocom).toBe("CENTCOM");
    expect(d.countries.every((c) => isDerivedId(c.id))).toBe(true);
  });

  it("derives in-theater bases, AMC hubs first", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    expect(d.bases.length).toBeGreaterThan(0);
    // Al Udeid (Qatar, curated CENTCOM hub) must be in the set for a Gulf AOI.
    expect(d.bases.some((b) => b.icao === "OTBH")).toBe(true);
    // Hubs outrank gateways in the ranking.
    expect(d.bases[0].id.startsWith("mp-b-")).toBe(true);
    expect(d.bases.every((b) => b.cocom === "CENTCOM")).toBe(true);
  });

  it("weather points and METAR stations follow the bases", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    expect(d.weatherPoints.length).toBeGreaterThan(0);
    expect(d.weatherPoints.every((w) => w.id.startsWith("mp-w-"))).toBe(true);
    expect(d.metarStations.map((m) => m.icao)).toContain("OTBH");
  });

  it("SITREP candidates lead with home and stay near the cap", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    expect(d.sitrepCandidates[0]?.icao).toBe("KWRI");
    expect(d.sitrepCandidates.length).toBeLessThanOrEqual(SITREP_MAX + 2);
  });

  it("primary+iw AOIs yield a warning problem; watch AOIs do not", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    expect(d.warningProblems).toHaveLength(1);
    expect(d.warningProblems[0]).toMatchObject({ id: "mp-iran-hormuz", aor: "CENTCOM", chokepointId: "hormuz" });

    const watchOnly = sanitizeMissionProfile({
      aois: [{ name: "Eastern Flank", aor: "EUCOM", countries: ["Poland"], intensity: "watch" }],
    });
    expect(deriveTracking(watchOnly).warningProblems).toHaveLength(0);
  });

  it("honors exclusions everywhere", () => {
    const d = deriveTracking({ ...IRAN_HORMUZ, excludedIds: ["mp-c-iran", "mp-b-OTBH", "mp-w-OTBH"] });
    expect(d.countries.some((c) => c.id === "mp-c-iran")).toBe(false);
    expect(d.bases.some((b) => b.icao === "OTBH")).toBe(false);
    expect(d.weatherPoints.some((w) => w.id === "mp-w-OTBH")).toBe(false);
  });

  it("watchlist seeds carry the AOI name and chokepoint, deduped", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    expect(d.watchlistSeeds).toContain("Iran & Hormuz");
    expect(d.watchlistSeeds).toContain("Strait of Hormuz");
    expect(new Set(d.watchlistSeeds).size).toBe(d.watchlistSeeds.length);
  });

  it("dedupes countries and bases across overlapping AOIs", () => {
    const p = sanitizeMissionProfile({
      aois: [
        { name: "Iran & Hormuz", aor: "CENTCOM", countries: ["Iran", "Qatar"] },
        { name: "Gulf South", aor: "CENTCOM", countries: ["Qatar", "Oman"] },
      ],
    });
    const d = deriveTracking(p);
    expect(d.countries.filter((c) => c.country === "Qatar")).toHaveLength(1);
    const icaos = d.bases.map((b) => b.icao);
    expect(new Set(icaos).size).toBe(icaos.length);
  });

  it("derivedIds covers countries, bases, and weather points", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    const ids = derivedIds(d);
    expect(ids.length).toBe(d.countries.length + d.bases.length + d.weatherPoints.length);
    expect(ids.every(isDerivedId)).toBe(true);
  });
});

describe("suggestChokepoints", () => {
  it("suggests Hormuz for Gulf countries, nearest first", () => {
    const s = suggestChokepoints(["Iran", "Qatar"]);
    expect(s[0]?.id).toBe("hormuz");
  });
  it("returns nothing for unknown countries", () => {
    expect(suggestChokepoints(["Atlantis"])).toEqual([]);
  });
});

describe("slugify", () => {
  it("normalizes names to stable slugs", () => {
    expect(slugify("Iran & Hormuz")).toBe("iran-and-hormuz");
    expect(slugify("  Red Sea / Bab-el-Mandeb  ")).toBe("red-sea-bab-el-mandeb");
    expect(slugify("!!!")).toBe("aoi");
  });
});
