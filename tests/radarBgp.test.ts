import { describe, it, expect } from "vitest";
import { parseBgpHijacks, parseBgpLeaks, bgpReadsFor, hijackLevel, leakLevel, isDomesticHijack, bandOf, BGP_LEVEL_ORDINAL } from "../lib/radarBgp";
import { functionalRows, type FcInput, type FcRouting, type FcTraffic } from "../lib/functionalCommands";

// The host is unreachable from the sandbox; these bodies follow the published
// reference for /radar/bgp/hijacks/events and /radar/bgp/leaks/events.
const NOW = Date.parse("2026-10-27T12:00:00Z");
const H = (t: number) => new Date(NOW - t * 3_600_000).toISOString();

const HIJACKS = {
  success: true, result: {
    asn_info: [
      { asn: 12880, country_code: "IR", org_name: "Information Technology Company (ITC)" },
      { asn: 8359, country_code: "RU", org_name: "MTS PJSC" },
      { asn: 15169, country_code: "US", org_name: "Google LLC" },
    ],
    events: [
      // High confidence, ongoing, victim Iran, hijacker Russia.
      { id: 1001, confidence_score: 9, duration: 3600, event_type: 1, hijack_msgs_count: 40, hijacker_asn: 8359, hijacker_country: "RU", is_stale: false, max_hijack_ts: H(1), max_msg_ts: H(1), min_hijack_ts: H(3), min_msg_ts: H(3), on_going_count: 12, peer_asns: [1, 2], peer_ip_count: 14, prefixes: ["5.56.0.0/16", "5.57.0.0/16"], tags: [{ name: "same_prefix", score: 1 }], victim_asns: [12880], victim_countries: ["IR"] },
      // Mid confidence, ended 2 h ago, victim US.
      { id: 1002, confidence_score: 6, hijacker_asn: 12880, hijacker_country: "IR", is_stale: true, max_hijack_ts: H(2), min_hijack_ts: H(5), on_going_count: 0, peer_ip_count: 3, prefixes: ["8.8.8.0/24"], tags: [], victim_asns: [15169], victim_countries: ["US"] },
      // High confidence but four days old → a note.
      { id: 1003, confidence_score: 10, hijacker_asn: 8359, hijacker_country: "RU", is_stale: true, max_hijack_ts: H(96), min_hijack_ts: H(98), on_going_count: 0, peer_ip_count: 9, prefixes: ["1.2.3.0/24"], tags: [], victim_asns: [12880], victim_countries: ["IR"] },
      // Low confidence, ongoing → never colours.
      { id: 1004, confidence_score: 2, hijacker_asn: 8359, hijacker_country: "RU", is_stale: false, max_hijack_ts: H(0.5), min_hijack_ts: H(1), on_going_count: 1, peer_ip_count: 1, prefixes: ["9.9.9.0/24"], tags: [], victim_asns: [1], victim_countries: ["JO"] },
      // Out of the window → dropped by the read.
      { id: 1005, confidence_score: 9, hijacker_asn: 8359, hijacker_country: "RU", max_hijack_ts: H(24 * 10), min_hijack_ts: H(24 * 10 + 1), on_going_count: 0, prefixes: ["4.4.4.0/24"], victim_asns: [12880], victim_countries: ["IR"] },
      // DOMESTIC (a US network announcing a US prefix — the first production page was mostly these): high, ongoing, and still a note.
      { id: 1008, confidence_score: 10, hijacker_asn: 22773, hijacker_country: "US", is_stale: false, max_hijack_ts: H(0.2), min_hijack_ts: H(1), on_going_count: 3, peer_ip_count: 20, prefixes: ["68.1.0.0/16"], tags: [], victim_asns: [11404], victim_countries: ["US"] },
      { confidence_score: 9, max_hijack_ts: H(1) },                 // no id → dropped
      { id: 1007, confidence_score: 9 },                            // no time → dropped
    ],
    total_monitors: 400,
  },
};
const LEAKS = {
  success: true, result: {
    asn_info: [{ asn: 3356, country_code: "US", org_name: "Lumen" }],
    events: [
      { id: 2001, leak_asn: 3356, countries: ["US", "JO"], origin_count: 3, peer_count: 20, prefix_count: 150, leak_count: 9, min_ts: H(2), max_ts: H(1), detected_ts: H(2), finished: false, leak_seg: [1, 2, 3], leak_type: 0 },
      { id: 2002, leak_asn: 3356, countries: ["IR"], origin_count: 1, peer_count: 2, prefix_count: 4, leak_count: 1, min_ts: H(80), max_ts: H(79), finished: true },
      // Small and ongoing — the first production page was 100 of these in a few hours; never a level.
      { id: 2003, leak_asn: 134840, countries: ["IR", "MM"], origin_count: 1, peer_count: 93, prefix_count: 1, leak_count: 1, min_ts: H(0.5), max_ts: H(0.3), finished: false },
    ],
  },
};

describe("parseBgpHijacks / parseBgpLeaks", () => {
  it("reads the envelope, bands the confidence, keeps ASN info, drops rows with no id or time, newest first", () => {
    const { events, asnInfo } = parseBgpHijacks(HIJACKS);
    expect(events.map((e) => e.id)).toEqual(["1008", "1004", "1001", "1002", "1003", "1005"]);
    const h = events.find((e) => e.id === "1001")!;
    expect(h).toMatchObject({ confidence: 9, band: "high", hijackerAsn: 8359, hijackerCountry: "RU", victimAsns: [12880], victimCountries: ["IR"], ongoing: true, stale: false, peerCount: 14, tags: ["same_prefix"] });
    expect(h.prefixes).toEqual(["5.56.0.0/16", "5.57.0.0/16"]);
    expect(asnInfo[12880]).toEqual({ asn: 12880, country: "IR", org: "Information Technology Company (ITC)" });
    expect(parseBgpHijacks({ result: {} }).events).toEqual([]);
    expect(parseBgpHijacks(null).events).toEqual([]);
    expect(bandOf(8)).toBe("high"); expect(bandOf(5)).toBe("mid"); expect(bandOf(4)).toBe("low");
  });
  it("reads leaks with their countries and the finished flag", () => {
    const { events, asnInfo } = parseBgpLeaks(LEAKS);
    expect(events.map((e) => e.id)).toEqual(["2003", "2001", "2002"]);
    expect(events[1]).toMatchObject({ leakAsn: 3356, countries: ["US", "JO"], prefixCount: 150, peerCount: 20, finished: false });
    expect(asnInfo[3356].org).toBe("Lumen");
  });
});

describe("hijackLevel / leakLevel / bgpReadsFor — the level is earned by confidence AND recency", () => {
  const { events: hijacks, asnInfo: hijackInfo } = parseBgpHijacks(HIJACKS);
  const { events: leaks, asnInfo: leakInfo } = parseBgpLeaks(LEAKS);
  const asnInfo = { ...hijackInfo, ...leakInfo };   // the server merges both tables into one
  const by = (id: string) => hijacks.find((h) => h.id === id)!;
  it("high + recent → red; mid + recent → amber; high but old → note; low → note even when ongoing; DOMESTIC → note whatever the confidence", () => {
    expect(hijackLevel(by("1001"), NOW, "IR")).toBe("red");
    expect(hijackLevel(by("1002"), NOW, "US")).toBe("amber");
    expect(hijackLevel(by("1003"), NOW, "IR")).toBe("note");
    expect(hijackLevel(by("1004"), NOW, "JO")).toBe("note");
    // 1008: a US network hijacking a US prefix, confidence 10, ongoing — domestic, so a note for the US…
    expect(hijackLevel(by("1008"), NOW, "US")).toBe("note");
    expect(isDomesticHijack(by("1008"), "US")).toBe(true);
    // …and the same event is cross-border for anyone else it victimised (none here), and red with no country asked.
    expect(hijackLevel(by("1008"), NOW)).toBe("red");
    expect(isDomesticHijack(by("1001"), "IR")).toBe(false);
    // Leaks: big + recent → amber; small or old → note.
    expect(leakLevel(leaks.find((l) => l.id === "2001")!, NOW)).toBe("amber");
    expect(leakLevel(leaks.find((l) => l.id === "2002")!, NOW)).toBe("note");
    expect(leakLevel(leaks.find((l) => l.id === "2003")!, NOW)).toBe("note");
    expect(BGP_LEVEL_ORDINAL.red).toBeGreaterThan(BGP_LEVEL_ORDINAL.amber);
  });
  it("per-country reads: victim reads earn the level, the hijacker country is listed without one, absent means nothing", () => {
    const reads = bgpReadsFor(hijacks, leaks, asnInfo, ["IR", "US", "RU", "JO", "DE"], NOW);
    const r = Object.fromEntries(reads.map((x) => [x.code, x]));
    expect(reads[0].code).toBe("IR");
    expect(r.IR.level).toBe("red");
    expect(r.IR.ongoing).toBe(true);
    expect(r.IR.victimOf.map((h) => h.id)).toEqual(["1001", "1003"]);   // 1005 is outside the window
    expect(r.IR.why).toBe("high-confidence hijack of 2 prefixes (AS12880 (Information Technology Company (ITC))) by AS8359 (MTS PJSC) [RU] · ongoing");
    expect(r.IR.leaks.map((l) => l.id)).toEqual(["2003", "2002"]);        // listed; neither colours (small / old)
    // US: the domestic 1008 (confidence 10, ongoing) is listed as a note; the cross-border mid 1002 sets the level.
    expect(r.US.level).toBe("amber");
    expect(r.US.victimOf.map((h) => h.id)).toEqual(["1008", "1002"]);
    expect(r.US.why).toMatch(/^mid-confidence hijack of 1 prefix \(AS15169 \(Google LLC\)\) by AS12880 .* · last seen 2026-10-27$/);
    expect(r.US.ongoing).toBe(true);    // from the big ongoing leak 2001 — the domestic hijack contributes nothing to "ongoing"
    const usOnly = bgpReadsFor(hijacks.filter((h) => h.id === "1008"), [], asnInfo, ["US"], NOW)[0];
    expect(usOnly.level).toBe("note");
    expect(usOnly.ongoing).toBe(false);
    expect(usOnly.why).toMatch(/· ongoing · domestic — likely misconfiguration, not routing pressure$/);
    // Russia is the HIJACKER on 1001 / 1003 / 1004 and a victim of nothing: listed, level note.
    expect(r.RU.level).toBe("note");
    expect(r.RU.hijackerIn.map((h) => h.id)).toEqual(["1004", "1001", "1003"]);
    expect(r.RU.victimOf).toEqual([]);
    expect(r.RU.why).toMatch(/origin, not victim$/);
    // Jordan: a low-confidence hijack (note) and an ongoing leak (amber).
    expect(r.JO.level).toBe("amber");
    expect(r.JO.why).toMatch(/^route leak by AS3356 \(Lumen\) — 150 prefixes seen by 20 peers · ongoing$/);
    expect(r.DE).toBeUndefined();
  });
});

describe("USCYBERCOM Routing cell and the NetFlows corroboration on Outages", () => {
  const BASE: FcInput = { spectrum: null, demand: null, crew: null, straits: null, sitreps: null, ownFields: [], alerts: [], outages: { ioda: true, radar: { configured: true, live: true, reason: null } } };
  const cell = (i: FcInput, key: string) => functionalRows(i)[2].cells.find((c) => c.key === key)!;
  const routing = (over: Partial<FcRouting> = {}): FcRouting => ({ configured: true, live: true, reason: null, tracked: 4, reads: [], ...over });
  it("absent → UNKNOWN; not configured → UNKNOWN not clear; dead → UNKNOWN with the reason", () => {
    expect(cell(BASE, "routing")).toMatchObject({ led: "u", text: "UNKNOWN — BGP read unavailable", live: false });
    expect(cell({ ...BASE, routing: routing({ configured: false }) }, "routing")).toMatchObject({ led: "u", live: false });
    expect(cell({ ...BASE, routing: routing({ configured: false }) }, "routing").text).toMatch(/not configured — BGP hijacks UNKNOWN, not clear/);
    expect(cell({ ...BASE, routing: routing({ live: false, reason: "HTTP 503" }) }, "routing").text).toBe("UNKNOWN — Cloudflare BGP did not answer (HTTP 503)");
  });
  it("nothing + the feed answered is green and says over how many countries; a red read leads, names the country and opens its room", () => {
    const g = cell({ ...BASE, routing: routing() }, "routing");
    expect(g.led).toBe("g");
    expect(g.text).toBe("no hijack or route leak touching a tracked country in 7 d (4 countries watched)");
    const r = cell({ ...BASE, routing: routing({ reads: [
      { code: "JO", name: "Jordan", level: "amber", why: "route leak by AS3356 — ongoing", ongoing: true },
      { code: "IR", name: "Iran", level: "red", why: "high-confidence hijack of 2 prefixes by AS8359 [RU] · ongoing", ongoing: true },
      { code: "RU", name: "Russia", level: "note", why: "AS8359 announced 2 prefixes of IR — origin, not victim", ongoing: false },
    ] }) }, "routing");
    expect(r.led).toBe("r");
    expect(r.text).toBe("Iran: high-confidence hijack of 2 prefixes by AS8359 [RU] · ongoing · +1 more");
    expect(r.door).toEqual({ kind: "country", id: "Iran" });
    expect(r.detail).toHaveLength(3);
    // A note alone never colours.
    expect(cell({ ...BASE, routing: routing({ reads: [{ code: "RU", name: "Russia", level: "note", why: "origin, not victim", ongoing: false }] }) }, "routing").led).toBe("g");
  });
  it("a COLLAPSED traffic read with no outage alert turns Outages amber and opens the country; DOWN is a detail line; normal is said", () => {
    const traffic = (reads: FcTraffic["reads"], over: Partial<FcTraffic> = {}): FcTraffic => ({ configured: true, live: true, reason: null, failed: [], reads, ...over });
    const gone = cell({ ...BASE, traffic: traffic([{ code: "IR", name: "Iran", state: "collapsed", ratio: 0.1, why: "traffic COLLAPSED — 10% of the same hours on the prior 6 days (last 6 h, Cloudflare NetFlows)" }]) }, "outages");
    expect(gone.led).toBe("a");
    expect(gone.text).toBe("traffic COLLAPSED in Iran (Cloudflare NetFlows) — no outage annotation or IODA alert yet");
    expect(gone.door).toEqual({ kind: "country", id: "Iran" });
    const down = cell({ ...BASE, traffic: traffic([{ code: "IR", name: "Iran", state: "down", ratio: 0.5, why: "traffic DOWN — 50% …" }, { code: "JO", name: "Jordan", state: "normal", ratio: 1.02, why: "traffic 102% …" }]) }, "outages");
    expect(down.led).toBe("g");
    expect(down.detail).toContain("Iran: traffic DOWN — 50% …");
    const fine = cell({ ...BASE, traffic: traffic([{ code: "JO", name: "Jordan", state: "normal", ratio: 1, why: "traffic 100% …" }]) }, "outages");
    expect(fine.led).toBe("g");
    expect(fine.detail).toContain("NetFlows: traffic normal in 1 tracked country");
    // An outage alert stays RED and the collapse rides along as detail.
    const red = cell({ ...BASE, alerts: [{ id: "outage-cf-Iran", severity: "red", title: "Nationwide outage — Iran", sub: "Cloudflare Radar: nationwide outage", aor: null }], traffic: traffic([{ code: "IR", name: "Iran", state: "collapsed", ratio: 0.1, why: "traffic COLLAPSED …" }]) }, "outages");
    expect(red.led).toBe("r");
    expect(red.detail).toContain("Iran: traffic COLLAPSED …");
    // Not configured / dead are named, never "normal".
    expect(cell({ ...BASE, traffic: traffic([], { configured: false }) }, "outages").detail).toContain("Cloudflare NetFlows not configured — traffic UNKNOWN");
    expect(cell({ ...BASE, traffic: traffic([], { live: false, failed: ["IR: HTTP 503"], reason: "IR: HTTP 503" }) }, "outages").detail).toContain("NetFlows did not answer for 1 country (IR: HTTP 503) — UNKNOWN there");
  });
});
