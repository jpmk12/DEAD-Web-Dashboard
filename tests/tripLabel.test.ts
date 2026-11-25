import { describe, it, expect } from "vitest";
import { locatedAs, tripCardLabel, labelAfterMove } from "../lib/tripLabel";

describe("tripLabel", () => {
  it("names the located place when the label does not", () => {
    expect(locatedAs("Spangdahlem", "Jordan")).toBe("Jordan");
    expect(tripCardLabel("Spangdahlem", "Jordan")).toBe("Spangdahlem (TDY · located: Jordan)");
  });
  it("stays quiet when the label names the place", () => {
    expect(tripCardLabel("Spangdahlem", "spangdahlem")).toBe("Spangdahlem (TDY)");
    expect(locatedAs("Amman", "Amman, Jordan")).toBeNull();
    expect(locatedAs("Amman, Jordan TDY", "Amman, Jordan")).toBeNull();
    expect(locatedAs("X", "")).toBeNull();
  });
  it("moves a default label with the location, keeps a typed one", () => {
    expect(labelAfterMove("Jordan", "Jordan", "Spangdahlem, Germany")).toBe("Spangdahlem, Germany");
    expect(labelAfterMove("Eager Lion", "Jordan", "Spangdahlem")).toBe("Eager Lion");
    expect(labelAfterMove("Jordan", "Jordan", "Spangdahlem", "Jordan")).toBe("Spangdahlem");
    expect(labelAfterMove("Jordan", "Jordan", "Spangdahlem", "Spang TDY")).toBe("Spang TDY");
  });
});
