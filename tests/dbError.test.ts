import { describe, it, expect } from "vitest";
import { describeDbError } from "../lib/dbError";

const mysqlErr = (code: string, sqlMessage: string) => Object.assign(new Error(sqlMessage), { code, sqlMessage, errno: 1 });

describe("describeDbError", () => {
  it("names a refused row by its column — the UKMTO capture of 2026-10-26", () => {
    const f = describeDbError(mysqlErr("ER_DATA_TOO_LONG", "Data too long for column 'incident_at' at row 1"));
    expect(f.kind).toBe("rejected");
    expect(f.code).toBe("ER_DATA_TOO_LONG");
    expect(f.text).toContain("too long for column 'incident_at'");
    expect(f.text).not.toContain("unavailable");
  });
  it("names a NOT NULL violation and a missing table", () => {
    expect(describeDbError(mysqlErr("ER_BAD_NULL_ERROR", "Column 'body' cannot be null")).text).toContain("column 'body' cannot be empty");
    const t = describeDbError(mysqlErr("ER_NO_SUCH_TABLE", "Table 'dead.captured_ukmto' doesn't exist"));
    expect(t.kind).toBe("rejected");
    expect(t.text).toContain("table 'captured_ukmto'");
    expect(t.text).not.toContain("dead."); // the schema name stays in the log
  });
  it("a refused or lost connection is UNAVAILABLE", () => {
    const f = describeDbError(Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:3306"), { code: "ECONNREFUSED" }));
    expect(f.kind).toBe("unavailable");
    expect(f.text).toBe("database unavailable (ECONNREFUSED)");
    expect(f.text).not.toContain("10.0.0.5"); // never the host
    expect(describeDbError(Object.assign(new Error("x"), { code: "PROTOCOL_CONNECTION_LOST" })).kind).toBe("unavailable");
  });
  it("an unknown error carries only its code, never the message", () => {
    const f = describeDbError(Object.assign(new Error("secret host details"), { code: "ER_SOMETHING" }));
    expect(f.kind).toBe("unknown");
    expect(f.text).toBe("database error (ER_SOMETHING)");
    expect(describeDbError(new Error("plain")).text).toBe("database error");
    expect(describeDbError(null).code).toBeNull();
  });
});
