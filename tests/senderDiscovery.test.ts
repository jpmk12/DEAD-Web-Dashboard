import { describe, it, expect } from "vitest";
import {
  discoverSenders, discoveryQuery, alreadyDeclared, domainOf, nameOf, addressOf,
  dismissKey, MIN_SIGHTINGS,
} from "../lib/senderDiscovery";
import type { ObservedSender } from "../lib/senderDiscovery";

const msg = (from: string, subject: string): ObservedSender => ({ from, subject });

const xcel = (subject: string) => msg('"Xcel Energy" <no-reply@xcelenergy.com>', subject);

describe("header parsing", () => {
  it("pulls address, domain and display name out of a From line", () => {
    expect(addressOf('"Xcel Energy" <no-reply@xcelenergy.com>')).toBe("no-reply@xcelenergy.com");
    expect(domainOf('"Xcel Energy" <no-reply@xcelenergy.com>')).toBe("xcelenergy.com");
    expect(nameOf('"Xcel Energy" <no-reply@xcelenergy.com>')).toBe("Xcel Energy");
    expect(nameOf("no-reply@xcelenergy.com")).toBe("xcelenergy.com");
  });

  it("returns null on something that is not an address", () => {
    expect(domainOf("not an address")).toBeNull();
    expect(domainOf("")).toBeNull();
    expect(addressOf("nope")).toBeNull();
  });
});

describe("alreadyDeclared", () => {
  it("treats a bare pattern as covering itself and below", () => {
    // Otherwise we would propose mail.oakwood.org to someone who declared
    // oakwood.org — the same matching the roster itself uses.
    expect(alreadyDeclared("oakwood.org", ["oakwood.org"])).toBe(true);
    expect(alreadyDeclared("mail.oakwood.org", ["oakwood.org"])).toBe(true);
    expect(alreadyDeclared("oakwood.org.uk", ["oakwood.org"])).toBe(false);
    expect(alreadyDeclared("other.org", ["oakwood.org"])).toBe(false);
  });

  it("reads the domain out of an address pattern", () => {
    expect(alreadyDeclared("oakwood.org", ["principal@oakwood.org"])).toBe(true);
  });

  it("ignores blank patterns", () => {
    expect(alreadyDeclared("oakwood.org", ["", "  "])).toBe(false);
  });
});

describe("discoverSenders — what must be earned", () => {
  it("proposes a domain with billing-shaped subjects", () => {
    const r = discoverSenders([xcel("Your statement is ready"), xcel("Amount due 14 Oct")], []);
    expect(r).toHaveLength(1);
    expect(r[0].domain).toBe("xcelenergy.com");
    expect(r[0].category).toBe("biller");
    expect(r[0].reason).toMatch(/2 messages mentioning/);
  });

  it("never proposes on volume alone — a chatty sender is not a biller", () => {
    const chatty = Array.from({ length: 20 }, (_, i) => msg("news@blog.com", `Post number ${i}`));
    expect(discoverSenders(chatty, [])).toEqual([]);
  });

  it("requires more than one sighting", () => {
    // A one-off receipt from a shop you never hear from again should not become
    // a permanent suggestion.
    expect(discoverSenders([xcel("Your statement is ready")], [])).toEqual([]);
    expect(MIN_SIGHTINGS).toBeGreaterThanOrEqual(2);
  });

  it("never proposes a free mail host", () => {
    // That is a person, and adding the domain as a pattern would pull in
    // unrelated mail wholesale.
    const r = discoverSenders([
      msg("aunt@gmail.com", "Your statement is ready"),
      msg("aunt@gmail.com", "Amount due"),
    ], []);
    expect(r).toEqual([]);
  });

  it("skips what is already declared", () => {
    expect(discoverSenders([xcel("Your statement"), xcel("Amount due")], ["xcelenergy.com"])).toEqual([]);
  });

  it("honours a dismissal permanently", () => {
    const obs = [xcel("Your statement"), xcel("Amount due")];
    expect(discoverSenders(obs, [], [dismissKey("xcelenergy.com")])).toEqual([]);
  });

  it("classifies a school sender as school, not biller", () => {
    const r = discoverSenders([
      msg("office@oakwood.org", "Weekly newsletter — field trip permission slip"),
      msg("office@oakwood.org", "Report card is available"),
    ], []);
    expect(r[0].category).toBe("school");
  });

  it("recognises a kids' activity — the bucket whose signups close quietly", () => {
    const r = discoverSenders([
      msg("info@swimclub.org", "Fall registration is open — sign up by Friday"),
      msg("info@swimclub.org", "Practice schedule and meet schedule posted"),
    ], []);
    expect(r[0].category).toBe("activity");
    expect(r[0].reason).toMatch(/messages mentioning/);
  });

  it("recognises medical, travel and admin senders", () => {
    const cases: [string, string, string, string][] = [
      ["a@peds.com", "Appointment reminder for Emma", "Test results are ready", "medical"],
      ["b@air.com", "Your itinerary for BWI", "Check-in opens in 24 hours", "travel"],
      ["c@dmv.gov", "Vehicle registration renewal", "Your license expires soon", "admin"],
    ];
    for (const [from, s1, s2, want] of cases) {
      const r = discoverSenders([msg(from, s1), msg(from, s2)], []);
      expect(r[0]?.category, `${from} → ${want}`).toBe(want);
    }
  });

  it("marks a close call rather than resolving it silently", () => {
    // A club that bills AND schedules is genuinely ambiguous. Mis-filing it
    // costs one click on the row's dropdown; leaving it silently wrong does not.
    const r = discoverSenders([
      msg("x@club.org", "Dues are due — your statement is ready"),
      msg("x@club.org", "Season schedule posted"),
    ], []);
    expect(r[0].confidence).toBe("close");
    expect(r[0].alternate).toBeDefined();
    expect(r[0].alternate).not.toBe(r[0].category);
  });

  it("calls it clear when one category wins outright", () => {
    const r = discoverSenders([
      msg("y@utility.com", "Your statement is ready"),
      msg("y@utility.com", "Amount due and autopay scheduled — new invoice"),
    ], []);
    expect(r[0].category).toBe("biller");
    expect(r[0].confidence).toBe("clear");
    expect(r[0].alternate).toBeUndefined();
  });

  it("scores distinct phrases, not repetitions, so a repeater cannot win on volume", () => {
    const repeater = Array.from({ length: 9 }, () => msg("z@one.com", "Your statement is ready"));
    const varied = [
      msg("w@two.com", "Registration is open — tryouts announced"),
      msg("w@two.com", "Practice schedule and recital details"),
    ];
    const r = discoverSenders([...repeater, ...varied], []);
    expect(r[0].domain).toBe("two.com");   // 4 distinct activity phrases beats 1 billing phrase ×9
  });

  it("is word-bounded, so a phrase inside a longer word does not count", () => {
    const r = discoverSenders([
      msg("x@billingsgazette.com", "Billingsgazette headlines"),
      msg("x@billingsgazette.com", "More headlines"),
    ], []);
    expect(r).toEqual([]);
  });

  it("ranks by evidence then volume, and caps", () => {
    const strong = [
      msg("a@one.com", "Your statement is ready — amount due"),
      msg("a@one.com", "Autopay scheduled · invoice attached"),
    ];
    const weak = Array.from({ length: 9 }, () => msg("b@two.com", "Your receipt"));
    const r = discoverSenders([...weak, ...strong], []);
    expect(r[0].domain).toBe("one.com");
    expect(discoverSenders([...weak, ...strong], [], [], { max: 1 })).toHaveLength(1);
  });

  it("keeps at most two example subjects", () => {
    const r = discoverSenders([xcel("S one"), xcel("Your statement"), xcel("S three"), xcel("Amount due")], []);
    expect(r[0].examples).toHaveLength(2);
  });
});

describe("discoveryQuery", () => {
  it("is subject-shaped and window-capped, not a mailbox sweep", () => {
    const q = discoveryQuery(["xcelenergy.com"], 120);
    expect(q).toMatch(/subject:\(statement\)/);
    expect(q).toMatch(/newer_than:120d/);
    // Excludes what is already declared, so results are only ever new proposals.
    expect(q).toMatch(/-from:\(@xcelenergy\.com\)/);
  });

  it("clamps an absurd window", () => {
    expect(discoveryQuery([], 9999)).toMatch(/newer_than:365d/);
    expect(discoveryQuery([], 0)).toMatch(/newer_than:7d/);
  });

  it("works with no declared patterns", () => {
    expect(discoveryQuery([])).toMatch(/newer_than:120d/);
  });
});
