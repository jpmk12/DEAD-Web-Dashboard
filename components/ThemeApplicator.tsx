"use client";

import { sharedGet } from "@/lib/sharedGet";
import { useEffect } from "react";
import type { AppTheme } from "@/lib/types";

const VALID: AppTheme[] = ["nightwatch", "amber", "arctic", "mission"];
const STORAGE_KEY = "app-theme";

export function applyTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
}

// Reads saved theme from prefs API and applies it; also syncs localStorage.
export default function ThemeApplicator() {
  useEffect(() => {
    sharedGet<{ prefs?: { theme?: string } }>("/api/user-prefs")
      .then(({ body }) => {
        const prefs = body?.prefs ?? {};
        const t = prefs.theme as AppTheme;
        const theme: AppTheme = VALID.includes(t) ? t : "nightwatch";
        applyTheme(theme);
      })
      .catch(() => {});
  }, []);

  return null;
}
