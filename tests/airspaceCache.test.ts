import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub ONLY the network door (fetchDaipQuery); keep the real parsing helpers so
// parseAirspaceGroups still works. Lets us assert the in-process cache without
// touching DAIP.
vi.mock("@/lib/notams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notams")>();
  return { ...actual, fetchDaipQuery: vi.fn() };
});

import { fetchDaipQuery } from "@/lib/notams";
import { getGpsNotams, resetAirspaceCache } from "@/lib/airspace";

const mockFetch = fetchDaipQuery as unknown as ReturnType<typeof vi.fn>;
const GPS_OK = JSON.stringify({
  type: "GPS_WAAS",
  group: [{ name: "GPS NOTAMs", notams: [{ code: "KGPS", name: "GPS", list: [{ text: "GPS NAV PRN 20 U/S", rawtext: "!GPS 03/078 GPS NAV PRN 20 U/S" }] }] }],
});

describe("airspace DAIP cache", () => {
  beforeEach(() => { resetAirspaceCache(); mockFetch.mockReset(); });

  it("caches a successful query — one fetch across two calls", async () => {
    mockFetch.mockResolvedValue({ configured: true, raw: GPS_OK });
    const a = await getGpsNotams();
    const b = await getGpsNotams();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(a.groups.length).toBeGreaterThan(0);
    expect(b.groups.length).toBe(a.groups.length);
  });

  it("resetAirspaceCache forces a refetch", async () => {
    mockFetch.mockResolvedValue({ configured: true, raw: GPS_OK });
    await getGpsNotams();
    resetAirspaceCache();
    await getGpsNotams();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures (raw null) — retries on the next call", async () => {
    mockFetch.mockResolvedValue({ configured: true, raw: null });
    await getGpsNotams();
    await getGpsNotams();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache an unconfigured result", async () => {
    mockFetch.mockResolvedValue({ configured: false, raw: null });
    const r = await getGpsNotams();
    await getGpsNotams();
    expect(r.configured).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
