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

  // Mobility / US-force-presence countries (so country-of-interest watches pin
  // on the map and INFORM/advisory country signals plot more broadly).
  // CENTCOM / Gulf
  qatar: [25.3, 51.2], kuwait: [29.3, 47.5], bahrain: [26.0, 50.5],
  "united arab emirates": [23.4, 53.8], uae: [23.4, 53.8], oman: [21.5, 55.9],
  kazakhstan: [48.0, 66.9], uzbekistan: [41.4, 64.6], turkmenistan: [38.9, 59.6],
  tajikistan: [38.9, 71.3], kyrgyzstan: [41.2, 74.8],
  // EUCOM / Europe
  germany: [51.2, 10.4], poland: [51.9, 19.1], romania: [45.9, 24.9], italy: [41.9, 12.6],
  spain: [40.0, -3.7], france: [46.6, 2.2], "united kingdom": [54.0, -2.5], greece: [39.1, 21.8],
  norway: [60.5, 8.5], "north macedonia": [41.6, 21.7], bulgaria: [42.7, 25.5], hungary: [47.2, 19.5],
  slovakia: [48.7, 19.7], "czech republic": [49.8, 15.5], czechia: [49.8, 15.5], netherlands: [52.1, 5.3],
  belgium: [50.6, 4.6], portugal: [39.5, -8.0], estonia: [58.6, 25.0], latvia: [56.9, 24.6],
  lithuania: [55.2, 23.9], finland: [61.9, 25.7], sweden: [60.1, 18.6], moldova: [47.4, 28.4],
  cyprus: [35.1, 33.4], kosovo: [42.6, 20.9], serbia: [44.0, 21.0], "bosnia and herzegovina": [43.9, 17.7],
  // AFRICOM (additional)
  djibouti: [11.8, 42.6], morocco: [31.8, -7.1], ghana: [7.9, -1.0], senegal: [14.5, -14.5],
  "cote d'ivoire": [7.5, -5.5], "ivory coast": [7.5, -5.5], gabon: [-0.8, 11.6], angola: [-11.2, 17.9],
  "south africa": [-30.6, 22.9], zambia: [-13.1, 27.8], malawi: [-13.3, 34.3], "sierra leone": [8.5, -11.8],
  liberia: [6.4, -9.4], benin: [9.3, 2.3], togo: [8.6, 0.8],
  // INDOPACOM (additional)
  japan: [36.2, 138.3], "south korea": [36.5, 127.8], korea: [36.5, 127.8], taiwan: [23.7, 121.0],
  australia: [-25.3, 133.8], "new zealand": [-41.8, 172.0], thailand: [15.0, 101.0],
  vietnam: [14.1, 108.3], indonesia: [-2.5, 118.0], malaysia: [3.9, 102.3], singapore: [1.35, 103.8],
  cambodia: [12.6, 104.9], laos: [19.9, 102.5], mongolia: [46.9, 103.8], "timor-leste": [-8.8, 125.7],
  guam: [13.4, 144.8], palau: [7.5, 134.6], fiji: [-17.7, 178.1],
  // NORTHCOM / SOUTHCOM (additional)
  "united states": [39.8, -98.6], usa: [39.8, -98.6], canada: [56.1, -106.3], panama: [8.5, -80.1],
  brazil: [-14.2, -51.9], argentina: [-38.4, -63.6], chile: [-35.7, -71.5], paraguay: [-23.4, -58.4],
  "dominican republic": [18.7, -70.2], jamaica: [18.1, -77.3], "trinidad and tobago": [10.7, -61.2],
  "costa rica": [9.7, -83.8], belize: [17.2, -88.5], guyana: [4.9, -58.9], suriname: [4.0, -56.0],
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
