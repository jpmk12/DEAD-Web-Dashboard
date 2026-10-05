import { describe, it, expect } from "vitest";
import { postureTarget } from "../lib/postureTarget";
import type { ForceAssessment } from "../lib/forceProtection";

const mk = (o: Partial<ForceAssessment> & { id: string; composite: ForceAssessment["composite"] }): ForceAssessment =>
  ({ label: o.id, country: o.id, cocom: "CENTCOM", kind: "country", lat: 0, lon: 0, topDriver: "", categories: [], ...o } as unknown as ForceAssessment);

describe("postureTarget — the Posture tile lands where its colour was earned", () => {
  it("returns null for an empty watch", () => {
    expect(postureTarget([])).toBeNull();
  });

  it("a RED that escalated today beats a standing RED, whatever the list order", () => {
    const list = [
      mk({ id: "Russia", composite: "red" }),
      mk({ id: "Jordan", composite: "red", previousComposite: "amber" }),
    ];
    expect(postureTarget(list)?.id).toBe("Jordan");
  });

  it("a non-chronic RED beats a chronic one; a chronic escalation still beats a standing non-chronic RED", () => {
    const chronicNew = mk({ id: "Iraq", composite: "red", previousComposite: "amber", chronicity: { state: "chronic" } as ForceAssessment["chronicity"] });
    const standing = mk({ id: "Yemen", composite: "red" });
    expect(postureTarget([chronicNew, standing])?.id).toBe("Iraq");
    const chronicStanding = mk({ id: "Syria", composite: "red", chronicity: { state: "chronic" } as ForceAssessment["chronicity"] });
    expect(postureTarget([chronicStanding, standing])?.id).toBe("Yemen");
  });

  it("with no RED, lands on the worst level present — amber over unknown over green", () => {
    const list = [mk({ id: "A", composite: "green" }), mk({ id: "B", composite: "unknown" }), mk({ id: "C", composite: "amber" })];
    expect(postureTarget(list)?.id).toBe("C");
    expect(postureTarget([mk({ id: "A", composite: "green" }), mk({ id: "B", composite: "unknown" })])?.id).toBe("B");
  });

  it("an easing (red → amber) is not an escalation", () => {
    const eased = mk({ id: "Eased", composite: "amber", previousComposite: "red" });
    const red = mk({ id: "Red", composite: "red" });
    expect(postureTarget([eased, red])?.id).toBe("Red");
  });
});
