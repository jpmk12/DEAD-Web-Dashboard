import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The backstop for the rule in CLAUDE.md ("Any route that asks the model for
// a JSON object must parse through `parseModelJson` / `salvageJsonObject`,
// never bare `JSON.parse(extractJsonObject(...))`"). The Economy read lost
// every reply for a week to a cut-off tail (2026-10-06); the Threads read
// failed the same way on 2026-10-25 because the fix was applied to one route
// and the rule lived only in prose. A rule the test suite does not enforce
// is advice; this makes it a build failure.

const ROOTS = ["app", "lib", "components"];
const BARE = /JSON\.parse\(\s*extractJsonObject\(/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules" && name !== ".next") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
}

describe("model-JSON discipline", () => {
  it("no route or lib parses a model object with bare JSON.parse(extractJsonObject(...))", () => {
    const files: string[] = [];
    for (const r of ROOTS) walk(join(process.cwd(), r), files);
    // lib/aiJson.ts is the door itself — its doc comment names the bare form it forbids.
    const offenders = files.filter((f) => !f.endsWith("lib/aiJson.ts") && BARE.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(process.cwd() + "/", ""))).toEqual([]);
  });
});
