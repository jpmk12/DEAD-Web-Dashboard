import { describe, it, expect } from "vitest";
import { parseNavWarnings, navPositions, navShapes, navWarnClass } from "@/lib/navWarnParse";

const missile = "EASTERN MEDITERRANEAN SEA.\nCYPRUS.\n1. HAZARDOUS OPERATIONS, MISSILE FIRING, 0600Z TO 1500Z DAILY 06 THRU 08 NOV IN AREA BOUND BY 34-30.00N 032-00.00E, 34-30.00N 033-00.00E, 34-00.00N 033-00.00E, 34-00.00N 032-00.00E.\n2. CANCEL THIS MSG 081600Z NOV 26.";
const rocket = "WESTERN NORTH PACIFIC.\nCHINA.\n1. HAZARDOUS OPERATIONS, ROCKET LAUNCHING, SPACE DEBRIS 0500Z TO 0630Z DAILY 07 THRU 10 NOV IN AREAS BOUND BY:\nA. 26-12N 124-41E, 26-12N 125-15E, 25-30N 125-15E, 25-30N 124-41E.\nB. 21-00N 130-00E, 21-00N 131-00E, 20-00N 131-00E.";
const circle = "PERSIAN GULF.\n1. GNSS INTERFERENCE TESTING WITHIN 30 MILES OF 26-30.00N 052-15.00E 0400Z TO 1200Z DAILY.";
const wreck = "GULF OF MEXICO.\n1. DANGEROUS WRECK 28-10.00N 089-40.00W.";

describe("positions and shapes", () => {
  it("reads DD-MM.mm and DD-MM forms with hemispheres", () => {
    const p = navPositions("34-30.00N 032-00.00E, 26-12N 124-41E, 12-30S 045-15W");
    expect(p.map((x) => x.at)).toEqual([[34.5, 32], [26.2, 124.6833], [-12.5, -45.25]]);
  });
  it("one polygon per BOUND BY list; two areas, two polygons", () => {
    expect(navShapes(missile)).toEqual([{ kind: "polygon", points: [[34.5, 32], [34.5, 33], [34, 33], [34, 32]] }]);
    const r = navShapes(rocket);
    // "AREAS BOUND BY: A. … B. …" — each lettered area is its own polygon, never one ring across both.
    expect(r.map((x) => `${x.kind}:${x.points.length}`)).toEqual(["polygon:4", "polygon:3"]);
  });
  it("WITHIN n MILES OF a point is a circle", () => {
    expect(navShapes(circle)).toEqual([{ kind: "circle", points: [[26.5, 52.25]], radiusNm: 30 }]);
  });
  it("text with no position has no shape (never placed)", () => {
    expect(navShapes("NORTH ATLANTIC. 1. CABLE OPERATIONS IN PROGRESS.")).toEqual([]);
  });
});

describe("classes", () => {
  it("operational classes", () => {
    expect(navWarnClass(missile)).toBe("firing");
    expect(navWarnClass(rocket)).toBe("launch debris");
    expect(navWarnClass(circle)).toBe("gnss");
    expect(navWarnClass("GULF OF ADEN. 1. PIRACY ATTACK REPORTED.")).toBe("security");
    expect(navWarnClass("BALTIC SEA. 1. MINE DANGER AREA.")).toBe("mines / ordnance");
    expect(navWarnClass(wreck)).toBe("nav hazard");
  });
});

describe("the response", () => {
  const body = { "broadcast-warn": [
    { msgYear: 2026, msgNumber: 1201, navArea: "P", status: "A", issueDate: "050900Z NOV 2026", text: rocket },
    { msgYear: 2026, msgNumber: 455, navArea: "A", status: "A", issueDate: "041200Z NOV 2026", text: missile },
    { msgYear: 2026, msgNumber: 456, navArea: "4", status: "A", text: wreck },
    { msgYear: 2026, msgNumber: 457, navArea: "A", status: "C", text: missile },
    { msgYear: 2026, msgNumber: 458, navArea: "A", status: "A", text: "NORTH ATLANTIC. 1. NAVAL EXERCISE IN PROGRESS." },
  ] };
  const p = parseNavWarnings(body);
  it("draws operational classes with a position; counts the rest", () => {
    expect(p.rows).toBe(5);
    expect(p.warnings.map((w) => `${w.area} ${w.number} ${w.cls}`)).toEqual(["HYDROPAC 1201/2026 launch debris", "HYDROLANT 455/2026 firing"]);
    expect(p.byClass["nav hazard"]).toBe(1);
    expect(p.unplaced).toBe(1); // the exercise with no position
  });
  it("names the place from the first line", () => {
    expect(p.warnings[1].where).toBe("EASTERN MEDITERRANEAN SEA.");
    expect(p.warnings[0].tone).toBe("amber");
  });
});
