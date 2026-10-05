import { describe, it, expect } from "vitest";
import { detectPostureMoves, mergePostureMoves, newsletterBulletsAsItems } from "../lib/postureMoves";
import type { NewsItem } from "../lib/types";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const item = (title: string, o: Partial<NewsItem> = {}): NewsItem =>
  ({ id: o.id ?? title, title, source: o.source ?? "Defense News", category: "defense", pubDate: o.pubDate ?? "2026-10-05T08:00:00Z", summary: o.summary ?? "", link: o.link ?? "https://example.org/x" });

describe("detectPostureMoves — phrases with a force-noun gate", () => {
  it("reads a U.S. carrier deployment to the Gulf as a CENTCOM deployment by the U.S.", () => {
    const [m] = detectPostureMoves([item("Pentagon orders carrier strike group to the Middle East amid Iran tensions")], NOW);
    expect(m).toBeDefined();
    expect(m.kind).toBe("deploy");
    expect(m.actor).toBe("United States");
    expect(m.side).toBe("us");
    expect(m.aor).toBe("CENTCOM");
    expect(m.corroborated).toBe(false);
    expect(m.falsifier.length).toBeGreaterThan(10);
  });

  it("ignores a 'deploys' with no force noun (a software release is not a posture move)", () => {
    expect(detectPostureMoves([item("Startup deploys new AI model to customers")], NOW)).toEqual([]);
  });

  it("attributes by proximity: the force nearest before the phrase is the mover", () => {
    const [m] = detectPostureMoves([item("Iran on high alert as US deploys B-52 bombers to the region")], NOW);
    // "high alert" (mobilize) comes first in KIND_ORDER and sits after "Iran".
    expect(m.kind).toBe("mobilize");
    expect(m.actor).toBe("Iran");
    expect(m.side).toBe("adversary");
  });

  it("does not let the mover's own country place the move", () => {
    const [m] = detectPostureMoves([item("Russia deploys bombers to Venezuela for joint patrols")], NOW);
    expect(m.actor).toBe("Russia");
    expect(m.aor).toBe("SOUTHCOM");
  });

  it("corroborates when two distinct sources report the same (kind, actor, AOR)", () => {
    const moves = detectPostureMoves([
      item("China sends warships near Taiwan in large-scale drills", { source: "Reuters", id: "a" }),
      item("PLA deploys destroyers around Taiwan", { source: "USNI News", id: "b", pubDate: "2026-10-05T09:00:00Z" }),
      item("China sends warships toward Taiwan", { source: "Reuters", id: "c" }),
    ], NOW);
    const deploy = moves.find((m) => m.kind === "deploy" && m.actor === "China");
    expect(deploy?.sources).toBe(2);
    expect(deploy?.corroborated).toBe(true);
    expect(deploy?.aor).toBe("INDOPACOM");
    expect(moves[0]).toBe(deploy);
  });

  it("drops reporting older than 14 days — a move is news, not posture", () => {
    expect(detectPostureMoves([item("US sends troops to the border", { pubDate: "2026-09-10T00:00:00Z" })], NOW)).toEqual([]);
  });

  it("reads a withdrawal as a withdrawal, and an exercise as an exercise", () => {
    const [w] = detectPostureMoves([item("US to withdraw troops from Syria base, officials say")], NOW);
    expect(w.kind).toBe("withdraw");
    const [e] = detectPostureMoves([item("Japan and US launch joint military exercise in Okinawa")], NOW);
    expect(e.kind).toBe("exercise");
    expect(e.aor).toBe("INDOPACOM");
  });

  it("keeps an unattributed move, saying so", () => {
    const [m] = detectPostureMoves([item("Reservists called up as region braces for conflict")], NOW);
    expect(m.kind).toBe("mobilize");
    expect(m.actor).toBe("unattributed");
  });
});

describe("mergePostureMoves / newsletterBulletsAsItems", () => {
  it("merges the server sweep with the client's reading, summing distinct sources", () => {
    const a = detectPostureMoves([item("US deploys additional fighters to the Middle East", { source: "Breaking Defense" })], NOW);
    const b = detectPostureMoves([item("Pentagon sends more fighter jets to the Gulf", { source: "Reuters" })], NOW);
    const merged = mergePostureMoves(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toBe(2);
    expect(merged[0].corroborated).toBe(true);
  });

  it("turns newsletter bullets into readable items dated by the newsletter", () => {
    const items = newsletterBulletsAsItems([{ id: "n1", subject: "Morning D", date: "2026-10-05T06:00:00Z", bullets: ["The Navy is sending a second carrier to the Red Sea as Houthi attacks resume.", "short"], source: "politico", account: "primary", accountEmail: "" }]);
    expect(items).toHaveLength(1);
    const [m] = detectPostureMoves(items, NOW);
    expect(m.kind).toBe("deploy");
    expect(m.aor).toBe("CENTCOM");
    expect(m.source).toMatch(/newsletter/);
  });
});
