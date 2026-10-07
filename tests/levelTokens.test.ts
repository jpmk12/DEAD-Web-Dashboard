import { describe, it, expect } from "vitest";
import {
  LEVEL_PILL, LEVEL_LABEL, CARD_ACCENT, LED_CLASS, LED_GLOW, LED_HEX, FLIGHT_CAT_HEX,
} from "../lib/levelTokens";

describe("level pills", () => {
  it("covers every level once, calm first", () => {
    expect(Object.keys(LEVEL_PILL)).toEqual(["calm", "watch", "warning", "alert"]);
    expect(Object.keys(LEVEL_LABEL)).toEqual(Object.keys(LEVEL_PILL));
    expect(Object.keys(CARD_ACCENT)).toEqual(Object.keys(LEVEL_PILL));
  });

  it("reserves red for ALERT — and makes it the one solid fill", () => {
    expect(LEVEL_PILL.alert).toBe("text-white border-red-500 bg-red-500/80");
    for (const lvl of ["calm", "watch", "warning"] as const) {
      expect(LEVEL_PILL[lvl]).not.toMatch(/red/);
      expect(CARD_ACCENT[lvl]).not.toMatch(/red/);
    }
  });

  it("keeps calm colourless — colour is earned", () => {
    expect(LEVEL_PILL.calm).toMatch(/slate/);
    expect(CARD_ACCENT.calm).toBe("border-slate-800");
    expect(CARD_ACCENT.calm).not.toMatch(/shadow/);
  });

  it("labels are the capitalised level names", () => {
    expect(LEVEL_LABEL).toEqual({ calm: "Calm", watch: "Watch", warning: "Warning", alert: "Alert" });
  });
});

describe("LEDs", () => {
  it("pins the four classes", () => {
    expect(LED_CLASS).toEqual({ g: "bg-emerald-500", a: "bg-amber-400", r: "bg-red-500", u: "bg-slate-600" });
  });

  it("pins the four hex values, matching the classes' Tailwind shades", () => {
    expect(LED_HEX).toEqual({ g: "#10b981", a: "#fbbf24", r: "#ef4444", u: "#475569" });
  });

  it("UNKNOWN is its own tone — slate, and it never glows", () => {
    expect(LED_CLASS.u).not.toMatch(/emerald|green/);
    expect(LED_GLOW.u).toBe("");
    for (const k of ["g", "a", "r"] as const) expect(LED_GLOW[k]).toMatch(/shadow/);
  });
});

describe("flight categories", () => {
  it("pins the standard aviation colours with ONE MVFR blue", () => {
    expect(FLIGHT_CAT_HEX).toEqual({
      VFR: "#10b981", MVFR: "#38bdf8", IFR: "#ef4444", LIFR: "#d946ef", UNKNOWN: "#475569",
    });
  });

  it("shares green / red / slate with the LEDs so one colour keeps one meaning", () => {
    expect(FLIGHT_CAT_HEX.VFR).toBe(LED_HEX.g);
    expect(FLIGHT_CAT_HEX.IFR).toBe(LED_HEX.r);
    expect(FLIGHT_CAT_HEX.UNKNOWN).toBe(LED_HEX.u);
  });
});
