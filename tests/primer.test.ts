import { describe, it, expect } from "vitest";
import { primer } from "../lib/primer";

describe("functional-command cells (review 2026-10-28)", () => {
  it("a RED cell with a placeable door joins tier 4; an unplaceable one stays off", () => {
    const base = { nowMs: Date.now(), sinceMs: 0, mustTrack: { aors: [], countries: [], icaos: [] }, ownFields: [], posture: [], boards: [], sitreps: [], demand: [], events: [], delta: [], alerts: [], crewMismatchAors: [], convergence: null, decisionsDue: null, sourcesDown: [] };
    const p = primer({ ...base, functional: [
      { label: "USCYBERCOM", cells: [{ label: "Routing", led: "r", text: "Ukraine: cross-border hijack", door: { kind: "country", id: "Ukraine" } }] },
      { label: "USTRANSCOM", cells: [{ label: "Straits", led: "r", text: "act reported", door: { kind: "tab", id: undefined } }] },
    ] } as never);
    const fc = p.items.filter((i) => i.key.startsWith("fc:"));
    expect(fc).toHaveLength(1);
    expect(fc[0].tier).toBe(4);
    expect(fc[0].door.aor).toBe("EUCOM");
  });
});
