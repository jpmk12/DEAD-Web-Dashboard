import { describe, it, expect } from "vitest";
import { messagesToMarkRead } from "../lib/familyMarkRead";
import { sanitizeFamilyProfile } from "../lib/familyProfile";

describe("messagesToMarkRead", () => {
  const read = ["m1", "m2", "m3", "m4"];

  it("marks everything the model read when the pass succeeded and nothing needs the user's eyes", () => {
    expect(messagesToMarkRead({ read, keep: [], ok: true, enabled: true })).toEqual(read);
  });

  it("leaves mail whose finding sends the user to the email itself unread", () => {
    expect(messagesToMarkRead({ read, keep: ["m2", "m4"], ok: true, enabled: true })).toEqual(["m1", "m3"]);
  });

  it("marks NOTHING when the model pass failed — the inbox badge is the last safety net", () => {
    expect(messagesToMarkRead({ read, keep: [], ok: false, enabled: true })).toEqual([]);
  });

  it("marks nothing when the roster switch is off", () => {
    expect(messagesToMarkRead({ read, keep: [], ok: true, enabled: false })).toEqual([]);
  });

  it("dedupes and skips empty ids, keeping input order", () => {
    expect(messagesToMarkRead({ read: ["b", "", "a", "b"], keep: [], ok: true, enabled: true })).toEqual(["b", "a"]);
  });

  it("accepts a Set for keep", () => {
    expect(messagesToMarkRead({ read, keep: new Set(["m1"]), ok: true, enabled: true })).toEqual(["m2", "m3", "m4"]);
  });
});

describe("FamilyProfile.markRead", () => {
  it("defaults on and honours an explicit false", () => {
    expect(sanitizeFamilyProfile({}).markRead).toBe(true);
    expect(sanitizeFamilyProfile({ markRead: false }).markRead).toBe(false);
    // Anything that is not literally false stays on — a malformed value must
    // not silently switch inbox behaviour.
    expect(sanitizeFamilyProfile({ markRead: "no" }).markRead).toBe(true);
  });
});
