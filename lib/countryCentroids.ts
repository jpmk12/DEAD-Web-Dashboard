// Approximate country centroids for plotting country-level signals (State Dept
// travel advisories → NEO pins) on the Crisis map. Covers the realistic
// Level-4 / embassy-departure set plus common countries; unknowns are skipped.
// Centroids are rough geographic centers — pin placement only, not boundaries.

const CENTROIDS: Record<string, [number, number]> = {
  afghanistan: [33.9, 67.7], iraq: [33.0, 43.7], iran: [32.4, 53.7], syria: [35.0, 38.0],
  lebanon: [33.9, 35.9], yemen: [15.6, 48.0], israel: [31.4, 35.0], "west bank": [32.0, 35.3],
  gaza: [31.4, 34.4], jordan: [31.3, 36.2], "saudi arabia": [23.9, 45.1], egypt: [26.8, 30.8],
  libya: [26.3, 17.2], tunisia: [33.9, 9.6], algeria: [28.0, 1.7], mauritania: [21.0, -10.9],
  mali: [17.6, -3.5], "burkina faso": [12.2, -1.6], niger: [17.6, 8.1], chad: [15.4, 18.7],
  nigeria: [9.1, 8.7], sudan: [15.5, 30.2], "south sudan": [7.3, 30.0], somalia: [5.2, 46.2],
  ethiopia: [9.1, 40.5], eritrea: [15.2, 39.8], kenya: [0.0, 37.9], uganda: [1.4, 32.3],
  tanzania: [-6.4, 34.9], rwanda: [-1.9, 29.9], burundi: [-3.4, 29.9], "central african republic": [6.6, 20.9],
  "democratic republic of the congo": [-2.9, 23.6], "dr congo": [-2.9, 23.6], congo: [-0.7, 15.8],
  cameroon: [5.7, 12.7], guinea: [9.9, -9.7], "guinea-bissau": [12.0, -15.0], mozambique: [-18.7, 35.5],
  zimbabwe: [-19.0, 29.9], madagascar: [-18.8, 46.9], "papua new guinea": [-6.3, 143.9],
  myanmar: [21.9, 95.9], burma: [21.9, 95.9], "north korea": [40.3, 127.5], pakistan: [30.4, 69.3],
  bangladesh: [23.7, 90.4], "sri lanka": [7.9, 80.8], nepal: [28.4, 84.1], india: [22.0, 79.0],
  china: [35.9, 104.2], philippines: [12.9, 121.8], ukraine: [48.4, 31.2], russia: [61.5, 105.3],
  belarus: [53.7, 27.9], georgia: [42.3, 43.4], armenia: [40.1, 45.0], azerbaijan: [40.1, 47.6],
  turkey: [39.0, 35.2], "türkiye": [39.0, 35.2], venezuela: [6.4, -66.6], colombia: [4.6, -74.3],
  haiti: [19.0, -72.3], cuba: [21.5, -77.8], "el salvador": [13.8, -88.9], honduras: [15.2, -86.2],
  nicaragua: [12.9, -85.2], guatemala: [15.8, -90.2], mexico: [23.6, -102.5], ecuador: [-1.8, -78.2],
  peru: [-9.2, -75.0], bolivia: [-16.3, -63.6],
};

// Look up a centroid by free-text country name (case/whitespace-insensitive).
export function countryCentroid(name: string): [number, number] | null {
  const key = name.trim().toLowerCase();
  if (CENTROIDS[key]) return CENTROIDS[key];
  // Loose contains-match for compound names ("Republic of …", "… (the)").
  for (const k of Object.keys(CENTROIDS)) {
    if (key.includes(k) || k.includes(key)) return CENTROIDS[k];
  }
  return null;
}
