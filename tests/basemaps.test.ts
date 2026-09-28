import { describe, it, expect } from "vitest";
import {
  BASEMAP_STYLES, DEFAULT_BASEMAP, DEFAULT_STYLE, ESRI_REFERENCE_OVERLAY,
  providerFor, styleById, wantsLabels,
} from "../lib/basemaps";

describe("styleById", () => {
  it("resolves a known style", () => {
    expect(styleById("satellite").id).toBe("satellite");
    expect(styleById("street").id).toBe("street");
  });

  it("falls back to the first style for anything unknown", () => {
    // A stale id persisted by an older build must not leave the map with no
    // provider — it degrades to the default, never to nothing.
    expect(styleById("carto-dark").id).toBe("dark");
    expect(styleById(null).id).toBe("dark");
    expect(styleById(undefined).id).toBe("dark");
    expect(styleById("").id).toBe("dark");
  });
});

describe("providerFor", () => {
  it("walks the chain as providers are ruled out", () => {
    const sat = styleById("satellite");
    expect(providerFor(sat, 0).id).toBe("esri-imagery");
    expect(providerFor(sat, 1).id).toBe("esri-dark");
    expect(providerFor(sat, 2).id).toBe("osm-dark");
  });

  it("clamps instead of running off the end — there is always something to draw", () => {
    // The last entry in every chain is the backstop. A blank map is the one
    // outcome this module exists to prevent, so an out-of-range count must not
    // produce undefined.
    for (const style of BASEMAP_STYLES) {
      const last = style.providers[style.providers.length - 1];
      expect(providerFor(style, 99).id).toBe(last.id);
      expect(providerFor(style, style.providers.length).id).toBe(last.id);
    }
  });

  it("clamps a negative count to the first provider", () => {
    expect(providerFor(styleById("dark"), -3).id).toBe("esri-dark");
  });
});

describe("chain integrity", () => {
  it("gives every style at least one fallback and ends on a keyless host", () => {
    for (const style of BASEMAP_STYLES) {
      expect(style.providers.length).toBeGreaterThanOrEqual(2);
      // OSM's own tile server has no key concept and refuses honestly, which is
      // why it is the last resort in every chain.
      expect(providerFor(style, 99).url).toContain("tile.openstreetmap.org");
    }
  });

  it("has no CARTO provider anywhere", () => {
    // CARTO answers its "API key required" nag with HTTP 200, so no client-side
    // health check can detect it. It must never re-enter a chain.
    const urls = BASEMAP_STYLES.flatMap((s) => s.providers.map((p) => p.url));
    urls.push(ESRI_REFERENCE_OVERLAY.url, DEFAULT_BASEMAP.url);
    for (const u of urls) expect(u).not.toContain("cartocdn");
  });

  it("uses unique provider ids so React keys don't collide across a fallback", () => {
    for (const style of BASEMAP_STYLES) {
      const ids = style.providers.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("marks exactly the light providers for darkening", () => {
    const all = BASEMAP_STYLES.flatMap((s) => s.providers);
    // The dark styles darken plain OSM; the street style shows it as-is. Same
    // host, different intent — so `darken` must not be a property of the URL.
    expect(all.find((p) => p.id === "osm-dark")?.darken).toBe(true);
    expect(all.find((p) => p.id === "osm")?.darken).toBe(false);
    expect(all.find((p) => p.id === "esri-imagery")?.darken).toBe(false);
  });
});

describe("wantsLabels", () => {
  it("asks for reference labels only over photographic imagery", () => {
    const sat = styleById("satellite");
    expect(wantsLabels(sat, providerFor(sat, 0))).toBe(true);
    // Once imagery has fallen back to cartography the labels are already in the
    // tiles; drawing them again would double every place name.
    expect(wantsLabels(sat, providerFor(sat, 1))).toBe(false);
    expect(wantsLabels(styleById("dark"), providerFor(styleById("dark"), 0))).toBe(false);
  });
});

describe("defaults", () => {
  it("defaults to real dark cartography, not a CSS-inverted street map", () => {
    expect(DEFAULT_STYLE).toBe("dark");
    expect(DEFAULT_BASEMAP.id).toBe("esri-dark");
    expect(DEFAULT_BASEMAP.darken).toBe(false);
  });

  it("keeps Esri's transposed tile order on the Esri layers only", () => {
    // services.arcgisonline.com serves {z}/{y}/{x} — row before column. Getting
    // it backwards yields a map that loads but is silently transposed.
    for (const p of [DEFAULT_BASEMAP, ESRI_REFERENCE_OVERLAY]) {
      expect(p.url.endsWith("/{z}/{y}/{x}")).toBe(true);
    }
    const osm = BASEMAP_STYLES.flatMap((s) => s.providers).find((p) => p.id === "osm")!;
    expect(osm.url.endsWith("/{z}/{x}/{y}.png")).toBe(true);
  });

  it("attributes every rendered provider", () => {
    // Esri and OSM both require attribution. The reference overlay is exempt —
    // it rides on top of a layer that already carries the Esri credit.
    for (const style of BASEMAP_STYLES) {
      for (const p of style.providers) expect(p.attribution.length).toBeGreaterThan(0);
    }
  });
});
