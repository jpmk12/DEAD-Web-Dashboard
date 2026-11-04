// Shared option lists for the Preferences drawer and its editors (split out of
// PreferencesDrawer.tsx, housekeeping 2026-11-04).

// Preset locations — value = localFeedKey, lat/lon used by weather tab
export const LOCAL_FEED_OPTIONS: { value: string; label: string; lat: number; lon: number }[] = [
  { value: "colorado",      label: "Colorado — Front Range / CSFS",         lat: 38.85, lon: -104.80 },
  { value: "dc",            label: "DC Metro — National Capital Region",     lat: 38.90, lon: -77.03  },
  { value: "hampton_roads", label: "Hampton Roads — Tidewater VA",           lat: 36.85, lon: -76.29  },
  { value: "illinois",      label: "Illinois — Chicago / Scott AFB",         lat: 41.88, lon: -87.63  },
  { value: "new_jersey",    label: "New Jersey — JB McGuire-Dix-Lakehurst", lat: 40.01, lon: -74.59  },
  { value: "oklahoma",      label: "Oklahoma — OKC / Altus AFB",             lat: 35.47, lon: -97.38  },
  { value: "san_antonio",   label: "San Antonio — Joint Base SA",            lat: 29.42, lon: -98.49  },
  { value: "hawaii",        label: "Hawaii — Oahu / Joint Base PHH",         lat: 21.30, lon: -157.85 },
  { value: "japan",         label: "Japan / Pacific — Okinawa (Kadena)",     lat: 26.33, lon:  127.80 },
  { value: "germany",       label: "Germany / Europe — Ramstein Area",       lat: 49.43, lon:    7.60 },
];

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "America/New_York",    label: "Eastern (ET)" },
  { value: "America/Chicago",     label: "Central (CT)" },
  { value: "America/Denver",      label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Anchorage",   label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HST)" },
  { value: "Asia/Tokyo",          label: "Japan (JST)" },
  { value: "Europe/Berlin",       label: "Germany (CET/CEST)" },
  { value: "UTC",                 label: "UTC" },
];
