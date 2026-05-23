"use client";

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
    fetch("/api/user-prefs")
      .then((r) => r.json())
      .then(({ prefs }) => {
        const theme: AppTheme = VALID.includes(prefs?.theme) ? prefs.theme : "nightwatch";
        applyTheme(theme);
      })
      .catch(() => {});
  }, []);

  return null;
}
