import { describe, it, expect } from "vitest";
import {
  readCyber, stateActorsIn, advisoriesNaming, parseKev, kevHits, parseRansomwareVictims, victimsRelevant,
  parseIodaAlerts, outageAlertsFor,
} from "../lib/cyberSignals";
import { parseNoaaScales, spaceWeatherImpacts, spaceWxLed, pntStormGuard, severeScales } from "../lib/spaceWeatherOps";
import { parseLaunches, launchCadence, parseSocrates, usPayloadConjunctions, spacePowersIn } from "../lib/spaceCatalog";
import { pntState, cyberState, spaceActivityState, edgeExposureLed, stateLed } from "../lib/spectrumRules";

const T = Date.parse("2026-09-30T12:00:00Z");

describe("cyber grammar — phrases, never words; modality graded", () => {
  it("grades a reported wiper attack as a disruptive act", () => {
    const r = readCyber("Wiper malware crippled the port authority's systems overnight, officials said");
    expect(r?.cls).toBe("disruptive");
    expect(r?.modality).toBe("act");
    expect(r?.weight).toBe(90);
  });
  it("a threat is discounted, an analysis piece nearly to nothing", () => {
    expect(readCyber("Hackers vowed to launch DDoS attacks on airports")?.modality).toBe("threat");
    const a = readCyber("Analysts say a ransomware attack on logistics firms could follow");
    expect(a?.modality).toBe("analysis");
    expect(a!.weight).toBeLessThan(10);
  });
  it("a bare mention of hackers or cyber is nothing", () => {
    expect(readCyber("Iranian hackers are a growing concern for Gulf states")).toBeNull();
    expect(readCyber("The cyber budget rose 4% this year")).toBeNull();
  });
  it("names state actors by their many names", () => {
    expect(stateActorsIn("CISA: Volt Typhoon pre-positioning in U.S. infrastructure")).toEqual(["China"]);
    expect(stateActorsIn("Advisory: IRGC-affiliated CyberAv3ngers target PLCs")).toEqual(["Iran"]);
    expect(stateActorsIn("Routine patch Tuesday guidance")).toEqual([]);
  });
  it("advisoriesNaming keeps only actors tied to the AOI, inside the window; undated kept", () => {
    const items = [
      { title: "Sandworm targets Ukrainian grid", pubDate: "2026-09-25T00:00:00Z" },
      { title: "Iranian cyber actors exploit PLCs", pubDate: "2026-08-01T00:00:00Z" },
      { title: "Iranian actors target water utilities" },
    ];
    const hits = advisoriesNaming(items, ["Iran"], T);
    expect(hits.map((h) => h.title)).toEqual(["Iranian actors target water utilities"]);
    expect(hits[0].ageDays).toBeNull();
  });
});

describe("KEV × declared vendors", () => {
  const kev = parseKev({ vulnerabilities: [
    { cveID: "CVE-2026-1", vendorProject: "Cisco", product: "ASA", vulnerabilityName: "x", dateAdded: "2026-09-28", knownRansomwareCampaignUse: "Known" },
    { cveID: "CVE-2026-2", vendorProject: "Fortinet", product: "FortiOS", vulnerabilityName: "y", dateAdded: "2026-09-29", knownRansomwareCampaignUse: "Unknown" },
    { cveID: "CVE-2026-3", vendorProject: "Cisco", product: "IOS", vulnerabilityName: "z", dateAdded: "2026-06-01", knownRansomwareCampaignUse: "Unknown" },
  ] });
  it("matches declared vendors word-bounded inside the window only", () => {
    const hits = kevHits(kev, ["cisco", "Palo Alto"], T);
    expect(hits.map((h) => h.entry.cveID)).toEqual(["CVE-2026-1"]);
    expect(hits[0].vendor).toBe("cisco");
  });
  it("no declared vendors → no hits, and the LED is UNKNOWN, never green", () => {
    expect(kevHits(kev, [], T)).toEqual([]);
    expect(edgeExposureLed([], false, true)).toBe("u");
    expect(edgeExposureLed([], true, true)).toBe("g");
    expect(edgeExposureLed(kevHits(kev, ["Fortinet"], T), true, true)).toBe("a");
    expect(edgeExposureLed(kevHits(kev, ["Cisco"], T), true, true)).toBe("r");
    expect(edgeExposureLed([], true, false)).toBe("u");
  });
});

describe("ransomware.live + IODA parsers are defensive", () => {
  it("reads victims by several field names; undated rows never enter a window", () => {
    const v = parseRansomwareVictims([
      { post_title: "Gulf Ports Co", group_name: "lockbit", country: "ae", activity: "Transportation/Logistics", discovered: "2026-09-29 10:00:00" },
      { victim: "Nowhere Inc", group: "x", country: "US", sector: "Retail" },
    ]);
    expect(v).toHaveLength(2);
    expect(v[0].country).toBe("AE");
    const rel = victimsRelevant(v, [{ iso2: "AE", name: "United Arab Emirates" }], T);
    expect(rel.map((x) => x.victim)).toEqual(["Gulf Ports Co"]);
    // sector match anywhere in the world
    expect(victimsRelevant(v, [{ name: "Iran" }], T).map((x) => x.victim)).toEqual(["Gulf Ports Co"]);
  });
  it("outage alerts: country-level only, worst level per country, loose name match", () => {
    const alerts = parseIodaAlerts({ data: [
      { entity: { type: "country", name: "Iran (Islamic Republic of)", code: "IR" }, level: "warning", datasource: "bgp", time: 1 },
      { entity: { type: "country", name: "Iran (Islamic Republic of)", code: "IR" }, level: "critical", datasource: "ping-slash24", time: 2 },
      { entity: { type: "region", name: "Tehran", code: "1" }, level: "critical", datasource: "bgp", time: 3 },
      { entity: { type: "country", name: "Iraq", code: "IQ" }, level: "normal", datasource: "bgp", time: 4 },
    ] });
    const out = outageAlertsFor(alerts, ["Iran", "Iraq"]);
    expect(out).toEqual([{ country: "Iran (Islamic Republic of)", level: "critical", sources: 2, latest: 2 }]);
  });
});

describe("space weather → ops (environment, never a level)", () => {
  const scales = parseNoaaScales({
    "-1": { DateStamp: "2026-09-29", R: { Scale: "0" }, S: { Scale: "0" }, G: { Scale: "1" } },
    "0": { DateStamp: "2026-09-30", R: { Scale: "2" }, S: { Scale: "1" }, G: { Scale: "3" } },
    "1": { DateStamp: "2026-10-01", R: { Scale: null, MinorProb: "60", MajorProb: "10" }, S: { Scale: null, Prob: "5" }, G: { Scale: "2" } },
    "2": { DateStamp: "2026-10-02", R: { Scale: null, MinorProb: "10", MajorProb: "1" }, S: { Scale: null, Prob: "1" }, G: { Scale: "0" } },
  });
  it("parses today + the outlook, deriving predicted R/S from probabilities", () => {
    expect(scales.live).toBe(true);
    expect(scales.now).toMatchObject({ R: 2, S: 1, G: 3 });
    expect(scales.outlook).toHaveLength(2);
    expect(scales.outlook[0].R).toBe(1);
    expect(scales.outlook[0].G).toBe(2);
  });
  it("impact rows follow the declaration: polar false → radiation not a factor", () => {
    const rows = spaceWeatherImpacts(scales, { polar: false });
    expect(rows.map((r) => `${r.key}:${r.led}`)).toEqual(["hf:a", "gps:r", "satcom:a", "radiation:g"]);
    expect(rows[3].relevance).toBe("not declared");
    expect(spaceWeatherImpacts(scales, { polar: null })[3].led).toBe("u");
    expect(spaceWeatherImpacts(scales, { polar: true })[3].led).toBe("a");
  });
  it("a dead feed is UNKNOWN on every row and the guard is off", () => {
    const dead = parseNoaaScales(null);
    expect(dead.live).toBe(false);
    expect(spaceWeatherImpacts(dead, { polar: false }).every((r) => r.led === "u")).toBe(true);
    expect(spaceWxLed(dead)).toBe("u");
    expect(pntStormGuard(dead)).toBe(false);
  });
  it("G3 sets the guard and the severe list", () => {
    expect(pntStormGuard(scales)).toBe(true);
    expect(severeScales(scales)).toEqual([{ scale: "G", level: 3 }]);
    expect(spaceWxLed(scales)).toBe("r");
  });
});

describe("space activity — cadence, not count", () => {
  const ll2 = parseLaunches({ results: [
    { name: "Long March 2D | Yaogan", net: "2026-09-28T02:00:00Z", launch_service_provider: { name: "CASC", country_code: "CHN" }, pad: { name: "LC-9", latitude: "38.8", longitude: "111.6", location: { country_code: "CHN" } }, status: { abbrev: "Success" } },
    { name: "Long March 4C", net: "2026-09-20T02:00:00Z", launch_service_provider: { name: "CASC", country_code: "CHN" }, pad: { latitude: "40.9", longitude: "100.3" }, status: { abbrev: "Success" } },
    { name: "Falcon 9 | Starlink", net: "2026-09-29T02:00:00Z", launch_service_provider: { name: "SpaceX", country_code: "USA" }, pad: { latitude: "28.5", longitude: "-80.6" }, status: { abbrev: "Success" } },
    { name: "Long March 5", net: "2026-10-05T02:00:00Z", launch_service_provider: { name: "CASC", country_code: "CHN" }, pad: { latitude: "19.6", longitude: "110.9" }, status: { abbrev: "Go" } },
  ] });
  it("parses provider country and pad coordinates", () => {
    expect(ll2).toHaveLength(4);
    expect(ll2[0]).toMatchObject({ country: "CHN", lat: 38.8, lon: 111.6 });
  });
  it("cadence counts only the actor, past vs future split by net, over the span the page actually covers", () => {
    // The sample's oldest launch is 10 days back, so the covered history is
    // 10 days — too short for a cadence (null), and never divided by 90.
    const c = launchCadence(ll2, ["CHN"], T, 90);
    expect(c.last14).toBe(2);
    expect(c.next14).toBe(1);
    expect(c.per14).toBeNull();
    expect(c.historyDays).toBe(10);
    // With an old launch in the page the span opens up and the cadence forms.
    const older = [...ll2, { ...ll2[1], name: "Long March 3B", net: "2026-07-10T12:00:00Z" }];
    const c2 = launchCadence(older, ["CHN"], T, 90);
    expect(c2.historyDays).toBe(82);
    expect(c2.per14).toBeCloseTo((3 / 82) * 14, 5);
  });
  it("space powers resolve from country names", () => {
    expect(spacePowersIn(["Iran", "Iraq", "China"])).toEqual(["IRN", "CHN"]);
    expect(spacePowersIn(["Qatar"])).toEqual([]);
  });
  it("SOCRATES conjunctions: only U.S. military payloads inside the range", () => {
    const csv = "NORAD_CAT_ID_1,OBJECT_NAME_1,NORAD_CAT_ID_2,OBJECT_NAME_2,TCA,MIN_RNG,MAX_PROB\n1,USA 224,2,COSMOS 1408 DEB,2026-10-01 03:00:00,0.412,1.2E-04\n3,STARLINK-3000,4,STARLINK-3001,2026-10-01 04:00:00,0.2,1E-05\n5,WGS 10,6,SL-16 R/B,2026-10-01 05:00:00,4.0,1E-06";
    const all = parseSocrates(csv);
    expect(all).toHaveLength(3);
    expect(usPayloadConjunctions(all).map((c) => c.primary)).toEqual(["USA 224"]);
  });
});

describe("spectrum ladders", () => {
  it("pnt: nothing observed → null (UNKNOWN); learning caps density at watching; a hub in a cell is active", () => {
    expect(pntState({ cellsLive: false, cells: 0, baseline: { mean: null, samples: 0 }, hubHits: 0, gpsNotams: null, raimNotams: 0, stormGuard: false })).toBeNull();
    const learning = pntState({ cellsLive: true, cells: 12, baseline: { mean: null, samples: 0 }, hubHits: 0, gpsNotams: 0, raimNotams: 0, stormGuard: false });
    expect(learning?.state).toBe("watching");
    const hub = pntState({ cellsLive: true, cells: 3, baseline: { mean: null, samples: 0 }, hubHits: 1, gpsNotams: 0, raimNotams: 0, stormGuard: false });
    expect(hub?.state).toBe("active");
  });
  it("pnt: surge against own baseline is active; G3+ storm caps it at watching and says so", () => {
    const base = { mean: 4, samples: 20 };
    expect(pntState({ cellsLive: true, cells: 14, baseline: base, hubHits: 0, gpsNotams: 0, raimNotams: 0, stormGuard: false })?.state).toBe("active");
    expect(pntState({ cellsLive: true, cells: 5, baseline: base, hubHits: 0, gpsNotams: 0, raimNotams: 0, stormGuard: false })?.state).toBe("watching");
    const guarded = pntState({ cellsLive: true, cells: 14, baseline: base, hubHits: 2, gpsNotams: 3, raimNotams: 0, stormGuard: true });
    expect(guarded?.state).toBe("watching");
    expect(guarded?.why).toMatch(/environment/);
  });
  it("cyber: an advisory naming the actor is active; with a wire act it confirms; own-only caps at watching", () => {
    const none = cyberState({ outagesLive: true, outages: [], victimsLive: true, victims: 0, victimsBaseline: { mean: 1, samples: 10 }, actsBy: [], advisories: 0 });
    expect(none?.state).toBe("dormant");
    const adv = cyberState({ outagesLive: true, outages: [], victimsLive: false, victims: 0, victimsBaseline: { mean: null, samples: 0 }, actsBy: [], advisories: 1 });
    expect(adv?.state).toBe("active");
    const both = cyberState({ outagesLive: true, outages: [], victimsLive: false, victims: 0, victimsBaseline: { mean: null, samples: 0 }, actsBy: [{ modality: "act", own: false, source: "reuters" }], advisories: 1 });
    expect(both?.state).toBe("confirmed");
    const own = cyberState({ outagesLive: false, outages: [], victimsLive: false, victims: 0, victimsBaseline: { mean: null, samples: 0 }, actsBy: [{ modality: "act", own: true, source: "x" }], advisories: 0 });
    expect(own?.state).toBe("watching");
    expect(cyberState({ outagesLive: false, outages: [], victimsLive: false, victims: 0, victimsBaseline: { mean: null, samples: 0 }, actsBy: [], advisories: 0 })).toBeNull();
  });
  it("cyber: outage alerts trip a watch alone and corroborate an act", () => {
    const alone = cyberState({ outagesLive: true, outages: [{ country: "Iran", level: "critical" }], victimsLive: false, victims: 0, victimsBaseline: { mean: null, samples: 0 }, actsBy: [], advisories: 0 });
    expect(alone?.state).toBe("watching");
    const corr = cyberState({ outagesLive: true, outages: [{ country: "Iran", level: "critical" }], victimsLive: false, victims: 0, victimsBaseline: { mean: null, samples: 0 }, actsBy: [{ modality: "act", own: false, source: "ap" }], advisories: 0 });
    expect(corr?.state).toBe("active");
    expect(corr?.why).toMatch(/corroborated/);
  });
  it("space activity: cadence-relative; conjunctions active; learning watches", () => {
    expect(spaceActivityState({ live: false, last14: 5, per14: 1, next14: 0, conjunctions: 0 })).toBeNull();
    expect(spaceActivityState({ live: true, last14: 1, per14: 1.2, next14: 0, conjunctions: 0 })?.state).toBe("dormant");
    expect(spaceActivityState({ live: true, last14: 5, per14: 1.2, next14: 0, conjunctions: 0 })?.state).toBe("active");
    expect(spaceActivityState({ live: true, last14: 2, per14: null, next14: 0, conjunctions: 0 })?.state).toBe("watching");
    expect(spaceActivityState({ live: true, last14: 0, per14: 1, next14: 0, conjunctions: 1 })?.state).toBe("active");
  });
  it("state → LED: confirmed earns red, watching amber, dormant green, unknown unknown", () => {
    expect(stateLed("confirmed")).toBe("r");
    expect(stateLed("watching")).toBe("a");
    expect(stateLed("dormant")).toBe("g");
    expect(stateLed(null)).toBe("u");
  });
});
