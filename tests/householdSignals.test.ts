import { describe, it, expect } from "vitest";
import {
  silenceWatch, amountDelta, isAmountNotable, documentRunway, runwayPct,
  maskAccount, formatUsdCents, sortBills, cadenceDays, type BillSighting,
} from "../lib/householdSignals";
import { sanitizeFamilyProfile, type FamilyBiller } from "../lib/familyProfile";

const NOW = Date.UTC(2026, 8, 27, 12, 0);          // 2026-09-27
const day = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * day).toISOString().slice(0, 10);

const biller = (id: string, cadence: FamilyBiller["cadence"], autopay = false): FamilyBiller =>
  ({ id, pattern: `${id}.com`, label: id, cadence, autopay });

const sight = (billerId: string, daysAgo: number, amountCents: number | null = 1000): BillSighting =>
  ({ billerId, seenISO: iso(daysAgo), amountCents });

describe("silenceWatch", () => {
  const water = biller("water", "monthly");

  it("flags a monthly biller that has gone well past its cycle", () => {
    const out = silenceWatch([water], [sight("water", 130), sight("water", 100), sight("water", 70)], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].daysQuiet).toBe(70);
    expect(out[0].missedCycles).toBe(2);
    expect(out[0].lastSeenISO).toBe(iso(70));
  });

  it("stays quiet inside the cadence plus its slack — one late statement is normal", () => {
    // 38 days out on a monthly cadence: past 31, inside the 10-day slack.
    expect(silenceWatch([water], [sight("water", 98), sight("water", 68), sight("water", 38)], NOW)).toEqual([]);
  });

  it("says nothing below three sightings — quarterly and 'stopped' look identical", () => {
    expect(silenceWatch([water], [sight("water", 200), sight("water", 170)], NOW)).toEqual([]);
    expect(silenceWatch([water], [], NOW)).toEqual([]);
  });

  it("never claims anything about an irregular biller", () => {
    const odd = biller("odd", "irregular");
    expect(cadenceDays("irregular")).toBeNull();
    expect(silenceWatch([odd], [sight("odd", 400), sight("odd", 300), sight("odd", 200)], NOW)).toEqual([]);
  });

  it("uses the right window per cadence and sorts the quietest first", () => {
    const hoa = biller("hoa", "quarterly");
    const q = [sight("hoa", 400), sight("hoa", 300), sight("hoa", 200)];
    const w = [sight("water", 130), sight("water", 100), sight("water", 70)];
    const out = silenceWatch([water, hoa], [...w, ...q], NOW);
    expect(out.map((x) => x.biller.id)).toEqual(["hoa", "water"]);   // 200d quiet before 70d
  });
});

describe("amountDelta", () => {
  it("reports a percentage against the trailing average", () => {
    const d = amountDelta(18422, [13000, 13500, 12800, 13700])!;
    expect(d.samples).toBe(4);
    expect(d.averageCents).toBe(13250);
    expect(d.pct).toBe(39);
    expect(isAmountNotable(d)).toBe(true);
  });

  it("returns null below three prior samples rather than a misleading number", () => {
    expect(amountDelta(18422, [13000, 13500])).toBeNull();
    expect(amountDelta(18422, [])).toBeNull();
    expect(amountDelta(null, [13000, 13500, 12800])).toBeNull();
  });

  it("ignores a small seasonal swing", () => {
    expect(isAmountNotable(amountDelta(10800, [10000, 10100, 9900]))).toBe(false);  // +8%
    expect(isAmountNotable(null)).toBe(false);
  });

  it("skips null and zero priors instead of dragging the average down", () => {
    const d = amountDelta(12000, [10000, null, 0, 10200, 9800])!;
    expect(d.samples).toBe(3);
    expect(d.averageCents).toBe(10000);
  });
});

describe("documentRunway", () => {
  const docs = sanitizeFamilyProfile({
    documents: [
      { label: "Passport — Emma", expiresISO: "2027-02-14", leadDays: 183 },
      { label: "Registration", expiresISO: "2026-10-31" },
      { label: "Licence", expiresISO: "2029-03-02" },
      { label: "Broken", expiresISO: "not-a-date" },
    ],
  }).documents;

  it("drops a document with no usable expiry", () => {
    expect(docs.map((d) => d.label)).not.toContain("Broken");
  });

  it("applies leadDays so the passport is urgent before it expires", () => {
    const out = documentRunway(docs, NOW);
    const passport = out.find((r) => r.doc.label.startsWith("Passport"))!;
    expect(passport.daysLeft).toBe(140);
    expect(passport.actionableDaysLeft).toBe(-43);   // already unusable for travel
    expect(passport.level).toBe("red");
  });

  it("sorts by the actionable date, not the printed one", () => {
    const out = documentRunway(docs, NOW);
    // Registration expires FIRST on paper (34d) but the passport is already
    // past its usable window, so it must lead.
    expect(out.map((r) => r.doc.label)).toEqual(["Passport — Emma", "Registration", "Licence"]);
    expect(out[1].level).toBe("red");     // 34 days
    expect(out[2].level).toBe("calm");    // years out
  });

  it("runwayPct stays inside the track and never reads as empty when time remains", () => {
    expect(runwayPct(-40)).toBe(0);
    expect(runwayPct(1)).toBe(2);
    expect(runwayPct(180)).toBe(49);
    expect(runwayPct(9999)).toBe(100);
  });
});

describe("formatting and ordering", () => {
  it("masks an account to the last four", () => {
    expect(maskAccount("1234567890")).toBe("····7890");
    expect(maskAccount("Acct # 4471")).toBe("····4471");
    expect(maskAccount("n/a")).toBe("····");
  });

  it("formats money and an absent amount", () => {
    expect(formatUsdCents(184_22)).toBe("$184.22");
    expect(formatUsdCents(241000)).toBe("$2,410.00");
    expect(formatUsdCents(null)).toBe("—");
  });

  it("puts manual bills before autopay regardless of due date", () => {
    const out = sortBills([
      { autopay: true, dueISO: "2026-10-01", id: "auto-soon" },
      { autopay: false, dueISO: "2026-10-20", id: "manual-later" },
      { autopay: false, dueISO: "2026-10-08", id: "manual-soon" },
      { autopay: true, dueISO: null, id: "auto-undated" },
    ]);
    expect(out.map((b) => b.id)).toEqual(["manual-soon", "manual-later", "auto-soon", "auto-undated"]);
  });
});
