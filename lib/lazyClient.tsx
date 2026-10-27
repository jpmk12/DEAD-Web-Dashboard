"use client";

import { useEffect, useState, type ComponentProps, type ComponentType } from "react";

// Client-only code splitting WITHOUT React.lazy / next/dynamic.
//
// Why this exists (2026-10-27, found by driving the production build in
// headless Chromium): a `next/dynamic(..., { ssr: false })` component whose
// chunk had loaded in ~100 ms did not COMMIT until the shell happened to
// re-render for some other reason — 22 s after the click on a fresh page
// (the briefing grace timer), never when the dashboard had settled. The
// Preferences drawer and the Family tab both behaved this way with React
// 19.2 / Next 15.5; a non-lazy modal mounted in 17 ms. On a live dashboard
// the shell re-renders often enough to mask it, which is exactly the kind of
// fault that reads as "the button does nothing" on a quiet day.
//
// This helper does the split by hand: the module is imported in an effect
// and the component is put into STATE, so its arrival is an ordinary state
// update that React must render. The import runs only in the browser (an
// effect never runs on the server), so Leaflet-style window-only modules are
// safe. The loaded component is cached per helper, so a remount is
// synchronous. A `fallback` renders while the chunk is in flight — show one
// for anything the user opens with a tap, so the tap is answered at once.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyClient<C extends ComponentType<any>>(
  load: () => Promise<{ default: C }>,
  fallback?: ComponentType<Record<string, never>>,
): C {
  let cached: C | null = null;
  let inflight: Promise<C> | null = null;
  const Fallback = fallback ?? null;
  function LazyClient(props: ComponentProps<C>) {
    const [Comp, setComp] = useState<C | null>(() => cached);
    useEffect(() => {
      if (cached) { setComp(() => cached); return; }
      let on = true;
      inflight = inflight ?? load().then((m) => { cached = m.default; return m.default; });
      inflight.then((c) => { if (on) setComp(() => c); }).catch(() => { inflight = null; });
      return () => { on = false; };
    }, []);
    if (!Comp) return Fallback ? <Fallback /> : null;
    return <Comp {...props} />;
  }
  LazyClient.displayName = "LazyClient";
  // The wrapper takes exactly the wrapped component's props; the cast keeps
  // call sites typed as if they imported the component directly.
  return LazyClient as unknown as C;
}
