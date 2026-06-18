// Weather condition → vector icon, for the Weather tab cards. Maps NWS
// shortForecast text (or an Open-Meteo WMO code) to one lucide glyph + a colour,
// day/night aware. lucide-react is already a dependency (no new package, no
// esbuild — it's pure React components), and this keeps "one condition → one
// glyph" in a single place, like lib/icons.tsx does for the nav.
//
// The mappers are PURE (string/number → icon id) so they're unit-tested without
// rendering. <WeatherIcon> is the render convenience used by the cards.

import {
  Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, CloudLightning,
  CloudSnow, CloudFog, Wind, Sunrise, Sunset, type LucideIcon,
} from "lucide-react";

export type WeatherIconId =
  | "sun" | "moon" | "cloudsun" | "cloudmoon" | "cloud"
  | "rain" | "storm" | "snow" | "fog" | "wind";

export const WEATHER_ICONS: Record<WeatherIconId, LucideIcon> = {
  sun: Sun, moon: Moon, cloudsun: CloudSun, cloudmoon: CloudMoon, cloud: Cloud,
  rain: CloudRain, storm: CloudLightning, snow: CloudSnow, fog: CloudFog, wind: Wind,
};

export const WEATHER_ICON_COLOR: Record<WeatherIconId, string> = {
  sun: "#fbbf24", moon: "#a5b4fc", cloudsun: "#fbbf24", cloudmoon: "#a5b4fc",
  cloud: "#94a3b8", rain: "#38bdf8", storm: "#fbbf24", snow: "#bae6fd",
  fog: "#64748b", wind: "#5eead4",
};

// Short label per glyph — used for the condition line on the OCONUS / current-
// conditions path where there's no NWS shortForecast text to show.
export const WEATHER_ICON_LABEL: Record<WeatherIconId, string> = {
  sun: "Clear", moon: "Clear", cloudsun: "Partly Cloudy", cloudmoon: "Partly Cloudy",
  cloud: "Cloudy", rain: "Rain", storm: "Thunderstorm", snow: "Snow", fog: "Fog", wind: "Windy",
};

// Sunrise / sunset glyphs (re-exported so the card imports from one place).
export const SunriseIcon = Sunrise;
export const SunsetIcon = Sunset;

// PURE: NWS shortForecast (e.g. "Chance Showers And Thunderstorms", "Mostly
// Sunny", "Patchy Fog") → icon id. Order matters: the more severe / specific
// condition wins (a "thunderstorm" line also contains "rain" words). Falls back
// to a mild partly-cloudy glyph rather than guessing clear.
export function conditionIconId(text: string, isDay = true): WeatherIconId {
  const s = (text || "").toLowerCase();
  if (!s) return isDay ? "cloudsun" : "cloudmoon";
  if (/thunder|t-?storm|lightning|tstms/.test(s)) return "storm";
  if (/snow|flurr|sleet|wintry|blizzard|ice pellets|freezing rain|freezing drizzle/.test(s)) return "snow";
  if (/rain|shower|drizzle|sprinkle|precip/.test(s)) return "rain";
  if (/fog|haze|mist|smoke|dust|sand/.test(s)) return "fog";
  if (/\bwind|breez|blustery|gust/.test(s)) return "wind";
  // Some sun/cloud mix: "partly/mostly sunny", "partly cloudy", "few/scattered clouds".
  if (/(mostly|partly)\s+(sunny|clear)|partly\s+cloudy|few clouds|scattered clouds|partly to mostly/.test(s)) {
    return isDay ? "cloudsun" : "cloudmoon";
  }
  if (/cloud|overcast/.test(s)) return "cloud";
  if (/sunny|clear|fair|\bhot\b/.test(s)) return isDay ? "sun" : "moon";
  return isDay ? "cloudsun" : "cloudmoon";
}

// PURE: Open-Meteo WMO weather code → icon id (used for the OCONUS / current-
// conditions path where there's no NWS shortForecast text).
export function wmoIconId(code: number, isDay = true): WeatherIconId {
  if (code === 0) return isDay ? "sun" : "moon";
  if (code === 1 || code === 2) return isDay ? "cloudsun" : "cloudmoon";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";   // drizzle + rain
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";   // rain showers
  if (code === 85 || code === 86) return "snow"; // snow showers
  if (code >= 95) return "storm";                // thunderstorm
  return isDay ? "cloudsun" : "cloudmoon";
}

// Render convenience: pick the glyph from an icon id (or derive it from
// shortForecast text). Colour follows the vocabulary unless overridden.
export function WeatherIcon({
  id, text, isDay = true, size = 28, strokeWidth = 1.9, color, className,
}: {
  id?: WeatherIconId; text?: string; isDay?: boolean; size?: number;
  strokeWidth?: number; color?: string; className?: string;
}) {
  const iconId = id ?? conditionIconId(text ?? "", isDay);
  const Icon = WEATHER_ICONS[iconId];
  return <Icon size={size} strokeWidth={strokeWidth} color={color ?? WEATHER_ICON_COLOR[iconId]} className={className} aria-hidden />;
}
