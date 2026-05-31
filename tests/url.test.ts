import { describe, it, expect } from "vitest";
import { safeHttpHref } from "@/lib/url";

describe("safeHttpHref", () => {
  it("allows http and https URLs", () => {
    expect(safeHttpHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpHref("http://example.com")).toBe("http://example.com");
    expect(safeHttpHref("HTTPS://Example.com")).toBe("HTTPS://Example.com");
  });
  it("blocks javascript: and data: schemes", () => {
    expect(safeHttpHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpHref("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeHttpHref(" javascript:alert(1)")).toBeUndefined();
  });
  it("returns undefined for empty/non-string input", () => {
    expect(safeHttpHref("")).toBeUndefined();
    expect(safeHttpHref(undefined)).toBeUndefined();
  });
});
