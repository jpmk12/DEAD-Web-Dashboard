import { describe, expect, it } from "vitest";
import { isPrivateAddress, resolvePublicUrl } from "../lib/safeFetch";

// The SSRF guard for user-supplied feed URLs (code review 2026-10-07). The
// string check in lib/osintFeeds.ts catches a literal 127.0.0.1; this layer
// catches the addresses a NAME resolves to, IPv4-mapped IPv6, and the
// ranges the regex never named.

describe("isPrivateAddress", () => {
  it("rejects loopback, RFC1918, link-local, CGNAT, this-net and multicast", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("accepts ordinary public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "9.9.9.9", "151.101.1.69"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
  it("rejects IPv6 loopback, unspecified, unique-local, link-local, multicast and mapped v4", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "2002:7f00:1::1", "64:ff9b::7f00:1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("accepts public IPv6", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("2a00:1450:4001:80e::200e")).toBe(false);
  });
  it("treats a non-address as untrusted", () => {
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("localhost")).toBe(true);
  });
});

describe("resolvePublicUrl", () => {
  it("refuses non-http schemes, credentials and private literals without a lookup", async () => {
    expect(await resolvePublicUrl("ftp://example.com/feed")).toBeNull();
    expect(await resolvePublicUrl("javascript:alert(1)")).toBeNull();
    expect(await resolvePublicUrl("http://user:pw@example.com/feed")).toBeNull();
    expect(await resolvePublicUrl("http://127.0.0.1:3000/api/x")).toBeNull();
    expect(await resolvePublicUrl("http://2130706433/")).toBeNull(); // the URL parser normalises this to 127.0.0.1
    expect(await resolvePublicUrl("http://0x7f000001/")).toBeNull();
    expect(await resolvePublicUrl("http://[::ffff:127.0.0.1]/")).toBeNull();
    expect(await resolvePublicUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
  });
  it("accepts a public literal address without a lookup", async () => {
    const u = await resolvePublicUrl("https://1.1.1.1/feed.xml");
    expect(u?.hostname).toBe("1.1.1.1");
  });
});
