"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe media-query hook. Returns `true` when the viewport is narrower than
 * `breakpoint` (default 1024px = Tailwind's `lg`). Use this only where CSS
 * breakpoints can't express the difference (e.g. choosing which component tree
 * to mount); prefer `lg:` utility classes for pure styling.
 *
 * Starts `false` on the server and on the first client render to avoid hydration
 * mismatches, then updates after mount.
 */
export function useIsMobile(breakpoint = 1024): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);

  return isMobile;
}
