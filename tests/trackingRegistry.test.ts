import { describe, it, expect } from "vitest";
import { normalizeCountryName, sameCountry, titleCaseCountry } from "@/lib/countryNames";
import { buildRegistry, planTrack, planRestore, describeExclusions, CAPS, type TrackingPrefs } from "@/lib/trackingRegistry";
import { planApply } from "@/lib/missionApplyPlan";
import { deriveTracking, EMPTY_PROFILE, SITREP_MAX, type MissionProfile } from "@/lib/missionProfile";

const PROFILE: MissionProfile = {
  ...EMPTY_PROFILE,
  homeIcao: "KWRI",
  home: { icao: "KWRI", label: "JB McGuire-Dix-Lakehurst", lat: 40.0156, lon: -74.5917, country: "United States" },
  spokes: [{ icao: "KCHS", label: "JB Charleston, SC", lat: 32.8986, lon: -80.0405, country: "United States" }],
  theaters: ["CENTCOM"],
  aois: [{
    id: "iran-hormuz", name: "Iran & Hormuz", aor: "CENTCOM",
    countries: ["Iran", "Qatar", "Jordan"], intensity: "primary", iw: true, chokepointIds: ["hormuz"],
  }],
  mustTrack: { aors: [], countries: ["Jordan"], icaos: [] },
};

const EMPTY_PREFS: TrackingPrefs = { forceLocations: [], countriesOfInterest: [], metarStations: [], sitrepBases: [], trackedLocations: [], watchlist: [] };

const AMMAN = { kind: "airfield" as const, icao: "OJAQ", label: "King Abdullah II AB", lat: 32.3433, lon: 36.1414, country: "JO" };

function applied(): TrackingPrefs {
  // What the lists look like after one Apply with the hub + one AOI base picked.
  return planApply(EMPTY_PREFS, PROFILE, ["KWRI", "OTBH"]).next;
}

describe("countryNames", () => {
  it("expands ISO2, maps aliases, title-cases free text, keeps blanks blank", () => {
    expect(normalizeCountryName("JO")).toBe("Jordan");
    expect(normalizeCountryName("us")).toBe("United States");
    expect(normalizeCountryName("Türkiye")).toBe("Turkey");
    expect(normalizeCountryName("iran, islamic rep.")).toBe("Iran");
    expect(normalizeCountryName("saudi arabia")).toBe("Saudi Arabia");
    expect(normalizeCountryName("democratic republic of the congo")).toBe("Democratic Republic of the Congo");
    expect(normalizeCountryName("")).toBe("");
    expect(normalizeCountryName(null)).toBe("");
  });
  it("sameCountry joins the four spellings; blanks never match", () => {
    expect(sameCountry("JO", "jordan")).toBe(true);
    expect(sameCountry("Russian Federation", "Russia")).toBe(true);
    expect(sameCountry("", "")).toBe(false);
    expect(sameCountry("Niger", "Nigeria")).toBe(false);
  });
  it("titleCaseCountry keeps small words lower and handles hyphens", () => {
    expect(titleCaseCountry("timor-leste")).toBe("Timor-Leste");
    expect(titleCaseCountry("bosnia and herzegovina")).toBe("Bosnia and Herzegovina");
  });
});

describe("buildRegistry", () => {
  it("folds the four lists into one record per airfield with roles, own-force role and AUTO", () => {
    const prefs = applied();
    const reg = buildRegistry(prefs, PROFILE);
    const hub = reg.airfields.find((a) => a.icao === "KWRI")!;
    expect(hub.own).toBe("hub");
    expect(hub.roles).toEqual({ posture: true, metar: true, sitrep: true, star: false });
    expect(hub.auto).toBe(true);
    const otbh = reg.airfields.find((a) => a.icao === "OTBH")!;
    expect(otbh.roles.sitrep).toBe(true);
    expect(hub.country).toBe("United States");
    // hub first, spoke second, then the rest.
    expect(reg.airfields[0].icao).toBe("KWRI");
    expect(reg.airfields[1].icao).toBe("KCHS");
  });

  it("countries carry posture + ★, a ★-only country is present but unwatched, AOI named", () => {
    const prefs = applied();
    const reg = buildRegistry({ ...prefs, countriesOfInterest: prefs.countriesOfInterest.filter((c) => c.country !== "Jordan") }, PROFILE);
    const jordan = reg.countries.find((c) => c.country === "Jordan")!;
    expect(jordan.roles).toEqual({ posture: false, star: true });
    const iran = reg.countries.find((c) => c.country === "Iran")!;
    expect(iran.roles.posture).toBe(true);
    expect(iran.aoi).toBe("Iran & Hormuz");
    expect(iran.auto).toBe(true);
    // ★ sorts first.
    expect(reg.countries[0].country).toBe("Jordan");
  });

  it("normalises an ISO2 posture row so it joins its country", () => {
    const prefs: TrackingPrefs = { ...EMPTY_PREFS, forceLocations: [{ id: "x", label: "Amman", icao: "OJAQ", lat: 32.3, lon: 36.1, country: "JO", cocom: "CENTCOM" }] };
    const reg = buildRegistry(prefs, PROFILE);
    expect(reg.airfields.find((a) => a.icao === "OJAQ")?.country).toBe("Jordan");
  });

  it("summary and counts read in operator language; exclusions get labels", () => {
    const prefs = applied();
    const profile = { ...PROFILE, excludedIds: ["mp-c-iran", "mp-b-OTBH", "mp-m-OTBH", "mp-t-strait-of-hormuz", "mp-iran-hormuz", "mp-zzz"] };
    const reg = buildRegistry(prefs, profile);
    expect(reg.summary).toMatch(/\d+ countries \(1 ★\) · \d+ airfields \(2 SITREP\) · 6 excluded/);
    const ex = describeExclusions(profile);
    expect(ex.map((e) => e.kind)).toEqual(["country", "base", "metar", "term", "board", "other"]);
    expect(ex[0].label).toBe("Iran");
    expect(ex[1].label).toMatch(/OTBH/);
    expect(ex[3].label).toContain("Strait of Hormuz");
    expect(ex[4].label).toContain("Iran & Hormuz");
  });
});

describe("planTrack — airfield", () => {
  it("adds posture + METAR + SITREP with tr- ids and a normalised country; undo reverses exactly", () => {
    const plan = planTrack(EMPTY_PREFS, PROFILE, { ...AMMAN, roles: { posture: true, metar: true, sitrep: true } });
    expect(plan.prefs.forceLocations).toHaveLength(1);
    expect(plan.prefs.forceLocations[0]).toMatchObject({ id: "tr-b-OJAQ", icao: "OJAQ", country: "Jordan", cocom: "CENTCOM", kind: "base" });
    expect(plan.prefs.metarStations).toEqual([{ icao: "OJAQ", label: "King Abdullah II AB" }]);
    expect(plan.prefs.sitrepBases[0]).toMatchObject({ icao: "OJAQ", country: "Jordan", place: "King Abdullah II AB" });
    expect(plan.changes).toHaveLength(3);
    expect(plan.warnings).toEqual([]);
    expect(plan.undo).toMatchObject({ kind: "airfield", icao: "OJAQ", roles: { posture: false, metar: false, sitrep: false } });
    const back = planTrack(plan.prefs, plan.profile, plan.undo!);
    expect(back.prefs.forceLocations).toEqual([]);
    expect(back.prefs.metarStations).toEqual([]);
    expect(back.prefs.sitrepBases).toEqual([]);
  });

  it("is idempotent: tracking an already-tracked role changes nothing and has no undo", () => {
    const once = planTrack(EMPTY_PREFS, PROFILE, { ...AMMAN, roles: { posture: true } });
    const twice = planTrack(once.prefs, once.profile, { ...AMMAN, roles: { posture: true } });
    expect(twice.changes).toEqual([]);
    expect(twice.undo).toBeNull();
    expect(twice.prefs.forceLocations).toHaveLength(1);
  });

  it("removing an AUTO posture row records the mp- exclusion; tracking it again lifts it", () => {
    const prefs = applied();
    const gone = planTrack(prefs, PROFILE, { kind: "airfield", icao: "OTBH", label: "Al Udeid AB", lat: 25.1, lon: 51.3, country: "Qatar", roles: { posture: false } });
    expect(gone.prefs.forceLocations.some((f) => f.icao === "OTBH")).toBe(false);
    expect(gone.profile.excludedIds).toContain("mp-b-OTBH");
    expect(gone.changes[0]).toMatch(/AUTO row/);
    const back = planTrack(gone.prefs, gone.profile, { kind: "airfield", icao: "OTBH", label: "Al Udeid AB", lat: 25.1, lon: 51.3, country: "Qatar", roles: { posture: true } });
    expect(back.profile.excludedIds).not.toContain("mp-b-OTBH");
    expect(back.prefs.forceLocations.find((f) => f.icao === "OTBH")?.id).toBe("tr-b-OTBH");
    expect(back.changes[0]).toMatch(/exclusion lifted/);
  });

  it("removing a derived METAR station records mp-m- so Apply will not re-add it", () => {
    const prefs = applied();
    expect(prefs.metarStations.some((m) => m.icao === "OTBH")).toBe(true);
    const gone = planTrack(prefs, PROFILE, { kind: "airfield", icao: "OTBH", label: "Al Udeid AB", lat: 25.1, lon: 51.3, country: "Qatar", roles: { metar: false } });
    expect(gone.profile.excludedIds).toContain("mp-m-OTBH");
    expect(planApply(gone.prefs, gone.profile, []).next.metarStations.some((m) => m.icao === "OTBH")).toBe(false);
  });

  it("a full list is a warning, never a silent drop", () => {
    const full: TrackingPrefs = { ...EMPTY_PREFS, sitrepBases: Array.from({ length: SITREP_MAX }, (_, i) => ({ icao: `K00${i}`, label: `F${i}`, lat: 0, lon: 0, country: "", place: "" })) };
    const plan = planTrack(full, PROFILE, { ...AMMAN, roles: { sitrep: true } });
    expect(plan.prefs.sitrepBases).toHaveLength(SITREP_MAX);
    expect(plan.warnings[0]).toMatch(/SITREP slots are full/);
    expect(plan.undo).toBeNull();
    const fullMetar: TrackingPrefs = { ...EMPTY_PREFS, metarStations: Array.from({ length: CAPS.metar }, (_, i) => ({ icao: `K0${String(i).padStart(2, "0")}`, label: "x" })) };
    expect(planTrack(fullMetar, PROFILE, { ...AMMAN, roles: { metar: true } }).warnings[0]).toMatch(/METAR stations are full/);
  });

  it("★ takes a SITREP slot (hub first), names what it displaced, and undo releases both", () => {
    const prefs = applied();
    const extra: TrackingPrefs = { ...prefs, sitrepBases: [...prefs.sitrepBases, ...Array.from({ length: SITREP_MAX - prefs.sitrepBases.length }, (_, i) => ({ icao: `K10${i}`, label: `F${i}`, lat: 0, lon: 0, country: "", place: "" }))] };
    expect(extra.sitrepBases).toHaveLength(SITREP_MAX);
    const plan = planTrack(extra, PROFILE, { ...AMMAN, roles: { star: true } });
    expect(plan.profile.mustTrack.icaos).toEqual(["OJAQ"]);
    expect(plan.prefs.sitrepBases[0].icao).toBe("KWRI");
    expect(plan.prefs.sitrepBases[1].icao).toBe("OJAQ");
    expect(plan.prefs.sitrepBases).toHaveLength(SITREP_MAX);
    expect(plan.warnings[0]).toMatch(/K10\d dropped from SITREP/);
    expect(plan.undo).toMatchObject({ roles: { star: false, sitrep: false } });
    const back = planTrack(plan.prefs, plan.profile, plan.undo!);
    expect(back.profile.mustTrack.icaos).toEqual([]);
    expect(back.prefs.sitrepBases.some((b) => b.icao === "OJAQ")).toBe(false);
  });

  it("rejects a malformed ICAO", () => {
    const plan = planTrack(EMPTY_PREFS, PROFILE, { ...AMMAN, icao: "OJ", roles: { posture: true } });
    expect(plan.warnings[0]).toMatch(/ICAO/);
    expect(plan.prefs).toEqual(EMPTY_PREFS);
  });
});

describe("planTrack — country and place", () => {
  it("adds a posture country under a tr-c id with its COCOM; removing an AUTO one excludes it", () => {
    const add = planTrack(EMPTY_PREFS, PROFILE, { kind: "country", country: "JO", roles: { posture: true } });
    expect(add.prefs.countriesOfInterest[0]).toMatchObject({ id: "tr-c-jordan", country: "Jordan", cocom: "CENTCOM" });
    expect(add.undo).toEqual({ kind: "country", country: "Jordan", roles: { posture: false } });
    const prefs = applied();
    const gone = planTrack(prefs, PROFILE, { kind: "country", country: "iran", roles: { posture: false } });
    expect(gone.prefs.countriesOfInterest.some((c) => c.country === "Iran")).toBe(false);
    expect(gone.profile.excludedIds).toContain("mp-c-iran");
  });

  it("★ on a country not in the posture watch warns that posture stays UNKNOWN", () => {
    const plan = planTrack(EMPTY_PREFS, PROFILE, { kind: "country", country: "Oman", roles: { star: true } });
    expect(plan.profile.mustTrack.countries).toContain("Oman");
    expect(plan.warnings[0]).toMatch(/UNKNOWN/);
    const both = planTrack(EMPTY_PREFS, PROFILE, { kind: "country", country: "Oman", roles: { star: true, posture: true } });
    expect(both.warnings).toEqual([]);
  });

  it("places: add, duplicate guard (label or ~1 km), cap, remove + undo", () => {
    const add = planTrack(EMPTY_PREFS, PROFILE, { kind: "place", label: "Amman", lat: 31.95, lon: 35.93 });
    expect(add.prefs.trackedLocations[0]).toMatchObject({ id: "tr-w-amman", label: "Amman" });
    const dup = planTrack(add.prefs, PROFILE, { kind: "place", label: "Amman city", lat: 31.951, lon: 35.931 });
    expect(dup.warnings[0]).toMatch(/already/);
    const back = planTrack(add.prefs, add.profile, add.undo!);
    expect(back.prefs.trackedLocations).toEqual([]);
    const full: TrackingPrefs = { ...EMPTY_PREFS, trackedLocations: Array.from({ length: CAPS.places }, (_, i) => ({ id: `p${i}`, label: `P${i}`, lat: i, lon: i })) };
    expect(planTrack(full, PROFILE, { kind: "place", label: "New", lat: 50, lon: 50 }).warnings[0]).toMatch(/full/);
  });
});

describe("planRestore", () => {
  it("lifts the exclusion and puts the row back now", () => {
    const prefs = applied();
    const gone = planTrack(prefs, PROFILE, { kind: "country", country: "Iran", roles: { posture: false } });
    const back = planRestore(gone.prefs, gone.profile, "mp-c-iran");
    expect(back.profile.excludedIds).not.toContain("mp-c-iran");
    expect(back.prefs.countriesOfInterest.find((c) => c.id === "mp-c-iran")?.country).toBe("Iran");
    expect(back.changes[0]).toMatch(/restored/);
  });
  it("restoring a watchlist seed re-adds the term; an unknown id is a warning", () => {
    const p = { ...PROFILE, excludedIds: ["mp-t-strait-of-hormuz"] };
    const back = planRestore(EMPTY_PREFS, p, "mp-t-strait-of-hormuz");
    expect(back.prefs.watchlist).toEqual(["Strait of Hormuz"]);
    expect(planRestore(EMPTY_PREFS, PROFILE, "mp-c-nowhere").warnings[0]).toMatch(/not excluded/);
  });
});

describe("planApply", () => {
  it("materializedIds is exactly what was written — a manual row holding the key is not recorded as materialized", () => {
    const manual: TrackingPrefs = { ...EMPTY_PREFS, forceLocations: [{ id: "my-otbh", label: "Al Udeid", icao: "OTBH", lat: 25.1, lon: 51.3, country: "Qatar", cocom: "CENTCOM" }] };
    const plan = planApply(manual, PROFILE, []);
    expect(plan.next.forceLocations.filter((f) => f.icao === "OTBH")).toHaveLength(1);
    expect(plan.next.forceLocations.find((f) => f.icao === "OTBH")?.id).toBe("my-otbh");
    expect(plan.profile.materializedIds).not.toContain("mp-b-OTBH");
    expect(plan.profile.materializedIds).toContain("mp-b-KWRI");
    // The second apply therefore does NOT drift-exclude OTBH.
    const again = planApply(plan.next, plan.profile, []);
    expect(again.profile.excludedIds).not.toContain("mp-b-OTBH");
    expect(again.diff.empty).toBe(true);
  });

  it("drift: a derived row deleted since the last apply becomes an exclusion and is reported", () => {
    const first = planApply(EMPTY_PREFS, PROFILE, ["KWRI"]);
    const edited = { ...first.next, countriesOfInterest: first.next.countriesOfInterest.filter((c) => c.id !== "mp-c-qatar") };
    const second = planApply(edited, first.profile, []);
    expect(second.diff.drifted).toEqual(["mp-c-qatar"]);
    expect(second.profile.excludedIds).toContain("mp-c-qatar");
    expect(second.next.countriesOfInterest.some((c) => c.country === "Qatar")).toBe(false);
  });

  it("the diff names adds, drops, METAR and SITREP changes; a no-op apply is empty", () => {
    const first = planApply(EMPTY_PREFS, PROFILE, ["KWRI", "OTBH"]);
    expect(first.diff.countriesAdd).toEqual(["Iran", "Qatar", "Jordan"]);
    expect(first.diff.basesAdd[0]).toMatch(/KWRI/);
    expect(first.diff.metarAdd).toContain("KWRI");
    expect(first.diff.watchlistAdd).toEqual(["Strait of Hormuz"]);
    expect(first.diff.sitrep).toEqual({ from: [], to: ["KWRI", "OTBH"] });
    expect(first.diff.empty).toBe(false);
    expect(first.counts.sitrepBases).toBe(2);
    const noop = planApply(first.next, first.profile, []);
    expect(noop.diff.empty).toBe(true);
    expect(noop.diff.sitrep.from).toEqual(noop.diff.sitrep.to);
    // Removing the AOI drops its rows and says so.
    const shrunk = planApply(first.next, { ...first.profile, aois: [] }, []);
    expect(shrunk.diff.countriesDrop).toEqual(["Iran", "Qatar", "Jordan"]);
    expect(shrunk.diff.basesDrop.some((b) => /OTBH/.test(b))).toBe(true);
    expect(deriveTracking({ ...first.profile, aois: [] }).countries).toEqual([]);
  });

  it("manual rows and legacy mp-w- weather points are handled: manual kept, mp-w purged", () => {
    const prefs: TrackingPrefs = { ...EMPTY_PREFS, trackedLocations: [{ id: "mp-w-KWRI", label: "x", lat: 1, lon: 1 }, { id: "home", label: "Home", lat: 2, lon: 2 }] };
    const plan = planApply(prefs, PROFILE, []);
    expect(plan.next.trackedLocations.map((t) => t.id)).toEqual(["home"]);
  });
});
