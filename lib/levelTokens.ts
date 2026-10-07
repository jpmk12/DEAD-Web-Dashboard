// The level / LED / flight-category display tokens — one home.
//
// PURE, client-safe, unit-tested (tests/levelTokens.test.ts). Same rule as
// lib/icons.tsx and lib/severity.ts: "change it here, not at call sites, so
// one value keeps one meaning."
//
// Before this file the I&W level pill lived in four components (WarningBoard,
// EconomicWarfareBoard, EconomicAccessPanel, boardBits) with two different
// ALERT treatments, the SITREP LED colours in six, and the flight-category
// hex in three with two different MVFR blues. Each copy was self-consistent,
// so nothing was visibly broken — but the same level rendered differently
// depending on which pane you read it on, which is the opposite of what a
// colour vocabulary is for.
//
// Disciplines, in the words of the house rules:
//   · colour is EARNED — calm is slate, red is reserved for ALERT / red;
//   · UNKNOWN is its own tone (slate-600), never folded into green;
//   · these are DISPLAY tokens only. Nothing here ranks or compares levels —
//     that is lib/warning (I&W) and lib/severity (force posture).

/** The I&W warning level vocabulary (mirrors `WarningLevel` in lib/warning;
 *  declared here so this module imports nothing). */
export type Level = "calm" | "watch" | "warning" | "alert";

/** The level pill (text + border + background). ALERT is the one solid fill. */
export const LEVEL_PILL: Record<Level, string> = {
  calm: "text-slate-400 border-slate-600 bg-slate-500/10",
  watch: "text-amber-300 border-amber-500/55 bg-amber-500/[0.12]",
  warning: "text-orange-300 border-orange-500/55 bg-orange-500/[0.12]",
  alert: "text-white border-red-500 bg-red-500/80",
};

export const LEVEL_LABEL: Record<Level, string> = { calm: "Calm", watch: "Watch", warning: "Warning", alert: "Alert" };

/** The card border + glow for a board at each level. */
export const CARD_ACCENT: Record<Level, string> = {
  calm: "border-slate-800",
  watch: "border-amber-500/40 shadow-[0_0_18px_-6px_rgba(245,158,11,0.3)]",
  warning: "border-orange-500/45 shadow-[0_0_18px_-6px_rgba(249,115,22,0.35)]",
  alert: "border-red-500/60 shadow-[0_0_20px_-6px_rgba(239,68,68,0.45)]",
};

/** SITREP LED letters: g green · a amber · r red · u unknown. */
export type LedKey = "g" | "a" | "r" | "u";

/** Tailwind background for an LED dot. */
export const LED_CLASS: Record<LedKey, string> = {
  g: "bg-emerald-500",
  a: "bg-amber-400",
  r: "bg-red-500",
  u: "bg-slate-600",
};

/** The optional glow for a LARGE LED (the SITREP status strip, the brief's
 *  base block). Compose with LED_CLASS; UNKNOWN never glows. */
export const LED_GLOW: Record<LedKey, string> = {
  g: "shadow-[0_0_8px] shadow-emerald-500/70",
  a: "shadow-[0_0_8px] shadow-amber-400/70",
  r: "shadow-[0_0_8px] shadow-red-500/70",
  u: "",
};

/** Hex for SVG / inline style where a Tailwind class cannot reach. */
export const LED_HEX: Record<LedKey, string> = {
  g: "#10b981",
  a: "#fbbf24",
  r: "#ef4444",
  u: "#475569",
};

/** Flight-category hex (standard aviation colours: VFR green, MVFR blue,
 *  IFR red, LIFR magenta; UNKNOWN slate — "no ring = unknown"). */
export const FLIGHT_CAT_HEX: Record<"VFR" | "MVFR" | "IFR" | "LIFR" | "UNKNOWN", string> = {
  VFR: "#10b981",
  MVFR: "#38bdf8",
  IFR: "#ef4444",
  LIFR: "#d946ef",
  UNKNOWN: "#475569",
};
