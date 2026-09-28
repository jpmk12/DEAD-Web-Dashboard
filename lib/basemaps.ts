// Basemap providers for every Leaflet surface in the app — ONE vocabulary, in
// one file, for the same reason lib/icons.tsx exists: when a tile host changes
// its terms, there must be a single place to change.
//
// This module is deliberately PURE DATA (no react, no leaflet imports) so both
// the Crisis map and the Regional pane's incident mini-map can pull from it
// without dragging anything into each other's bundle.
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
// The generalizable rule: prefer a tile host with no key concept at all over
// one whose free tier is a revocable policy. OSM's own tile server leads
// because it has never had keys and refuses honestly (403/429) when it wants
// us to stop.

export interface Basemap {
  id: string;
  name: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** Provider ships LIGHT tiles — apply .crisis-basemap-darken (globals.css). */
  darken: boolean;
}

// Tried in order. `{s}` subdomain rotation appears only where the provider
// still documents it; OSM asked clients to stop using a./b./c. prefixes.
export const BASEMAPS: readonly Basemap[] = [
  {
    id: "osm",
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
    darken: true,
  },
  {
    // Genuine dark cartography, keyless on this legacy MapServer endpoint — the
    // newer ArcGIS "basemap styles" service is the one that needs a token.
    // Note the {z}/{y}/{x} order: row before column, unlike every other entry.
    id: "esri-dark",
    name: "Esri dark canvas",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
    maxZoom: 16,
    darken: false,
  },
  {
    id: "opentopo",
    name: "OpenTopoMap",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap, SRTM &copy; OpenTopoMap (CC-BY-SA)",
    maxZoom: 17,
    darken: true,
  },
];

/** CSS class that darkens a light provider's tiles. Tile pane only — the Leaflet
 *  marker/overlay panes are siblings of it, so marker colours are untouched. */
export const DARKEN_CLASS = "crisis-basemap-darken";

// How many tile errors, with no tile ever having loaded, before a provider is
// judged to be REFUSING us rather than merely missing a tile at the edge of its
// coverage — ordinary gaps produce errors AND successful loads. Only catches
// providers that fail honestly; see the CARTO note above.
export const TILE_FAIL_LIMIT = 8;
