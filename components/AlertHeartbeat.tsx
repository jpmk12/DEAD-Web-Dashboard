"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

// An open dashboard tab is one of the things that drives web-push dispatch on
// a host with no cron: every /api/alerts/check hit compares the current alert
// list against every subscribed device's seen-set and pushes the difference.
// So a desktop left open at work keeps the phone in a pocket informed.
//
// Cheap by construction — the check is feed-only (no model call) and 5-min
// cached server-side — and it runs ONLY when this account has at least one
// push device and the tab is visible. Nothing to drive → nothing to poll.

const INTERVAL_MS = 10 * 60 * 1000;

export default function AlertHeartbeat() {
  const { status } = useSession();
  const armed = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/alerts/check", { cache: "no-store" }).catch(() => {});
    };

    (async () => {
      try {
        const r = await fetch("/api/push/subscribe", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        if (!j?.configured || !(j.devices > 0)) return;
        armed.current = true;
        tick();
        timer = setInterval(tick, INTERVAL_MS);
        document.addEventListener("visibilitychange", tick);
      } catch { /* leave un-armed */ }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [status]);

  return null;
}
