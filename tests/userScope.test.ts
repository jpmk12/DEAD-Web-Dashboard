import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scopeClause, pickUserRow } from "@/lib/userScope";

// Phase 2b of the multi-user split: trips, contacts, saved items and the
// article / newsletter feedback rows are PER USER. A crew member's TDY must
// never move the owner's effective location (zone, Glance weather, brief),
// which is what an unscoped `FROM trips` read would do. The pure rule is
// pinned here, and a scan makes an unscoped query against one of those
// tables a build failure rather than a review finding.

const OWNER = "owner@example.com";
const CREW = "crew@example.com";
let saved: string | undefined;

beforeEach(() => { saved = process.env.OWNER_EMAIL; process.env.OWNER_EMAIL = OWNER; });
afterEach(() => { if (saved === undefined) delete process.env.OWNER_EMAIL; else process.env.OWNER_EMAIL = saved; });

describe("scopeClause", () => {
  it("the owner reads their own rows and the legacy '' rows", () => {
    expect(scopeClause(OWNER)).toEqual({ clause: "user_email IN (?, '')", params: [OWNER] });
  });
  it("a crew member reads only their own rows — never the legacy ones", () => {
    expect(scopeClause(CREW)).toEqual({ clause: "user_email = ?", params: [CREW] });
  });
  it("an empty email matches nothing legacy", () => {
    expect(scopeClause("")).toEqual({ clause: "user_email = ?", params: [""] });
  });
});

describe("pickUserRow", () => {
  const rows = [{ user_email: "", v: "legacy" }, { user_email: OWNER, v: "owner" }];
  it("the exact row wins", () => { expect(pickUserRow(rows, OWNER)?.v).toBe("owner"); });
  it("the owner falls back to the legacy row", () => {
    expect(pickUserRow([{ user_email: "", v: "legacy" }], OWNER)?.v).toBe("legacy");
  });
  it("a crew member never inherits the legacy row", () => {
    expect(pickUserRow([{ user_email: "", v: "legacy" }], CREW)).toBeUndefined();
  });
});

const PER_USER = ["trips", "contacts", "saved_items", "article_prefs", "newsletter_prefs"];
const TOUCHES = new RegExp(`\\b(?:FROM|INTO|UPDATE)\\s+(?:${PER_USER.join("|")})\\b`, "i");
// Deliberately global: the retention prune deletes trips a year past their end
// for everyone. Any other unscoped statement is a cross-user leak.
const ALLOWED = [/DELETE FROM trips WHERE end_date < \?/];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules" && name !== ".next") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
}

describe("per-user table discipline", () => {
  it("every query against a per-user table is scoped to the user", () => {
    const files: string[] = [];
    for (const r of ["app", "lib"]) walk(join(process.cwd(), r), files);
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith("lib/db.ts")) continue; // schema + migrations
      const src = readFileSync(f, "utf8");
      // String literals: backtick templates and double-quoted SQL.
      for (const m of src.matchAll(/`[^`]*`|"(?:[^"\\\n]|\\.)*"/g)) {
        const lit = m[0];
        if (!TOUCHES.test(lit)) continue;
        if (/user_email|\$\{sc\.clause\}/.test(lit)) continue;
        if (ALLOWED.some((rx) => rx.test(lit))) continue;
        offenders.push(`${f.replace(process.cwd() + "/", "")}: ${lit.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
