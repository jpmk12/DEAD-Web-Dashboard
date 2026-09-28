// Basemap providers for every Leaflet surface in the app — ONE vocabulary, in
// one file, for the same reason lib/icons.tsx exists: when a tile host changes
// its terms, there must be a single place to change.
//
// This module is deliberately PURE DATA (no react, no leaflet imports) so both
// the Crisis map and the Regional pane's incident mini-map can pull from it
// without dragging anything into each other's bundle. Unit-tested.
//
// Two dimensions, kept separate on purpose:
//   STYLE     — what the user picked (dark / satellite / street). A preference.
//   PROVIDERS — the ordered hosts that can render that style. A fallback chain.
// Mixing them is how you end up unable to say whether a wrong-looking map is a
// setting or an outage.
//
// ── Why CARTO is not in this list ──────────────────────────────────────────
// `basemaps.cartocdn.com/dark_all` was the app's primary basemap. CARTO
// withdrew keyless access and now answers with a nag TILE: an image reading
// "API key required · carto.com", served as **HTTP 200**.
//
// That is the worst failure mode a dependency can have. `tileerror` never
// fires, `load` fires happily, and nothing on the client can distinguish that
// graphic from real cartography — so the map rendered as broken while
// reporting itself healthy, and the only detector was a human looking at it.
// A provider that lies with a 200 cannot be kept in a fallback chain, so it is
// REMOVED rather than demoted.
//
// ── Why not Google Maps ────────────────────────────────────────────────────
// Considered and declined on purpose. Pulling Google's tiles into Leaflet
// (mt1.google.com/vt/...) breaches the Maps ToS and gets IP-blocked — the CARTO
// problem with legal exposure added. Using Maps Platform properly is a rewrite
// of ~55 react-leaflet elements (Google has no CircleMarker and no Tooltip) AND
// makes the basemap a metered dependency needing a key and a billing account.
// Esri's legacy MapServer endpoints below give the same dark-and-satellite look
// with no key at all. The generalizable rule: prefer a tile host with **no key
// concept** over one whose free tier is a revocable policy.

export interface Basemap {
  id: string;
  name: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** Provider ships LIGHT tiles — apply DARKEN_CLASS (globals.css). */
  darken: boolean;
}

export type BasemapStyleId = "dark" | "satellite" | "street";

export interface BasemapStyle {
  id: BasemapStyleId;
  label: string;
  /** One-line description for the picker. */
  hint: string;
  /** Tried in order; the first that actually serves tiles wins. */
  providers: readonly Basemap[];
}

// ── Providers ──────────────────────────────────────────────────────────────
// `{s}` subdomain rotation appears only where the provider still documents it;
// OSM asked clients to stop using a./b./c. prefixes.

// Esri's legacy `services.arcgisonline.com/.../MapServer/tile` endpoints are
// keyless — the newer ArcGIS "basemap styles" service is the one needing a
// token. NOTE the {z}/{y}/{x} order: row before column, unlike every other
// entry here. Getting it backwards yields a map that loads but is transposed.
const ESRI_DARK: Basemap = {
  id: "esri-dark",
  name: "Esri dark canvas",
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
  maxZoom: 16,
  darken: false,
};

const ESRI_IMAGERY: Basemap = {
  id: "esri-imagery",
  name: "Esri world imagery",
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution:
    "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, and the GIS User Community",
  maxZoom: 19,
  darken: false,
};

// Reference labels/boundaries to lay over imagery — satellite alone has no
// place names, which makes a threat map much harder to read.
export const ESRI_REFERENCE_OVERLAY: Basemap = {
  id: "esri-reference",
  name: "Esri reference labels",
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  attribution: "",
  maxZoom: 19,
  darken: false,
};

// The backstop, in every chain: OSM's own tile server has never had a key
// concept and refuses HONESTLY (403/429) when it wants us to stop.
const OSM: Basemap = {
  id: "osm",
  name: "OpenStreetMap",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
  darken: false,
};

/** OSM rendered dark, for use inside the dark style. Same host, different look. */
const OSM_DARK: Basemap = { ...OSM, id: "osm-dark", name: "OpenStreetMap (darkened)", darken: true };

const ESRI_STREET: Basemap = {
  id: "esri-street",
  name: "Esri street map",
  url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, USGS, NRCAN",
  maxZoom: 19,
  darken: false,
};

// ── Styles ─────────────────────────────────────────────────────────────────
// Each chain degrades WITHIN its own intent where it can, then to OSM. A
// satellite style falling back to a street map is surprising, so imagery drops
// to dark cartography first — still a dark map, just not photographic.
//
// INVARIANT (enforced by tests/basemaps.test.ts): every chain has ≥2 entries
// and ENDS on OSM's own tile server. Esri leads each style because it has real
// cartography for all three looks, but it is still a single vendor — the last
// resort has to be the host with no key concept and honest refusals. An earlier
// draft ended the street chain on OpenTopoMap; a test written from this comment
// caught it, and OpenTopoMap is both a tighter-policy volunteer service and a
// topo map, so it was the wrong backstop twice over.
export const BASEMAP_STYLES: readonly BasemapStyle[] = [
  {
    id: "dark",
    label: "Dark",
    hint: "Muted dark cartography — marker colours read cleanest",
    providers: [ESRI_DARK, OSM_DARK],
  },
  {
    id: "satellite",
    label: "Satellite",
    hint: "Photographic imagery with place labels over it",
    providers: [ESRI_IMAGERY, ESRI_DARK, OSM_DARK],
  },
  {
    id: "street",
    label: "Street",
    hint: "Light street map — most road and place-name detail",
    providers: [ESRI_STREET, OSM],
  },
];

export const DEFAULT_STYLE: BasemapStyleId = "dark";

export function styleById(id: string | null | undefined): BasemapStyle {
  return BASEMAP_STYLES.find((s) => s.id === id) ?? BASEMAP_STYLES[0];
}

/** The provider to render for a style, given how many have already been ruled
 *  out. Clamps rather than running off the end — the last provider in a chain
 *  is the backstop, so there is always something to draw. */
export function providerFor(style: BasemapStyle, failedCount: number): Basemap {
  return style.providers[Math.min(Math.max(failedCount, 0), style.providers.length - 1)];
}

/** True when this style wants reference labels drawn on top (imagery has none). */
export function wantsLabels(style: BasemapStyle, provider: Basemap): boolean {
  return style.id === "satellite" && provider.id === ESRI_IMAGERY.id;
}

/** The app-wide default provider, for surfaces with no picker of their own
 *  (the Regional pane's incident mini-map). */
export const DEFAULT_BASEMAP: Basemap = providerFor(styleById(DEFAULT_STYLE), 0);

/** CSS class that darkens a light provider's tiles. Tile pane only — the Leaflet
 *  marker/overlay panes are siblings of it, so marker colours are untouched. */
export const DARKEN_CLASS = "crisis-basemap-darken";

// How many tile errors, with no tile ever having loaded, before a provider is
// judged to be REFUSING us rather than merely missing a tile at the edge of its
// coverage — ordinary gaps produce errors AND successful loads. Only catches
// providers that fail honestly; see the CARTO note above.
export const TILE_FAIL_LIMIT = 8;
