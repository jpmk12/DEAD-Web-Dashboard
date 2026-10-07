import { describe, it, expect } from "vitest";
import {
  sanitizeMissionProfile, sanitizeEconomyEdits, deriveTracking, suggestChokepoints, suggestAoiCountries,
  missionSummaryLine, derivedIds, isDerivedId, slugify, EMPTY_PROFILE, SITREP_MAX,
  type MissionProfile,
} from "@/lib/missionProfile";

describe("sanitizeEconomyEdits — the Economy actor-register overlay", () => {
  it("keeps deduped trimmed names, drops junk, absent stays absent on the profile", () => {
    expect(sanitizeEconomyEdits(null)).toEqual({ exclude: [], add: [] });
    expect(sanitizeEconomyEdits({ exclude: [" Jordan ", "jordan", 3, ""], add: ["Venezuela"] })).toEqual({ exclude: ["Jordan"], add: ["Venezuela"] });
    expect(sanitizeMissionProfile({ homeIcao: "KWRI" }).economy).toBeUndefined();
    expect(sanitizeMissionProfile({ homeIcao: "KWRI", economy: { add: ["Iran"] } }).economy).toEqual({ exclude: [], add: ["Iran"] });
  });
});

const IRAN_HORMUZ: MissionProfile = {
  homeIcao: "KWRI",
  spokes: [],
  theaters: ["CENTCOM"],
  aois: [{
    id: "iran-hormuz", name: "Iran & Hormuz", aor: "CENTCOM",
    countries: ["Iran", "Iraq", "Kuwait", "Bahrain", "Qatar", "Saudi Arabia"],
    intensity: "primary", iw: true, chokepointIds: ["hormuz"],
  }],
  excludedIds: [], materializedIds: [],
};

// Hub-and-spoke: crews/aircraft live at the hub AND at spoke fields.
const HUB_AND_SPOKE: MissionProfile = {
  ...IRAN_HORMUZ,
  spokes: [
    { icao: "KCHS", label: "JB Charleston, SC", lat: 32.8986, lon: -80.0405, country: "United States" },
    { icao: "KADW", label: "JB Andrews, MD", lat: 38.8108, lon: -76.867, country: "United States" },
  ],
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

  it("derives in-theater bases, AMC hubs first (own-force hub leads)", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    expect(d.bases.length).toBeGreaterThan(0);
    // The declared home station is itself a watched base now (own force).
    expect(d.bases[0]).toMatchObject({ icao: "KWRI", note: "Own force — hub" });
    // Al Udeid (Qatar, curated CENTCOM hub) must be in the set for a Gulf AOI.
    expect(d.bases.some((b) => b.icao === "OTBH")).toBe(true);
    expect(d.bases.every((b) => b.id.startsWith("mp-b-"))).toBe(true);
    // Theater picks (non-own-force) all sit in the AOI's COCOM.
    expect(d.bases.filter((b) => !b.note?.startsWith("Own force")).every((b) => b.cocom === "CENTCOM")).toBe(true);
  });

  it("METAR stations follow the bases; NO weather points are derived (civil-only list)", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    expect(d.metarStations.map((m) => m.icao)).toContain("OTBH");
    // One channel per concept: airfields never materialize into trackedLocations.
    expect("weatherPoints" in d).toBe(false);
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

  it("honors exclusions everywhere, including METAR/watchlist pseudo-ids", () => {
    const d = deriveTracking({ ...IRAN_HORMUZ, excludedIds: ["mp-c-iran", "mp-b-OTBH", "mp-m-OKAS", "mp-t-strait-of-hormuz"] });
    expect(d.countries.some((c) => c.id === "mp-c-iran")).toBe(false);
    expect(d.bases.some((b) => b.icao === "OTBH")).toBe(false);
    expect(d.metarStations.some((m) => m.icao === "OKAS")).toBe(false);
    expect(d.watchlistSeeds).not.toContain("Strait of Hormuz");
  });

  it("watchlist seeds are chokepoint names only (headline-matchable), deduped", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    expect(d.watchlistSeeds).toContain("Strait of Hormuz");
    // AOI display names never match a headline verbatim — not seeded.
    expect(d.watchlistSeeds).not.toContain("Iran & Hormuz");
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

  it("derivedIds covers countries, bases, and METAR/watchlist pseudo-ids", () => {
    const d = deriveTracking(IRAN_HORMUZ);
    const ids = derivedIds(d);
    expect(ids.length).toBe(d.countries.length + d.bases.length + d.metarStations.length + d.watchlistSeeds.length);
    expect(ids.every(isDerivedId)).toBe(true);
    expect(ids).toContain("mp-m-OTBH");
    expect(ids).toContain("mp-t-strait-of-hormuz");
  });
});

describe("hub-and-spoke own-force airfields", () => {
  it("hub + spokes become watched bases FIRST, ahead of AOI theater picks", () => {
    const d = deriveTracking(HUB_AND_SPOKE);
    const icaos = d.bases.map((b) => b.icao);
    // Own-force fields lead the list (they outrank theater picks for caps).
    expect(icaos.slice(0, 3)).toEqual(["KWRI", "KCHS", "KADW"]);
    expect(d.bases[0].note).toBe("Own force — hub");
    expect(d.bases[1].note).toBe("Own force — spoke");
    // Theater bases still follow.
    expect(icaos).toContain("OTBH");
  });

  it("spokes get METAR stations (weather stays civil-only)", () => {
    const d = deriveTracking(HUB_AND_SPOKE);
    expect(d.metarStations.map((m) => m.icao)).toContain("KADW");
    expect(d.metarStations.map((m) => m.icao)).toContain("KCHS");
  });

  it("SITREP candidates order: hub, spokes, then theater", () => {
    const d = deriveTracking(HUB_AND_SPOKE);
    expect(d.sitrepCandidates.slice(0, 3).map((s) => s.icao)).toEqual(["KWRI", "KCHS", "KADW"]);
    expect(d.sitrepCandidates.length).toBeGreaterThan(3); // theater picks follow
  });

  it("a spoke can be excluded like any derived item", () => {
    const d = deriveTracking({ ...HUB_AND_SPOKE, excludedIds: ["mp-b-KCHS"] });
    expect(d.bases.some((b) => b.icao === "KCHS")).toBe(false);
    expect(d.bases.some((b) => b.icao === "KADW")).toBe(true);
  });

  it("sanitize validates spokes (bad coords/icao drop, dedupe, cap) and resolved home", () => {
    const p = sanitizeMissionProfile({
      homeIcao: "kwri",
      home: { icao: "KWRI", label: "JB MDL", lat: 40.0155, lon: -74.5917, country: "United States" },
      spokes: [
        { icao: "KCHS", label: "Charleston", lat: 32.9, lon: -80.04, country: "United States" },
        { icao: "KCHS", label: "dupe", lat: 32.9, lon: -80.04, country: "" },
        { icao: "XX", label: "bad icao", lat: 1, lon: 1, country: "" },
        { icao: "KTIK", label: "no coords" },
      ],
    });
    expect(p.spokes.map((s) => s.icao)).toEqual(["KCHS"]);
    expect(p.home?.icao).toBe("KWRI");
  });

  it("uncurated spokes derive from their stored coordinates (no lookup needed)", () => {
    const p = sanitizeMissionProfile({
      spokes: [{ icao: "KTIK", label: "Tinker AFB, OK", lat: 35.4147, lon: -97.3866, country: "United States" }],
    });
    const d = deriveTracking(p);
    expect(d.bases[0]).toMatchObject({ icao: "KTIK", cocom: "NORTHCOM", note: "Own force — spoke" });
    expect(d.sitrepCandidates[0]?.icao).toBe("KTIK");
  });

  it("hub listed as a spoke too is not duplicated", () => {
    const p = sanitizeMissionProfile({
      homeIcao: "KWRI",
      spokes: [{ icao: "KWRI", label: "JB MDL", lat: 40.0155, lon: -74.5917, country: "United States" }],
    });
    const d = deriveTracking(p);
    expect(d.bases.filter((b) => b.icao === "KWRI")).toHaveLength(1);
  });
});

import { setOwnForceRole, ownForceRoleOf, resolvedHub } from "@/lib/missionProfile";

describe("setOwnForceRole — hub / spoke / none as one change (the command board's role switch)", () => {
  const KWRI = { icao: "KWRI", label: "JB MDL", lat: 40.0155, lon: -74.5917, country: "United States" };
  const KTIK = { icao: "KTIK", label: "Tinker AFB, OK", lat: 35.4147, lon: -97.3866, country: "United States" };
  const WITH_HOME: MissionProfile = { ...HUB_AND_SPOKE, home: KWRI };

  it("reads the current role: hub from home/homeIcao, spoke from the list, else null", () => {
    expect(ownForceRoleOf(HUB_AND_SPOKE, "kwri")).toBe("hub");
    expect(ownForceRoleOf(HUB_AND_SPOKE, "KCHS")).toBe("spoke");
    expect(ownForceRoleOf(HUB_AND_SPOKE, "OJAQ")).toBeNull();
    // A curated homeIcao resolves to a field even without the stored object.
    expect(resolvedHub(HUB_AND_SPOKE)?.icao).toBe("KWRI");
    expect(resolvedHub({ ...EMPTY_PROFILE })).toBeNull();
  });

  it("promoting a spoke to hub demotes the previous hub to a SPOKE — never out of the declaration", () => {
    const r = setOwnForceRole(WITH_HOME, { ...HUB_AND_SPOKE.spokes[0] }, "hub");
    expect(r.profile.homeIcao).toBe("KCHS");
    expect(r.profile.home?.icao).toBe("KCHS");
    expect(r.profile.spokes.map((s) => s.icao)).toEqual(["KADW", "KWRI"]);
    expect(r.changes.join(" | ")).toMatch(/KCHS is now the hub \(was a spoke\)/);
    expect(r.changes.join(" | ")).toMatch(/KWRI is now a spoke \(was the hub\)/);
    expect(r.warnings).toEqual([]);
    // Undo is the exact sequence: old hub back, then the promoted field to its prior role.
    expect(r.undo).toEqual([{ icao: "KWRI", role: "hub" }, { icao: "KCHS", role: "spoke" }]);
  });

  it("the undo sequence puts the declaration back exactly", () => {
    const fwd = setOwnForceRole(WITH_HOME, { ...HUB_AND_SPOKE.spokes[0] }, "hub");
    let p = fwd.profile;
    for (const op of fwd.undo) {
      const field = op.icao === "KWRI" ? KWRI : HUB_AND_SPOKE.spokes.find((s) => s.icao === op.icao)!;
      p = setOwnForceRole(p, field, op.role).profile;
    }
    expect(p.homeIcao).toBe("KWRI");
    expect(p.home?.icao).toBe("KWRI");
    expect(p.spokes.map((s) => s.icao).sort()).toEqual(["KADW", "KCHS"]);
  });

  it("a new field can become the hub straight away; a field in neither list becomes a spoke", () => {
    const h = setOwnForceRole(WITH_HOME, KTIK, "hub");
    expect(h.profile.homeIcao).toBe("KTIK");
    expect(h.profile.spokes.map((s) => s.icao)).toEqual(["KCHS", "KADW", "KWRI"]);
    expect(h.undo).toEqual([{ icao: "KWRI", role: "hub" }, { icao: "KTIK", role: null }]);
    const s = setOwnForceRole(WITH_HOME, KTIK, "spoke");
    expect(s.profile.spokes.map((x) => x.icao)).toEqual(["KCHS", "KADW", "KTIK"]);
    expect(s.profile.homeIcao).toBe("KWRI");
    expect(s.undo).toEqual([{ icao: "KTIK", role: null }]);
  });

  it("the hub demoted to spoke leaves NO hub declared, and says so", () => {
    const r = setOwnForceRole(WITH_HOME, KWRI, "spoke");
    expect(r.profile.homeIcao).toBe("");
    expect(r.profile.home).toBeUndefined();
    expect(r.profile.spokes.map((s) => s.icao)).toEqual(["KCHS", "KADW", "KWRI"]);
    expect(r.changes[0]).toMatch(/was the hub — no hub is declared now/);
    expect(r.undo).toEqual([{ icao: "KWRI", role: "hub" }]);
  });

  it("clearing a role drops the field from the declaration; a field is never in both lists", () => {
    const r = setOwnForceRole(WITH_HOME, HUB_AND_SPOKE.spokes[1], null);
    expect(r.profile.spokes.map((s) => s.icao)).toEqual(["KCHS"]);
    expect(r.undo).toEqual([{ icao: "KADW", role: "spoke" }]);
    const h = setOwnForceRole(WITH_HOME, KWRI, null);
    expect(h.profile.homeIcao).toBe("");
    expect(h.profile.spokes.some((s) => s.icao === "KWRI")).toBe(false);
    for (const p of [r.profile, h.profile]) {
      const hub = p.home?.icao || p.homeIcao;
      expect(p.spokes.some((s) => s.icao === hub && hub)).toBe(false);
    }
  });

  it("the same role again is a no-op warning, never a change", () => {
    expect(setOwnForceRole(WITH_HOME, KWRI, "hub")).toMatchObject({ changes: [], undo: [], warnings: ["KWRI is already the hub"] });
    expect(setOwnForceRole(WITH_HOME, KTIK, null)).toMatchObject({ changes: [], undo: [], warnings: ["KTIK is not an own-force field"] });
  });

  it("assigning a role lifts that field's Apply exclusions (the operator just said it is own force)", () => {
    const p = { ...WITH_HOME, excludedIds: ["mp-b-KTIK", "mp-m-KTIK", "mp-b-KCHS"] };
    const r = setOwnForceRole(p, KTIK, "spoke");
    expect(r.profile.excludedIds).toEqual(["mp-b-KCHS"]);
    expect(r.changes).toContain("KTIK's Apply exclusion lifted");
    // Clearing a role does NOT touch exclusions — tracking is the caller's call.
    expect(setOwnForceRole(p, HUB_AND_SPOKE.spokes[0], null).profile.excludedIds).toEqual(p.excludedIds);
  });

  it("full spokes: a new spoke is refused with a warning; a demoted hub that cannot fit is named, not dropped silently", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ icao: `KA0${i}`, label: `F${i}`, lat: 30 + i, lon: -90, country: "United States" }));
    const full: MissionProfile = { ...WITH_HOME, spokes: many };
    const s = setOwnForceRole(full, KTIK, "spoke");
    expect(s.changes).toEqual([]);
    expect(s.warnings[0]).toMatch(/Spokes are full/);
    const h = setOwnForceRole(full, KTIK, "hub");
    expect(h.profile.homeIcao).toBe("KTIK");
    expect(h.profile.spokes.some((x) => x.icao === "KWRI")).toBe(false);
    expect(h.warnings[0]).toMatch(/KWRI \(the previous hub\) could not be kept as a spoke/);
  });

  it("sanitize round-trips a profile the switch produced", () => {
    const r = setOwnForceRole(WITH_HOME, KTIK, "hub");
    const p = sanitizeMissionProfile(JSON.parse(JSON.stringify(r.profile)));
    expect(p.homeIcao).toBe("KTIK");
    expect(p.home?.label).toBe("Tinker AFB, OK");
    expect(deriveTracking(p).bases[0]).toMatchObject({ icao: "KTIK", note: "Own force — hub" });
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

describe("suggestAoiCountries", () => {
  it("proposes theater countries not already in the AOI, title-cased", () => {
    const s = suggestAoiCountries("CENTCOM", ["Iran", "Iraq"]);
    expect(s).toContain("Qatar");
    expect(s).toContain("Saudi Arabia");
    expect(s).not.toContain("Iran");
    expect(s).not.toContain("Poland");
  });
  it("excludes case-insensitively", () => {
    expect(suggestAoiCountries("CENTCOM", ["qatar"])).not.toContain("Qatar");
  });
});

describe("missionSummaryLine", () => {
  it("is empty for an empty profile", () => {
    expect(missionSummaryLine(EMPTY_PROFILE)).toBe("");
  });
});

describe("spectrum dependencies (team config, never a prompt)", () => {
  it("defaults: no polar routes (this wing's declaration), space activity on, nothing else declared", () => {
    expect(sanitizeMissionProfile({}).spectrum).toEqual({ polarRoutes: false, satcom: "", edgeVendors: [], spaceActivity: true });
  });
  it("sanitizes vendors (trimmed, deduped, capped) and keeps an explicit null for polar", () => {
    const p = sanitizeMissionProfile({ spectrum: { polarRoutes: null, satcom: "WGS Ku", edgeVendors: [" Cisco ", "cisco", "Cisco", "x", 42, "Fortinet"], spaceActivity: false } });
    expect(p.spectrum.polarRoutes).toBeNull();
    expect(p.spectrum.satcom).toBe("WGS Ku");
    expect(p.spectrum.edgeVendors).toEqual(["Cisco", "cisco", "Fortinet"]);
    expect(p.spectrum.spaceActivity).toBe(false);
  });
  it("never enters the model-facing summary line", () => {
    const p = sanitizeMissionProfile({ homeIcao: "KWRI", spectrum: { satcom: "SECRET-SATCOM-NAME", edgeVendors: ["VendorX"] } });
    expect(missionSummaryLine(p)).not.toMatch(/SATCOM|VendorX/);
  });
  it("space activity opt-out flows to the warning seeds", () => {
    const p = sanitizeMissionProfile({ aois: [{ name: "China", aor: "INDOPACOM", countries: ["China"], intensity: "primary", iw: true }], spectrum: { spaceActivity: false } });
    expect(deriveTracking(p).warningProblems[0].spaceActivity).toBe(false);
  });
  it("summarizes hub, spokes, theaters, and AOIs with chokepoints", () => {
    const line = missionSummaryLine({
      ...IRAN_HORMUZ,
      home: { icao: "KWRI", label: "JB MDL (McGuire), NJ", lat: 40.0155, lon: -74.5917, country: "United States" },
      spokes: [{ icao: "KCHS", label: "JB Charleston, SC", lat: 32.9, lon: -80.04, country: "United States" }],
    });
    expect(line).toContain("hub JB MDL");
    expect(line).toContain("spokes KCHS");
    expect(line).toContain("theaters CENTCOM");
    expect(line).toContain('AOI "Iran & Hormuz"');
    expect(line).toContain("Strait of Hormuz");
  });
});

// ── Must-tracks (REVIEW-2026-10 §6, decision 4) ──────────────────────────────
import { sanitizeMustTrack, toggleMustTrack, isStarCountry, sitrepBasesForStars } from "@/lib/missionProfile";

describe("must-tracks", () => {
  it("sanitizes: valid AORs only, countries deduped case-insensitively, ICAOs upper-cased 4-char", () => {
    const mt = sanitizeMustTrack({ aors: ["centcom", "MORDOR", "CENTCOM", "EUCOM"], countries: ["Jordan", " jordan ", "", "Iraq"], icaos: ["ojaq", "KWRI", "bad", "KWRI"] });
    expect(mt).toEqual({ aors: ["CENTCOM", "EUCOM"], countries: ["Jordan", "Iraq"], icaos: ["OJAQ", "KWRI"] });
    expect(sanitizeMustTrack(null)).toEqual({ aors: [], countries: [], icaos: [] });
    expect(sanitizeMissionProfile({ mustTrack: { icaos: ["OJAQ"] } }).mustTrack.icaos).toEqual(["OJAQ"]);
  });

  it("toggles each kind and matches countries case-insensitively", () => {
    let mt = toggleMustTrack({ aors: [], countries: [], icaos: [] }, "aor", "centcom");
    expect(mt.aors).toEqual(["CENTCOM"]);
    mt = toggleMustTrack(mt, "country", "Jordan");
    expect(isStarCountry(mt, "JORDAN")).toBe(true);
    mt = toggleMustTrack(mt, "country", "jordan");
    expect(mt.countries).toEqual([]);
    mt = toggleMustTrack(mt, "icao", "ojaq");
    expect(mt.icaos).toEqual(["OJAQ"]);
  });

  it("SITREP candidates: hub first, then ★ fields, then spokes; cap is 6", () => {
    const p: MissionProfile = { ...HUB_AND_SPOKE, mustTrack: { aors: [], countries: [], icaos: ["OTBH", "KADW"] } };
    const d = deriveTracking(p);
    expect(SITREP_MAX).toBe(6);
    expect(d.sitrepCandidates.map((s) => s.icao).slice(0, 4)).toEqual(["KWRI", "OTBH", "KADW", "KCHS"]);
    expect(d.warningProblems[0].ownHubs.map((h) => h.icao)).toEqual(["KWRI", "KCHS", "KADW"]);
  });

  it("sitrepBasesForStars: hub, ★ in order, then the current set, capped — unknown ★ skipped unless resolved", () => {
    const b = (icao: string) => ({ icao, label: icao, lat: 0, lon: 0, country: "X", place: icao });
    const current = [b("OJAQ"), b("ETAD"), b("LLBG"), b("ORER"), b("OEPS"), b("OKAS")];
    const out = sitrepBasesForStars(current, [b("KWRI")], ["LLBG", "ZZZZ", "OTBH"], "KWRI", { OTBH: b("OTBH") });
    expect(out.map((x) => x.icao)).toEqual(["KWRI", "LLBG", "OTBH", "OJAQ", "ETAD", "ORER"]);
    expect(out).toHaveLength(6);
  });
});
